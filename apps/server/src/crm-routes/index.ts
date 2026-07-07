/**
 * CRM router factory (API_CONTRACT §2). Mounted at /api/crm behind authRequired (see src/index.ts),
 * so every handler has req.auth and is tenant-scoped from req.auth.orgId — the frontend never sends orgId.
 * Routes are registered onto a single Router by resource module; paths are disjoint so registration order
 * is irrelevant. Handlers call the frozen CrmCore repos (B1 implements at runtime).
 */
import { Router } from "express";
import type { CrmCore } from "@meetcopilot/crm";
import { registerCompanyRoutes } from "./companies.js";
import { registerContactRoutes } from "./contacts.js";
import { registerProductRoutes } from "./products.js";
import { registerDealRoutes } from "./deals.js";
import { registerNoteRoutes } from "./notes.js";
import { registerProvenanceRoutes } from "./provenance.js";

export function createCrmRouter(core: CrmCore): Router {
  const router = Router();
  registerCompanyRoutes(router, core);
  registerContactRoutes(router, core);
  registerProductRoutes(router, core);
  registerDealRoutes(router, core);
  registerNoteRoutes(router, core);
  registerProvenanceRoutes(router, core);
  return router;
}
