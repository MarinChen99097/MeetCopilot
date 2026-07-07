/**
 * Company-product routes (API_CONTRACT §2 — 對方產品深檔).
 *   GET    /companies/:id/products         → CompanyProduct[]
 *   POST   /companies/:id/products {name,...} → 201 CompanyProduct
 *   GET    /products/:id                    → CompanyProduct
 *   PATCH  /products/:id  {...partial}      → CompanyProduct (細填)
 *   DELETE /products/:id                    → 204
 *   GET    /products/:id/people             → ProductPersonLink[]
 *   POST   /products/:id/people {contactId, role, titleOnProduct?} → 201 CompanyProductPerson
 *   DELETE /products/:id/people  body {contactId} → 204
 */
import type { Router } from "express";
import type { CrmCore } from "@meetcopilot/crm";
import type { CompanyProduct, NewCompanyProduct, NewCompanyProductPerson, ProductPersonRole } from "@meetcopilot/shared";
import { asyncHandler, orgId, userId, str, notFound, badRequest, sanitize, isOneOf, param } from "./helpers.js";

const PRODUCT_PERSON_ROLES: readonly ProductPersonRole[] = [
  "developer",
  "engineer",
  "pm",
  "product_owner",
  "designer",
  "architect",
  "sales",
  "support",
  "exec_sponsor",
  "other",
];

export function registerProductRoutes(router: Router, core: CrmCore): void {
  router.get(
    "/companies/:id/products",
    asyncHandler(async (req, res) => {
      res.json(await core.companyProducts.list(orgId(req), param(req, "id")));
    }),
  );

  router.post(
    "/companies/:id/products",
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const name = str(body.name);
      if (!name) {
        badRequest(res, "name is required");
        return;
      }
      const input: NewCompanyProduct = { ...sanitize<NewCompanyProduct>(body, ["companyId"]), name };
      const product = await core.companyProducts.create(orgId(req), param(req, "id"), input);
      res.status(201).json(product);
    }),
  );

  router.get(
    "/products/:id",
    asyncHandler(async (req, res) => {
      const product = await core.companyProducts.findById(orgId(req), param(req, "id"));
      if (!product) {
        notFound(res, "product not found");
        return;
      }
      res.json(product);
    }),
  );

  router.patch(
    "/products/:id",
    asyncHandler(async (req, res) => {
      const oid = orgId(req);
      const existing = await core.companyProducts.findById(oid, param(req, "id"));
      if (!existing) {
        notFound(res, "product not found");
        return;
      }
      const patch = sanitize<CompanyProduct>(req.body, ["companyId"]);
      const product = await core.companyProducts.update(oid, param(req, "id"), patch, {
        userId: userId(req),
      });
      res.json(product);
    }),
  );

  router.delete(
    "/products/:id",
    asyncHandler(async (req, res) => {
      const oid = orgId(req);
      const existing = await core.companyProducts.findById(oid, param(req, "id"));
      if (!existing) {
        notFound(res, "product not found");
        return;
      }
      await core.companyProducts.delete(oid, param(req, "id"));
      res.status(204).end();
    }),
  );

  // ── product ↔ people join ──
  router.get(
    "/products/:id/people",
    asyncHandler(async (req, res) => {
      res.json(await core.companyProducts.listPeople(orgId(req), param(req, "id")));
    }),
  );

  router.post(
    "/products/:id/people",
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const contactId = str(body.contactId);
      const role = body.role;
      if (!contactId) {
        badRequest(res, "contactId is required");
        return;
      }
      if (!isOneOf(role, PRODUCT_PERSON_ROLES)) {
        badRequest(res, "role must be one of: " + PRODUCT_PERSON_ROLES.join(", "));
        return;
      }
      const input: NewCompanyProductPerson = {
        contactId,
        role,
        titleOnProduct: str(body.titleOnProduct),
      };
      const person = await core.companyProducts.addPerson(orgId(req), param(req, "id"), input);
      res.status(201).json(person);
    }),
  );

  router.delete(
    "/products/:id/people",
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const contactId = str(body.contactId);
      if (!contactId) {
        badRequest(res, "contactId is required");
        return;
      }
      await core.companyProducts.removePerson(orgId(req), param(req, "id"), contactId);
      res.status(204).end();
    }),
  );
}
