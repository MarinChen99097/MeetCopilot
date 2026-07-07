/**
 * CRM retrieval for the copilot (CRM_SCHEMA §9). Signals → query → embedding → org-scoped, entity-whitelisted
 * vector search → info_card(s) for the HUD (I3: hud only; never /present).
 *
 * Whitelist (the "only talk about the counterpart company" guarantee): search is restricted to THIS meeting's
 * entities — the company, its contacts, and the deal. Tenant scoping (org_id) is always enforced inside the
 * EmbeddingRepository. The seller's own product_cards (an additive UNION in §9) are deferred; tightening to the
 * meeting's entities never leaks unrelated CRM rows, which is the safe direction for a live-on-screen copilot.
 *
 * Trust rule (§9): embedding rows do not carry per-field provenance, so CRM-derived cards are marked 'crawler'
 * (honest, not overclaimed). Grounding results (deep_research) are marked 'live' by the orchestrator.
 */
import type { CrmCore } from "@meetcopilot/crm";
import type { InfoCard, InfoCardKind, SignalItem } from "@meetcopilot/shared";
import type { GeminiClient } from "../gemini.js";
import type { Meter } from "../ops/meter.js";
import { meteredGeminiClient } from "../ops/metered-gemini.js";
import { randomUUID } from "node:crypto";
import { withDeadline } from "./util.js";

const EMBED_DEADLINE_MS = 12_000;
const TOP_K = 3;
const CARD_BODY_MAX = 400;

export interface MeetingContext {
  orgId: string;
  companyId?: string;
  dealId?: string;
  /** 歸屬會議（計費 usage_event.meeting_id）。 */
  meetingId?: string;
}

function kindOf(entityType: string): InfoCardKind {
  if (entityType.startsWith("contact")) return "contact";
  if (entityType.startsWith("company")) return "company";
  if (entityType.startsWith("deal") || entityType.includes("product")) return "battlecard";
  return "research";
}

/** Build the query string from the current signals (labels are already short human phrases). */
function queryFromSignals(signals: SignalItem[]): string {
  return signals
    .map((s) => s.label)
    .filter(Boolean)
    .join(" ; ")
    .trim();
}

export interface RetrievalDeps {
  core: CrmCore;
  gemini: GeminiClient;
  /** 計費（M5 §B，可選）：query embedding 記為 embedding，歸屬本場 meetingId。 */
  meter?: Meter;
}

/**
 * Produce info_cards for a signals batch. Best-effort and fully guarded: a missing embedding, an empty index,
 * or an unconfigured Gemini yields `[]` — it never throws into the async signal path (unhandledRejection safe).
 */
export async function retrieveInfoCards(
  deps: RetrievalDeps,
  ctx: MeetingContext,
  signals: SignalItem[],
): Promise<InfoCard[]> {
  const query = queryFromSignals(signals);
  if (!query || !deps.gemini.isConfigured()) return [];
  if (!ctx.companyId && !ctx.dealId) return []; // no counterpart context → nothing safe to retrieve

  try {
    // Entity whitelist: this meeting's company + its contacts + the deal.
    const entityIds: string[] = [];
    if (ctx.companyId) {
      entityIds.push(ctx.companyId);
      try {
        const contacts = await deps.core.contacts.list(ctx.orgId, ctx.companyId);
        for (const c of contacts) entityIds.push(c.id);
      } catch {
        /* contacts optional */
      }
    }
    if (ctx.dealId) entityIds.push(ctx.dealId);
    if (entityIds.length === 0) return [];

    // 計費（M5 §B）：有 meter 就現包 metered client，query embedding 記為 embedding（歸屬 meetingId）。
    const embedClient =
      deps.meter && ctx.meetingId
        ? meteredGeminiClient(deps.gemini, deps.meter, {
            orgId: ctx.orgId,
            kind: "embedding",
            meetingId: ctx.meetingId,
            idemPrefix: `retr:${randomUUID()}`,
          })
        : deps.gemini;
    const queryVec = await withDeadline(embedClient.embed(query), EMBED_DEADLINE_MS, "retrieval.embed");
    const hits = await deps.core.embeddings.search(ctx.orgId, queryVec, { entityIds }, TOP_K);

    return hits.map((h) => ({
      id: randomUUID(),
      kind: kindOf(h.entityType),
      title: cardTitle(h.entityType),
      body: h.content.slice(0, CARD_BODY_MAX),
      confidence: h.score,
      trust: "crawler" as const,
    }));
  } catch (err) {
    console.warn(`[retrieval] failed (org=${ctx.orgId}): ${(err as Error).message}`);
    return [];
  }
}

function cardTitle(entityType: string): string {
  switch (kindOf(entityType)) {
    case "contact":
      return "聯絡人情報";
    case "company":
      return "公司情報";
    case "battlecard":
      return "商機／產品情報";
    default:
      return "相關資訊";
  }
}
