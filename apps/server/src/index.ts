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
import { attachWs } from "./ws.js";

async function main(): Promise<void> {
  const config = loadConfig(); // exits(1) on missing/placeholder JWT_SECRET

  // Non-fatal guard: async analysis callbacks (M3) must not tear down the process.
  process.on("unhandledRejection", (err) => {
    console.error("[unhandledRejection]", err);
  });

  const core = await initCrm(config.dbPath);
  await core.migrate();

  const app = express();

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

  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/auth", createAuthRouter(core, config.jwtSecret));

  // CRM routes (API_CONTRACT §2) — all require a valid Bearer token; tenant scope from req.auth.orgId.
  app.use("/api/crm", authRequired(config.jwtSecret), createCrmRouter(core));

  // Research engine (API_CONTRACT §3) — Bearer auth applied inside the router; tenant scope from req.auth.orgId.
  app.use("/api/research", createResearchRouter(core, config, config.jwtSecret));

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
  attachWs(server);

  server.listen(config.port, () => {
    console.log(`[server] listening on :${config.port}`);
  });
}

main().catch((err) => {
  console.error("[server] fatal boot error:", err);
  process.exit(1);
});
