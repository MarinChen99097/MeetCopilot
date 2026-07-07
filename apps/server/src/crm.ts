/**
 * CRM core bootstrap.
 *
 * `createCrmCore` is implemented by A2 in packages/crm/src/core.ts and re-exported from the package
 * index once A2 lands (`export * from "./core.js"`). Until then the package only exports the frozen
 * ports (types). To keep apps/server typechecking green against the frozen seam WITHOUT a build-order
 * dependency on A2, we:
 *   - import only the CrmCore *type* statically (exists today in ports.ts), and
 *   - acquire the `createCrmCore` runtime via dynamic import, cast through the frozen signature.
 *
 * Runtime note for A5 integration: this resolves at startup only after A2 has exported createCrmCore.
 * If the package is stale, `initCrm` rejects — surfaced by index.ts as a fatal boot error.
 */
import type { CrmCore } from "@meetcopilot/crm";

/**
 * Signature createCrmCore commits to (packages/crm/src/core.ts): back-compat string overload
 * `createCrmCore(dbPath)` → SQLite; plus options overload `createCrmCore({ driver, connString, dbPath })`.
 * We accept both here so the server can pick Postgres via env (Cloud Run + Cloud SQL) WITHOUT
 * changing the default local-dev SQLite path.
 */
type CrmCoreOptions = {
  driver?: "sqlite" | "pg";
  dbPath?: string;
  connString?: string;
};
type CreateCrmCore = (arg: string | CrmCoreOptions) => Promise<CrmCore>;

export async function initCrm(dbPath: string): Promise<CrmCore> {
  const mod = (await import("@meetcopilot/crm")) as unknown as {
    createCrmCore?: CreateCrmCore;
  };
  if (typeof mod.createCrmCore !== "function") {
    throw new Error(
      "[crm] @meetcopilot/crm does not export createCrmCore yet — A2 (packages/crm/src/core.ts) " +
        "must land and be re-exported from the package index before the server can start.",
    );
  }
  // Driver selection: DB_DRIVER=pg (+ DATABASE_URL) → Postgres/Cloud SQL; otherwise SQLite at dbPath.
  const driver = (process.env.DB_DRIVER ?? "sqlite").trim();
  if (driver === "pg") {
    const connString = (process.env.DATABASE_URL ?? "").trim();
    if (!connString) {
      throw new Error("[crm] DB_DRIVER=pg requires DATABASE_URL to be set.");
    }
    return mod.createCrmCore({ driver: "pg", connString });
  }
  return mod.createCrmCore(dbPath);
}
