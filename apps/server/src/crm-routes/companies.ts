/**
 * Company routes (API_CONTRACT §2 — 公司).
 *   GET    /companies?query=&status=&page=&pageSize=  → {items:CompanySummary[], total}
 *   POST   /companies  {name, domain?, websiteUrl?}   → 201 Company
 *   GET    /companies/:id                             → Company + counts
 *   PATCH  /companies/:id  {...partial}               → Company (細填: repo writes filled_by='human' provenance)
 *   DELETE /companies/:id                             → 204
 *   GET    /companies/:id/{news,locations,funding,tech,departments} → child arrays
 * All org-scoped from req.auth.orgId.
 */
import type { Router, Request } from "express";
import type { CrmCore } from "@meetcopilot/crm";
import type { Company, NewCompany } from "@meetcopilot/shared";
import { asyncHandler, orgId, userId, str, parsePage, notFound, badRequest, sanitize, param } from "./helpers.js";

export function registerCompanyRoutes(router: Router, core: CrmCore): void {
  // ── list ──
  router.get(
    "/companies",
    asyncHandler(async (req, res) => {
      const filter = { query: str(req.query.query), status: str(req.query.status) };
      const result = await core.companies.list(orgId(req), filter, parsePage(req));
      res.json(result);
    }),
  );

  // ── create ──
  router.post(
    "/companies",
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const name = str(body.name);
      if (!name) {
        badRequest(res, "name is required");
        return;
      }
      const input: NewCompany = { ...sanitize<NewCompany>(body), name };
      const company = await core.companies.create(orgId(req), input);
      res.status(201).json(company);
    }),
  );

  // ── detail (+ counts) ──
  router.get(
    "/companies/:id",
    asyncHandler(async (req, res) => {
      const oid = orgId(req);
      const company = await core.companies.findById(oid, param(req, "id"));
      if (!company) {
        notFound(res, "company not found");
        return;
      }
      const counts = await core.companies.counts(oid, param(req, "id"));
      res.json({ ...company, counts });
    }),
  );

  // ── 細填 (human overwrite → provenance) ──
  router.patch(
    "/companies/:id",
    asyncHandler(async (req, res) => {
      const oid = orgId(req);
      const existing = await core.companies.findById(oid, param(req, "id"));
      if (!existing) {
        notFound(res, "company not found");
        return;
      }
      const patch = sanitize<Company>(req.body);
      const company = await core.companies.update(oid, param(req, "id"), patch, { userId: userId(req) });
      res.json(company);
    }),
  );

  // ── delete ──
  router.delete(
    "/companies/:id",
    asyncHandler(async (req, res) => {
      const oid = orgId(req);
      const existing = await core.companies.findById(oid, param(req, "id"));
      if (!existing) {
        notFound(res, "company not found");
        return;
      }
      await core.companies.delete(oid, param(req, "id"));
      res.status(204).end();
    }),
  );

  // ── children (org-scoped arrays; empty [] if company absent/foreign) ──
  const cid = (req: Request): string => param(req, "id");
  router.get(
    "/companies/:id/news",
    asyncHandler(async (req, res) => {
      res.json(await core.companyChildren.listNews(orgId(req), cid(req)));
    }),
  );
  router.get(
    "/companies/:id/locations",
    asyncHandler(async (req, res) => {
      res.json(await core.companyChildren.listLocations(orgId(req), cid(req)));
    }),
  );
  router.get(
    "/companies/:id/funding",
    asyncHandler(async (req, res) => {
      res.json(await core.companyChildren.listFunding(orgId(req), cid(req)));
    }),
  );
  router.get(
    "/companies/:id/tech",
    asyncHandler(async (req, res) => {
      res.json(await core.companyChildren.listTech(orgId(req), cid(req)));
    }),
  );
  router.get(
    "/companies/:id/departments",
    asyncHandler(async (req, res) => {
      res.json(await core.companyChildren.listDepartments(orgId(req), cid(req)));
    }),
  );
}
