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
import { createCrmRouter } from "./crm-routes/index.js";
import { createResearchRouter } from "./research/routes.js";
import { createTrainRouter } from "./train/routes.js";
import { createGeminiClient } from "./gemini.js";
import { RealtimeHub } from "./realtime/hub.js";
import { attachRealtimeWs } from "./realtime/ws-server.js";
import { createMeetingsRouter } from "./realtime/meetings-routes.js";
import { startTranscriptRetention } from "./realtime/transcript-retention.js";
import { createDecksRouter } from "./decks-routes/index.js";
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

  // Minimal dev CORS: allow the Next.js dev origin. (Prod origin handling revisited at deploy time.)
  const ALLOWED_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin === ALLOWED_ORIGIN) {
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

  app.use("/api/auth", createAuthRouter(core, config.jwtSecret, { googleClientId: config.googleClientId }));

  // CRM routes (API_CONTRACT §2) — all require a valid Bearer token; tenant scope from req.auth.orgId.
  app.use("/api/crm", authRequired(config.jwtSecret), createCrmRouter(core));

  // Research engine (API_CONTRACT §3) — Bearer auth applied inside the router; tenant scope from req.auth.orgId.
  app.use("/api/research", createResearchRouter(core, config, config.jwtSecret, {}, meter));

  // Usage rollup (M5 §B) — Bearer auth inside the router; org-scoped cost/usage reporting.
  app.use("/api/usage", createUsageRouter(core, config.jwtSecret));

  // Train / voice simulation (API_CONTRACT §7) — Bearer auth inside the router; ephemeral Live token minted here,
  // but voice audio goes browser-direct to Gemini Live (never through this server).
  app.use("/api/train", createTrainRouter(core, config, config.jwtSecret));

  // Org / invite-based membership (API_CONTRACT §D) — Bearer auth inside the router; owner/admin gate
  // per-route (except accept). Invite accept resolves the org from the invite token, never from req.auth.orgId.
  app.use("/api/org", createOrgRouter(core, config.jwtSecret));

  // Meetings + realtime copilot (API_CONTRACT §5/§6). The RealtimeHub is the per-process orchestration center
  // (session registry, ASR/analysis/orchestrator wiring, I1/I2/I3 enforcement); shared by the HTTP router and WS.
  const realtimeHub = new RealtimeHub(core, config, createGeminiClient(config.gemini), meter);
  app.use("/api/meetings", createMeetingsRouter(realtimeHub, core, config.jwtSecret, config.port));

  // Decks / DynamicSlide (API_CONTRACT §4): /decks/*, /image-jobs/:id, /extract-url, /extract-pdf.
  // Bearer auth here; tenant scope from req.auth.orgId. Disjoint paths from the routers above.
  app.use("/api", authRequired(config.jwtSecret), createDecksRouter(core, config, meter));

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
  const wss = attachRealtimeWs(server, realtimeHub, config.jwtSecret);

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
