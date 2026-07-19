/**
 * Server entrypoint: Express (json 2mb) + auth routes + /api/health + error middleware ({error} incl. 413)
 * + ws at /ws. CRM core is created via initCrm (dynamic — decoupled from A2 build order). JWT fail-fast
 * happens inside loadConfig().
 */
import express from "express";
import http from "node:http";
import { loadConfig } from "./config.js";
import { initCrm } from "./crm.js";
import { createAuthRouter } from "./auth/index.js";
import { authRequired } from "./auth/jwt.js";
import { activeAccountRequired } from "./auth/active-account.js";
import { createAdminRouter } from "./admin-routes/index.js";
import { loadPricingOverrides } from "./ops/pricing.js";
import { createCrmRouter } from "./crm-routes/index.js";
import { createResearchRouter } from "./research/routes.js";
import { createCrawlJobStore } from "./research/jobs.js";
import { createTrainRouter } from "./train/routes.js";
import { createGeminiClient } from "./gemini.js";
import { RealtimeHub } from "./realtime/hub.js";
import { attachRealtimeWs } from "./realtime/ws-server.js";
import { createMeetingsRouter } from "./realtime/meetings-routes.js";
import { startTranscriptRetention } from "./realtime/transcript-retention.js";
import { createDecksRouter } from "./decks-routes/index.js";
import { createDeckAssetsRouter } from "./decks-routes/assets-route.js";
import { createOrgRouter } from "./org-routes/index.js";
import { requestLogger, securityHeaders } from "./ops/http-middleware.js";
import { TokenBucketRateLimiter, rateLimit } from "./ops/token-bucket.js";
import { createMeter } from "./ops/meter-impl.js";
import { createUsageRouter } from "./ops/usage-routes.js";

async function main(): Promise<void> {
  const config = loadConfig(); // exits(1) on missing/placeholder JWT_SECRET

  // Non-fatal guard: async analysis callbacks (M3) must not tear down the process.
  process.on("unhandledRejection", (err) => {
    console.error("[unhandledRejection]", err);
  });

  const core = await initCrm(config.dbPath);
  await core.migrate();

  // crawl_jobs reaper（契約五）：server 重啟後把殘留 queued/running 的研究 job 一律標 failed（其背景流程已隨舊進程消失，
  // 永不會再收尾）。必須在 migrate() 之後、開始接流量前跑一次；跨 org。前端逃生口據 error 文案顯示「已中斷」。
  try {
    const interrupted = await createCrawlJobStore(core.db).failInterrupted();
    if (interrupted > 0) {
      console.log(`[research] reaper: marked ${interrupted} interrupted crawl job(s) as failed on boot`);
    }
  } catch (e) {
    console.error("[research] reaper failed on boot (non-fatal):", e);
  }

  // import_jobs reaper（DynamicSlide 匯入重構，契約 §5；比照上方 research reaper）：server 重啟後把殘留在
  // queued/running 的簡報轉檔 job 一律標 failed（其背景轉檔已隨舊進程消失）。migrate() 後、接流量前跑一次。
  try {
    const interruptedImports = await core.importJobs.failInterruptedJobs();
    if (interruptedImports > 0) {
      console.log(`[decks] reaper: marked ${interruptedImports} interrupted import job(s) as failed on boot`);
    }
  } catch (e) {
    console.error("[decks] import reaper failed on boot (non-fatal):", e);
  }

  // deck import_status reconcile（契約 §5，緊接 import_jobs reaper）：轉檔為同進程 in-process job，server 重啟後
  // 所有 import_status='processing' 的 deck 都是被中斷的、永不會再收尾 → 標 failed＋人話 import_error。
  // 前端只看 deck.importStatus，若不對帳（只標 job）deck 會永久卡「轉檔中」。跨 org。
  try {
    const interruptedDecks = await core.decks.failInterruptedImports();
    if (interruptedDecks > 0) {
      console.log(`[decks] reaper: reconciled ${interruptedDecks} interrupted deck import(s) to failed on boot`);
    }
  } catch (e) {
    console.error("[decks] deck import reconcile failed on boot (non-fatal):", e);
  }

  // Pricing env overrides (ADMIN_CONTRACT §3.4): fold PRICING__<MODEL>__* into the central PRICING constants
  // once at boot so estimateCostUsd + GET /api/admin/pricing reflect operator calibration.
  const pricingChanged = loadPricingOverrides();
  if (pricingChanged.length > 0) {
    console.log(`[pricing] env overrides applied for: ${pricingChanged.join(", ")}`);
  }

  // TTL purge of persisted transcript segments past their meeting's retention_days (M5 §A): once on boot + daily.
  const retention = startTranscriptRetention(core.db);

  // Cost metering (M5 §B): wraps every LLM/image/embedding call → idempotent usage_event; GET /api/usage rolls up.
  const meter = createMeter(core.usage);

  const app = express();
  const isProd = process.env.NODE_ENV === "production";

  // Behind Caddy in prod (docker-compose): trust exactly one proxy hop so req.ip is the real client
  // (X-Forwarded-For from Caddy), which per-IP rate limiting keys on. In dev there is no proxy, so we
  // do NOT trust XFF (a direct client could otherwise spoof its source IP).
  if (isProd) app.set("trust proxy", 1);

  // Structured request logging first, so every response (incl. health/CORS/errors) is logged once.
  app.use(requestLogger());
  // Security headers on every response (HSTS only when TLS-terminated in prod).
  app.use(securityHeaders({ hsts: isProd }));

  // Per-org + per-IP token bucket for the expensive endpoints (LLM/image/crawl). In-memory (single VM).
  const rateLimiter = new TokenBucketRateLimiter().start();

  // CORS allowlist (ADMIN_CONTRACT §6.1): the product web origin (WEB_ORIGIN) + the admin console origin
  // (ADMIN_ORIGIN) + dev defaults (:3000 web, :3100 admin). Single-value → Set.has() allowlist; all other
  // header behaviour (credentials / methods / allowed headers / OPTIONS 204) is unchanged.
  const ALLOWED_ORIGINS = new Set<string>([
    process.env.WEB_ORIGIN ?? "http://localhost:3000",
    "http://localhost:3000",
    "http://localhost:3100",
    ...(config.adminOrigin ? [config.adminOrigin] : []),
  ]);
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Rate limit the expensive endpoints. Placed BEFORE the body parsers so an over-limit /decks/generate is
  // rejected before its (up to 25mb) body is parsed. authRequired runs here to populate req.auth.orgId for the
  // per-org bucket; it also runs again inside the routers (idempotent). Exact paths only — sub-paths like
  // /train/sessions/:id/finish are intentionally NOT limited. GET polling endpoints are left unlimited.
  const jwtGuard = authRequired(config.jwtSecret);
  // Suspension gate (ADMIN_CONTRACT §2): runs after jwtGuard on the protected product routers below; a
  // suspended org or user → 403. Kept out of health/ready/auth (and /api/usage, per §2's router list).
  const activeGuard = activeAccountRequired(core);
  const limit = rateLimit(rateLimiter);
  app.post("/api/decks/generate", jwtGuard, limit);
  app.post("/api/decks/:id/image-jobs", jwtGuard, limit);
  app.post("/api/research/enrich", jwtGuard, limit);
  app.post("/api/train/sessions", jwtGuard, limit);

  // Multimodal deck generation posts a logo + a few style-ref photos as base64 JSON (a real photo is
  // 1.5–5MB, +33% as base64), which blows past the default 2mb cap → 413. Give ONLY this route a higher
  // cap; body-parser marks req._body after parsing, so the global 2mb parser below skips the already-parsed
  // body. Every other route stays at 2mb. (Client also downscales before upload — see DeckWizard.)
  app.use("/api/decks/generate", express.json({ limit: "25mb" }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Readiness: liveness (health) + DB reachable. A trivial SELECT 1 proves the SQLite connection answers.
  app.get("/api/ready", async (_req, res) => {
    try {
      await core.db.get("SELECT 1 AS ok", []);
      res.json({ ready: true });
    } catch {
      res.status(503).json({ ready: false });
    }
  });

  app.use(
    "/api/auth",
    createAuthRouter(core, config.jwtSecret, {
      googleClientId: config.googleClientId,
      platformAdminEmails: config.platformAdminEmails,
    }),
  );

  // CRM routes (API_CONTRACT §2) — Bearer token + active-account gate (§2); tenant scope from req.auth.orgId.
  app.use("/api/crm", jwtGuard, activeGuard, createCrmRouter(core));

  // Research engine (API_CONTRACT §3) — Bearer + active-account gate at the mount (router re-checks auth).
  app.use("/api/research", jwtGuard, activeGuard, createResearchRouter(core, config, config.jwtSecret, {}, meter));

  // Usage rollup (M5 §B) — Bearer auth inside the router; org-scoped cost/usage reporting. (§2 omits usage.)
  app.use("/api/usage", createUsageRouter(core, config.jwtSecret));

  // Train / voice simulation (API_CONTRACT §7) — Bearer + active-account gate; ephemeral Live token minted here,
  // but voice audio goes browser-direct to Gemini Live (never through this server). meter → gemini_live billing.
  app.use("/api/train", jwtGuard, activeGuard, createTrainRouter(core, config, config.jwtSecret, {}, meter));

  // Org / invite-based membership (API_CONTRACT §D) — Bearer + active-account gate; owner/admin gate per-route.
  app.use("/api/org", jwtGuard, activeGuard, createOrgRouter(core, config.jwtSecret));

  // Platform admin console (ADMIN_CONTRACT §4) — mounted BEFORE the generic /api catch-all so /api/admin/* is
  // handled by platformAdminRequired (A1), not the decks router. Cross-org; no active-account gate (admins
  // manage suspended accounts). Its own middleware enforces admin-only.
  app.use("/api/admin", createAdminRouter(core, config));

  // Meetings + realtime copilot (API_CONTRACT §5/§6). The RealtimeHub is the per-process orchestration center
  // (session registry, ASR/analysis/orchestrator wiring, I1/I2/I3 enforcement); shared by the HTTP router and WS.
  const realtimeHub = new RealtimeHub(core, config, createGeminiClient(config.gemini), meter);
  app.use("/api/meetings", jwtGuard, activeGuard, createMeetingsRouter(realtimeHub, core, config.jwtSecret, config.port));

  // Asset streaming (DynamicSlide 匯入原始頁圖，契約 §3): GET /api/decks/:id/assets/:assetId?exp=&sig=
  // **純簽章授權、NO Bearer**（<img> 帶不了 Authorization header）——必須掛在 jwtGuard 之前，否則 401。
  // 只註冊該單一 GET；其餘 /api 路徑一律 next() 落到下方 authRequired 區段（含 GET /decks/:id 本身）。
  app.use("/api", createDeckAssetsRouter(core));

  // Decks / DynamicSlide (API_CONTRACT §4): /decks/*, /image-jobs/:id, /extract-url, /extract-pdf.
  // Bearer auth here; tenant scope from req.auth.orgId. Disjoint paths from the routers above.
  app.use("/api", jwtGuard, activeGuard, createDecksRouter(core, config, meter));

  // 404 for unmatched /api routes (keep {error} contract instead of Express default HTML).
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  // Error middleware: normalize everything (incl. body-parser 413 / JSON parse) to {error:string}.
  app.use(
    (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (res.headersSent) {
        next(err);
        return;
      }
      const e = err as { type?: string; status?: number; statusCode?: number; message?: string };
      const status =
        e?.type === "entity.too.large" ? 413 : e?.status ?? e?.statusCode ?? 400;
      const message =
        e?.type === "entity.too.large"
          ? "request body too large"
          : e?.message ?? "request could not be processed";
      res.status(status).json({ error: message });
    },
  );

  const server = http.createServer(app);
  const wss = attachRealtimeWs(server, realtimeHub, config.jwtSecret, core);

  server.listen(config.port, () => {
    console.log(`[server] listening on :${config.port}`);
  });

  // Graceful shutdown: stop accepting new work, tear down live sessions + sockets, close DB, then exit.
  // Idempotent (a second signal is ignored); a hard-timeout fallback forces exit if a handle refuses to close.
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received — shutting down gracefully`);
    const forceExit = setTimeout(() => {
      console.error("[server] forced exit after shutdown timeout");
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    retention.stop(); // stop the daily TTL purge timer
    server.close(() => {
      rateLimiter.dispose();
      core.close();
      console.log("[server] shutdown complete");
      process.exit(0);
    });
    wss.close(); // stop accepting new ws connections
    realtimeHub.disposeAll(); // dispose all SessionRuntimes + close live sockets (unblocks server.close)
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[server] fatal boot error:", err);
  process.exit(1);
});
