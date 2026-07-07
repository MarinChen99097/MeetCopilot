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

/** Signature A2 commits to (ports.ts trailing comment): `createCrmCore(dbPath): Promise<CrmCore>`. */
type CreateCrmCore = (dbPath: string) => Promise<CrmCore>;

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
  return mod.createCrmCore(dbPath);
}
