/**
 * Deal routes (API_CONTRACT §2 — 商機).
 *   GET    /deals?companyId=&stage=&status=&page=&pageSize= → {items:Deal[], total}
 *   POST   /deals  {name, companyId, ...}   → 201 Deal
 *   GET    /deals/:id                        → Deal
 *   PATCH  /deals/:id  {...partial}          → Deal (細填)
 *   DELETE /deals/:id                        → 204
 *   GET    /deals/:id/contacts               → DealContact[] (buying committee)
 *   POST   /deals/:id/contacts {contactId, role?, stance?, influence?, notes?} → 201 DealContact
 */
import type { Router } from "express";
import type { CrmCore, DealFilter } from "@meetcopilot/crm";
import type {
  Deal,
  NewDeal,
  NewDealContact,
  DealStatus,
  DecisionPower,
  DealContactStance,
} from "@meetcopilot/shared";
import { asyncHandler, orgId, userId, str, parsePage, notFound, badRequest, sanitize, isOneOf, param } from "./helpers.js";

const DEAL_STATUSES: readonly DealStatus[] = ["open", "won", "lost"];
const DECISION_POWERS: readonly DecisionPower[] = [
  "economic_buyer",
  "champion",
  "influencer",
  "gatekeeper",
  "user",
  "blocker",
  "unknown",
];
const DEAL_CONTACT_STANCES: readonly DealContactStance[] = ["supporter", "neutral", "detractor"];

export function registerDealRoutes(router: Router, core: CrmCore): void {
  router.get(
    "/deals",
    asyncHandler(async (req, res) => {
      const filter: DealFilter = {
        companyId: str(req.query.companyId),
        stage: str(req.query.stage),
      };
      const status = req.query.status;
      if (isOneOf(status, DEAL_STATUSES)) filter.status = status;
      const result = await core.deals.list(orgId(req), filter, parsePage(req));
      res.json(result);
    }),
  );

  router.post(
    "/deals",
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const name = str(body.name);
      const companyId = str(body.companyId);
      if (!name) {
        badRequest(res, "name is required");
        return;
      }
      if (!companyId) {
        badRequest(res, "companyId is required");
        return;
      }
      const input: NewDeal = { ...sanitize<NewDeal>(body), name, companyId };
      const deal = await core.deals.create(orgId(req), input);
      res.status(201).json(deal);
    }),
  );

  router.get(
    "/deals/:id",
    asyncHandler(async (req, res) => {
      const deal = await core.deals.findById(orgId(req), param(req, "id"));
      if (!deal) {
        notFound(res, "deal not found");
        return;
      }
      res.json(deal);
    }),
  );

  router.patch(
    "/deals/:id",
    asyncHandler(async (req, res) => {
      const oid = orgId(req);
      const existing = await core.deals.findById(oid, param(req, "id"));
      if (!existing) {
        notFound(res, "deal not found");
        return;
      }
      const patch = sanitize<Deal>(req.body);
      const deal = await core.deals.update(oid, param(req, "id"), patch, { userId: userId(req) });
      res.json(deal);
    }),
  );

  router.delete(
    "/deals/:id",
    asyncHandler(async (req, res) => {
      const oid = orgId(req);
      const existing = await core.deals.findById(oid, param(req, "id"));
      if (!existing) {
        notFound(res, "deal not found");
        return;
      }
      await core.deals.delete(oid, param(req, "id"));
      res.status(204).end();
    }),
  );

  // ── buying committee join ──
  router.get(
    "/deals/:id/contacts",
    asyncHandler(async (req, res) => {
      res.json(await core.deals.listContacts(orgId(req), param(req, "id")));
    }),
  );

  router.post(
    "/deals/:id/contacts",
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const contactId = str(body.contactId);
      if (!contactId) {
        badRequest(res, "contactId is required");
        return;
      }
      const role = body.role;
      const stance = body.stance;
      if (role !== undefined && !isOneOf(role, DECISION_POWERS)) {
        badRequest(res, "role must be one of: " + DECISION_POWERS.join(", "));
        return;
      }
      if (stance !== undefined && !isOneOf(stance, DEAL_CONTACT_STANCES)) {
        badRequest(res, "stance must be one of: " + DEAL_CONTACT_STANCES.join(", "));
        return;
      }
      const input: NewDealContact = {
        contactId,
        role: isOneOf(role, DECISION_POWERS) ? role : undefined,
        stance: isOneOf(stance, DEAL_CONTACT_STANCES) ? stance : undefined,
        influence: typeof body.influence === "number" ? body.influence : undefined,
        notes: str(body.notes),
      };
      const dealContact = await core.deals.addContact(orgId(req), param(req, "id"), input);
      res.status(201).json(dealContact);
    }),
  );
}
