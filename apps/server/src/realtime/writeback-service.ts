/**
 * Meeting-signal → CRM writeback service (the PRODUCT_SPEC flywheel: 會後訊號經批准回寫 CRM; CRM_SCHEMA §7).
 *
 * Approval-gated: a human has reviewed a `meeting_signal` and approved a value (possibly edited from the
 * signal's suggestion). We write that value into the target contact/deal field and stamp provenance EXACTLY
 * per CRM_SCHEMA §7 — `filled_by='human'`, `source_type='meeting'`, `source_detail=<meetingId>`, `verified=1`
 * — superseding any prior provenance for that field. ContactRepository / DealRepository `.update()` already
 * write the human provenance in a single tx; we thread `ByUser.sourceType='meeting'` + `sourceDetail=meetingId`
 * so the copilot and trainer can see the value came from a meeting (and the trust rule accepts it: human /
 * verified=1 beats crawler guesses).
 *
 * Field semantics (CRM_SCHEMA §5/§6):
 *  - ARRAY persona fields (objectionsRaised / painPoints / knownPriorities / hotButtons / riskFlags) APPEND the
 *    approved item to the current array (never overwrite the meeting history).
 *  - SCALAR fields (decisionPower / communicationStyle / nextStep / pain) SET the value.
 *  - Any other field is rejected (allowlist → 400) so a writeback can't smuggle a value into an arbitrary column.
 *
 * Everything is org-scoped from req.auth. The signal must belong to the given meeting AND org, and the target
 * entity must exist in the same org — an org can never write back a signal (or into an entity) it doesn't own.
 */
import type { CrmCore } from "@meetcopilot/crm";
import type { Contact, Deal } from "@meetcopilot/shared";
import type { MeetingStore } from "./meeting-store.js";

type FieldKind = "array" | "scalar";

/**
 * Writeback-able fields (CRM_SCHEMA §7 allowlist), keyed by the domain field name — which is also the
 * `field_provenance.field_name` recorded by the repo, so the copilot/trainer query provenance by the same key.
 */
const CONTACT_FIELDS: Record<string, FieldKind> = {
  objectionsRaised: "array",
  painPoints: "array",
  knownPriorities: "array",
  hotButtons: "array",
  decisionPower: "scalar",
  communicationStyle: "scalar",
};
const DEAL_FIELDS: Record<string, FieldKind> = {
  riskFlags: "array",
  nextStep: "scalar",
  pain: "scalar",
};

export interface WritebackInput {
  targetType: "contact" | "deal";
  targetId: string;
  /** Domain field name (camelCase), must be in the per-targetType allowlist above. */
  field: string;
  /** The human-approved value (may be edited from the signal's suggestion). Appended for array fields, set for scalars. */
  value: unknown;
}

export type WritebackResult =
  | { ok: true; target: Contact | Deal }
  | { ok: false; status: 400 | 404; error: string };

export class MeetingWritebackService {
  constructor(
    private readonly core: CrmCore,
    private readonly store: MeetingStore,
  ) {}

  async apply(
    auth: { orgId: string; userId: string },
    meetingId: string,
    signalId: string,
    input: WritebackInput,
  ): Promise<WritebackResult> {
    const { orgId, userId } = auth;
    const { targetType, targetId, field, value } = input;

    // 1) shape + allowlist validation (reject unknown / non-writeback-able fields with 400).
    if (targetType !== "contact" && targetType !== "deal") {
      return { ok: false, status: 400, error: "targetType must be 'contact' or 'deal'" };
    }
    if (typeof targetId !== "string" || targetId.trim().length === 0) {
      return { ok: false, status: 400, error: "targetId is required" };
    }
    if (typeof field !== "string" || field.length === 0) {
      return { ok: false, status: 400, error: "field is required" };
    }
    if (value === undefined || value === null) {
      return { ok: false, status: 400, error: "value is required" };
    }
    const kind = (targetType === "contact" ? CONTACT_FIELDS : DEAL_FIELDS)[field];
    if (!kind) {
      return { ok: false, status: 400, error: `field '${field}' is not writeback-able for ${targetType}` };
    }

    // 2) the meeting must exist in this org (a cross-org meetingId resolves to nothing → 404).
    const meeting = await this.store.findRef(orgId, meetingId);
    if (!meeting) return { ok: false, status: 404, error: "meeting not found" };

    // 3) the signal must belong to this meeting + org (don't let an org write back a signal it doesn't own).
    const signal = await this.store.findSignal(orgId, meetingId, signalId);
    if (!signal) return { ok: false, status: 404, error: "signal not found" };

    // 4) the target entity must exist in this org (also gives us the current array for APPEND).
    //    ByUser overrides the provenance origin → source_type='meeting', source_detail=meetingId (CRM_SCHEMA §7).
    const by = { userId, sourceType: "meeting", sourceDetail: meetingId };
    if (targetType === "contact") {
      const existing = await this.core.contacts.findById(orgId, targetId);
      if (!existing) return { ok: false, status: 404, error: "contact not found" };
      const patch = buildPatch(existing as unknown as Record<string, unknown>, field, kind, value);
      const target = await this.core.contacts.update(orgId, targetId, patch as Partial<Contact>, by);
      return { ok: true, target };
    }
    const existing = await this.core.deals.findById(orgId, targetId);
    if (!existing) return { ok: false, status: 404, error: "deal not found" };
    const patch = buildPatch(existing as unknown as Record<string, unknown>, field, kind, value);
    const target = await this.core.deals.update(orgId, targetId, patch as Partial<Deal>, by);
    return { ok: true, target };
  }
}

/** Build the update patch: APPEND to the current array for array fields, SET for scalar fields. */
function buildPatch(
  existing: Record<string, unknown>,
  field: string,
  kind: FieldKind,
  value: unknown,
): Record<string, unknown> {
  if (kind === "array") {
    const current = Array.isArray(existing[field]) ? (existing[field] as unknown[]) : [];
    return { [field]: [...current, value] };
  }
  return { [field]: value };
}
