/**
 * Contact routes (API_CONTRACT §2 — 人物).
 *   GET    /companies/:id/contacts        → ContactSummary[]
 *   POST   /companies/:id/contacts {fullName, title?} → 201 Contact
 *   GET    /contacts/:id                  → Contact
 *   PATCH  /contacts/:id  {...partial}    → Contact (細填)
 *   DELETE /contacts/:id                  → 204
 */
import type { Router } from "express";
import type { CrmCore } from "@meetcopilot/crm";
import type { Contact, NewContact } from "@meetcopilot/shared";
import { asyncHandler, orgId, userId, str, notFound, badRequest, sanitize, param } from "./helpers.js";

export function registerContactRoutes(router: Router, core: CrmCore): void {
  router.get(
    "/companies/:id/contacts",
    asyncHandler(async (req, res) => {
      res.json(await core.contacts.list(orgId(req), param(req, "id")));
    }),
  );

  router.post(
    "/companies/:id/contacts",
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const fullName = str(body.fullName);
      if (!fullName) {
        badRequest(res, "fullName is required");
        return;
      }
      const input: NewContact = { ...sanitize<NewContact>(body, ["companyId"]), fullName };
      const contact = await core.contacts.create(orgId(req), param(req, "id"), input);
      res.status(201).json(contact);
    }),
  );

  router.get(
    "/contacts/:id",
    asyncHandler(async (req, res) => {
      const contact = await core.contacts.findById(orgId(req), param(req, "id"));
      if (!contact) {
        notFound(res, "contact not found");
        return;
      }
      res.json(contact);
    }),
  );

  router.patch(
    "/contacts/:id",
    asyncHandler(async (req, res) => {
      const oid = orgId(req);
      const existing = await core.contacts.findById(oid, param(req, "id"));
      if (!existing) {
        notFound(res, "contact not found");
        return;
      }
      const patch = sanitize<Contact>(req.body, ["companyId"]);
      const contact = await core.contacts.update(oid, param(req, "id"), patch, { userId: userId(req) });
      res.json(contact);
    }),
  );

  router.delete(
    "/contacts/:id",
    asyncHandler(async (req, res) => {
      const oid = orgId(req);
      const existing = await core.contacts.findById(oid, param(req, "id"));
      if (!existing) {
        notFound(res, "contact not found");
        return;
      }
      await core.contacts.delete(oid, param(req, "id"));
      res.status(204).end();
    }),
  );
}
