/**
 * Provenance routes (API_CONTRACT §2 — Provenance; "確認/細填" UI data source).
 *   GET  /provenance?entityType=&entityId=            → FieldProvenance[] (per-field latest, un-superseded)
 *   POST /provenance/confirm {entityType, entityId, fieldName} → {ok:true} (該欄 verified=1; value unchanged)
 * NOTE: 細填 (human overwrite) is a PATCH on the entity itself (see companies/contacts/products/deals),
 * not a provenance endpoint — the entity repo.update writes the filled_by='human' provenance row.
 */
import type { Router } from "express";
import type { CrmCore } from "@meetcopilot/crm";
import { asyncHandler, orgId, userId, str, badRequest } from "./helpers.js";

export function registerProvenanceRoutes(router: Router, core: CrmCore): void {
  router.get(
    "/provenance",
    asyncHandler(async (req, res) => {
      const entityType = str(req.query.entityType);
      const entityId = str(req.query.entityId);
      if (!entityType) {
        badRequest(res, "entityType is required");
        return;
      }
      if (!entityId) {
        badRequest(res, "entityId is required");
        return;
      }
      res.json(await core.provenance.listForEntity(orgId(req), entityType, entityId));
    }),
  );

  router.post(
    "/provenance/confirm",
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const entityType = str(body.entityType);
      const entityId = str(body.entityId);
      const fieldName = str(body.fieldName);
      if (!entityType || !entityId || !fieldName) {
        badRequest(res, "entityType, entityId and fieldName are required");
        return;
      }
      await core.provenance.confirm(orgId(req), entityType, entityId, fieldName, {
        userId: userId(req),
      });
      res.json({ ok: true });
    }),
  );
}
