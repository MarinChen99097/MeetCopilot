/**
 * Meeting-signal → CRM writeback (the PRODUCT_SPEC flywheel; CRM_SCHEMA §7).
 *
 * Asserts the seam end-to-end over a real in-memory CrmCore:
 *  1. Approving an `objection` signal APPENDS the human-approved item to contact.objectionsRaised AND writes a
 *     field_provenance row with filled_by='human', source_type='meeting', source_detail=<meetingId>, verified=1.
 *  2. A cross-org writeback (org B → org A's meeting/signal) is rejected 404 and mutates nothing in org A.
 *  3. A non-allowlisted field is rejected 400.
 */
import { describe, it, expect } from "vitest";
import { createCrmCore } from "@meetcopilot/crm";
import type { CrmCore } from "@meetcopilot/crm";
import { MeetingStore } from "./meeting-store.js";
import { MeetingWritebackService } from "./writeback-service.js";

describe("meeting-signal → CRM writeback (CRM_SCHEMA §7)", () => {
  it("approves an objection signal → contact.objectionsRaised gains the item + human/meeting provenance", async () => {
    const core: CrmCore = await createCrmCore(":memory:");
    try {
      await core.migrate();
      const org = await core.orgs.create({ name: "Org A" });
      const company = await core.companies.create(org.id, { name: "Acme" });
      const contact = await core.contacts.create(org.id, company.id, { fullName: "Dana Buyer" });

      const store = new MeetingStore(core.db);
      const meeting = await store.create(org.id, {
        title: "Discovery",
        presenterUserId: "userA",
        companyId: company.id,
      });
      await store.saveSignal(org.id, meeting.id, {
        id: "sig-1",
        kind: "objection",
        label: "price too high",
        confidence: 0.8,
      });

      const svc = new MeetingWritebackService(core, store);
      const item = {
        objection: "Price too high vs incumbent",
        context: "budget frozen this quarter",
        meetingId: meeting.id,
        status: "open",
      };
      const result = await svc.apply({ orgId: org.id, userId: "userA" }, meeting.id, "sig-1", {
        targetType: "contact",
        targetId: contact.id,
        field: "objectionsRaised",
        value: item,
      });
      expect(result.ok).toBe(true);

      // (a) the approved item was APPENDED to the array field.
      const updated = await core.contacts.findById(org.id, contact.id);
      expect(updated?.objectionsRaised).toContainEqual(item);

      // (b) provenance recorded EXACTLY per §7 (human / meeting / meetingId / verified).
      const prov = await core.db.get<{
        filled_by: string;
        source_type: string;
        source_detail: string;
        verified: number;
      }>(
        `SELECT filled_by, source_type, source_detail, verified FROM field_provenance
         WHERE org_id = ? AND entity_type = 'contact' AND entity_id = ? AND field_name = 'objectionsRaised'
           AND superseded_by IS NULL`,
        [org.id, contact.id],
      );
      expect(prov).toBeDefined();
      expect(prov?.filled_by).toBe("human");
      expect(prov?.source_type).toBe("meeting");
      expect(prov?.source_detail).toBe(meeting.id);
      expect(prov?.verified).toBe(1);
    } finally {
      core.close();
    }
  });

  it("rejects a cross-org writeback (signal owned by another org) with 404 and mutates nothing", async () => {
    const core: CrmCore = await createCrmCore(":memory:");
    try {
      await core.migrate();
      const orgA = await core.orgs.create({ name: "Org A" });
      const orgB = await core.orgs.create({ name: "Org B" });
      const companyA = await core.companies.create(orgA.id, { name: "Acme" });
      const contactA = await core.contacts.create(orgA.id, companyA.id, { fullName: "Dana Buyer" });

      const store = new MeetingStore(core.db);
      const meetingA = await store.create(orgA.id, {
        title: "A's meeting",
        presenterUserId: "userA",
        companyId: companyA.id,
      });
      await store.saveSignal(orgA.id, meetingA.id, {
        id: "sig-A",
        kind: "objection",
        label: "x",
        confidence: 0.5,
      });

      const svc = new MeetingWritebackService(core, store);
      // Org B passes org A's meetingId + signalId (attacker with a valid org-B token).
      const result = await svc.apply({ orgId: orgB.id, userId: "userB" }, meetingA.id, "sig-A", {
        targetType: "contact",
        targetId: contactA.id,
        field: "objectionsRaised",
        value: { objection: "smuggled" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(404);

      // Org A's contact is untouched.
      const c = await core.contacts.findById(orgA.id, contactA.id);
      expect(c?.objectionsRaised ?? []).toHaveLength(0);
    } finally {
      core.close();
    }
  });

  it("rejects a non-allowlisted field with 400", async () => {
    const core: CrmCore = await createCrmCore(":memory:");
    try {
      await core.migrate();
      const org = await core.orgs.create({ name: "Org A" });
      const company = await core.companies.create(org.id, { name: "Acme" });
      const contact = await core.contacts.create(org.id, company.id, { fullName: "Dana Buyer" });

      const store = new MeetingStore(core.db);
      const meeting = await store.create(org.id, {
        title: "Discovery",
        presenterUserId: "userA",
        companyId: company.id,
      });
      await store.saveSignal(org.id, meeting.id, {
        id: "sig-1",
        kind: "objection",
        label: "x",
        confidence: 0.5,
      });

      const svc = new MeetingWritebackService(core, store);
      const result = await svc.apply({ orgId: org.id, userId: "userA" }, meeting.id, "sig-1", {
        // `email` is a real column but NOT in the writeback allowlist → must be rejected.
        targetType: "contact",
        targetId: contact.id,
        field: "email",
        value: "evil@example.com",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
    } finally {
      core.close();
    }
  });
});
