/**
 * CRM retrieval for the copilot (CRM_SCHEMA §9). Signals → query → embedding → org-scoped, entity-whitelisted
 * vector search → info_card(s) for the HUD (I3: hud only; never /present).
 *
 * Whitelist (the "only talk about the counterpart company" guarantee): search is restricted to THIS meeting's
 * entities — the company, its contacts, and the deal. Tenant scoping (org_id) is always enforced inside the
 * EmbeddingRepository. The seller's own product_cards (an additive UNION in §9) are deferred; tightening to the
 * meeting's entities never leaks unrelated CRM rows, which is the safe direction for a live-on-screen copilot.
 *
 * Trust rule (§9): a CRM-derived card is 'verified' iff its source entity has human provenance (filled_by='human'
 * or verified=1). The embedding entity_type is a *_card alias, so resolveTrust maps it to the base field_provenance
 * entity_type (company_card→company, contact_card→contact, company_product_card→company_product) before the lookup;
 * sources that never write provenance (news/note) stay 'crawler'. Grounding results (deep_research) are 'live'.
 */
import type { CrmCore } from "@meetcopilot/crm";
import { isTrusted } from "@meetcopilot/shared";
import type { InfoCard, InfoCardKind, InfoCardTrust, SignalItem } from "@meetcopilot/shared";
import type { GeminiClient } from "../gemini.js";
import type { Meter } from "../ops/meter.js";
import { meteredGeminiClient } from "../ops/metered-gemini.js";
import { randomUUID } from "node:crypto";
import { withDeadline } from "./util.js";

const EMBED_DEADLINE_MS = 12_000;
const TOP_K = 3;
const CARD_BODY_MAX = 400;
/** Cosine floor for surfacing a CRM card (§4.2 「similarity 過門檻取 top3」；below this = noise, dropped). */
const SIMILARITY_MIN = 0.5;
/** Cap on the recent-transcript context folded into the retrieval query (chars; keeps the embed input bounded). */
const CONTEXT_QUERY_MAX = 600;

export interface MeetingContext {
  orgId: string;
  companyId?: string;
  dealId?: string;
  /** 歸屬會議（計費 usage_event.meeting_id）。 */
  meetingId?: string;
  /** 發起使用者歸屬（ADMIN_CONTRACT §2，可得則帶；會中＝報告者 presenterUserId，拿不到則 undefined）。 */
  userId?: string;
}

/** 每次檢索的可選輸入（§4.2）。 */
export interface RetrievalOptions {
  /** 近期逐字稿要點：與 signal label 併入檢索 query，使檢索跟著即時焦點走。 */
  contextText?: string;
  /**
   * 同場去重集合（`entityType:entityId`）：命中過的實體不再出卡（§4.2「一場會議同一實體只出一次卡」）。
   * 呼叫端（orchestrator）跨分析窗持有並傳入；本函式就地補入新命中，故連續窗口共享同一集合即達成整場去重。
   */
  seen?: Set<string>;
  /**
   * 預先算好的白名單 entityIds（§4.2）：呼叫端（orchestrator）per-session 快取整場靜態白名單，
   * 免每個分析窗重跑 collectWhitelist 的多筆 org-scoped 讀。未提供→本函式自行 collectWhitelist（獨立呼叫/單測路徑）。
   */
  entityIds?: string[];
}

function kindOf(entityType: string): InfoCardKind {
  const t = entityType.toLowerCase();
  // product/deal → battlecard；contact → contact；news/note/company → company（都是對方公司情報）；其餘 → research。
  // 檢查次序把 `company_product` 這類複合前綴導向正確類（避免被 `company` 前綴誤吞為 company）。
  if (t.includes("product") || t.includes("deal")) return "battlecard";
  if (t.includes("contact")) return "contact";
  if (t.includes("news") || t.includes("note") || t.includes("company")) return "company";
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

/** Query = signal labels + recent transcript points (§4.2), so retrieval tracks the live focus. */
function buildQuery(signals: SignalItem[], contextText?: string): string {
  const labels = queryFromSignals(signals);
  const ctx = (contextText ?? "").trim().slice(-CONTEXT_QUERY_MAX);
  return [labels, ctx].filter(Boolean).join(" ; ").trim();
}

/**
 * Whitelist (§4.2): this meeting's company + its contacts + notes + products + news + the deal. Every id comes
 * from an org-scoped repo read (org isolation enforced inside each repo), so no cross-org id can enter; the
 * EmbeddingRepository additionally re-enforces org_id, so even a smuggled foreign id can never produce a hit.
 *
 * `contactIds` 若提供（呼叫端已持有該公司聯絡人，如 orchestrator 的 per-session 快取）→ 直接沿用、省去重複的
 * contacts.list 讀；未提供則自行讀（獨立呼叫/單測路徑）。其餘子清單（notes/products/news）照舊 org-scoped 讀。
 */
export async function collectWhitelist(core: CrmCore, ctx: MeetingContext, contactIds?: string[]): Promise<string[]> {
  const ids: string[] = [];
  const companyId = ctx.companyId;
  if (companyId) {
    ids.push(companyId);
    if (contactIds) for (const id of contactIds) ids.push(id);
    else await pushIds(ids, async () => (await core.contacts.list(ctx.orgId, companyId)).map((c) => c.id));
    await pushIds(ids, async () => (await core.notes.list(ctx.orgId, "company", companyId)).map((n) => n.id));
    await pushIds(ids, async () => (await core.companyProducts.list(ctx.orgId, companyId)).map((p) => p.id));
    await pushIds(ids, async () => (await core.companyChildren.listNews(ctx.orgId, companyId)).map((n) => n.id));
  }
  if (ctx.dealId) ids.push(ctx.dealId);
  return ids;
}

/** Append ids from an org-scoped child list; each list is optional (a stub/empty repo must not break retrieval). */
async function pushIds(target: string[], get: () => Promise<string[]>): Promise<void> {
  try {
    for (const id of await get()) target.push(id);
  } catch {
    /* optional child list */
  }
}

/**
 * embedding 命中列的 entity_type（*_card 別名，由 research/indexer.ts collectSources 寫入）→ field_provenance 的
 * **基底** entity_type 對映。provenance 以基底型別記錄（repos-prospect.ts：company/contact；company_products.update()：
 * company_product），故 resolveTrust 必須先對映再查——否則 card 別名做 exact-match 永遠 0 列，人工驗證過的資料在會中
 * 卡片永遠顯示 crawler（此 finding 之修法）。null＝該來源型別**從不寫 provenance**（company_news 子表與 note 皆無）
 * → 直接 crawler，不查。對映表未列的 entity_type（理論上不會出現）沿用原值直查（基底型別本就相符，維持舊行為）。
 */
const PROVENANCE_BASE_TYPE: Record<string, string | null> = {
  company_card: "company",
  contact_card: "contact",
  company_product_card: "company_product",
  company_news: null,
  note: null,
};

function provenanceTypeFor(entityType: string): string | null {
  // key 命中 → 回對映值（null＝無 provenance）；未列 → 原值直查（?? null 僅為滿足嚴格索引型別，key 存在時不會是 undefined）。
  return entityType in PROVENANCE_BASE_TYPE ? PROVENANCE_BASE_TYPE[entityType] ?? null : entityType;
}

/**
 * Trust for a CRM-derived card (§4.2): if any field of the source entity has human provenance
 * (filled_by='human' or verified=1, via shared isTrusted) → 'verified'; otherwise crawler/LLM value → 'crawler'.
 * Best-effort: an entity whose (mapped) provenance type has no matching rows falls back to 'crawler'.
 */
async function resolveTrust(
  core: CrmCore,
  orgId: string,
  entityType: string,
  entityId: string,
): Promise<InfoCardTrust> {
  const provType = provenanceTypeFor(entityType);
  if (!provType) return "crawler"; // 該來源型別無 provenance（news/note）→ 誠實標 crawler
  try {
    const rows = await core.provenance.listForEntity(orgId, provType, entityId);
    return rows.some((r) => isTrusted({ filledBy: r.filledBy, verified: r.verified })) ? "verified" : "crawler";
  } catch {
    return "crawler";
  }
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
  opts: RetrievalOptions = {},
): Promise<InfoCard[]> {
  const query = buildQuery(signals, opts.contextText);
  if (!query || !deps.gemini.isConfigured()) return [];
  if (!ctx.companyId && !ctx.dealId) return []; // no counterpart context → nothing safe to retrieve

  try {
    const entityIds = opts.entityIds ?? (await collectWhitelist(deps.core, ctx));
    if (entityIds.length === 0) return [];

    // 計費（M5 §B）：有 meter 就現包 metered client，query embedding 記為 embedding（歸屬 meetingId）。
    const embedClient =
      deps.meter && ctx.meetingId
        ? meteredGeminiClient(deps.gemini, deps.meter, {
            orgId: ctx.orgId,
            kind: "embedding",
            meetingId: ctx.meetingId,
            userId: ctx.userId,
            idemPrefix: `retr:${randomUUID()}`,
          })
        : deps.gemini;
    const queryVec = await withDeadline(embedClient.embed(query), EMBED_DEADLINE_MS, "retrieval.embed");
    const hits = await deps.core.embeddings.search(ctx.orgId, queryVec, { entityIds }, TOP_K);

    const seen = opts.seen;
    // 先序列做 score 過門檻＋同場去重（seen 依 hits 序就地變異，保跨窗語意）取存活者；
    // 再對存活者平行查 trust（上限 TOP_K=3，安全）；最後依存活序建卡（順序/輸出與序列版逐一致）。
    const survivors: typeof hits = [];
    for (const h of hits) {
      if (h.score < SIMILARITY_MIN) continue; // below the similarity floor → drop (noise)
      const key = `${h.entityType}:${h.entityId}`;
      if (seen?.has(key)) continue; // 同場同 entity 去重（一場會議同一實體只出一次卡）
      seen?.add(key);
      survivors.push(h);
    }
    const trusts = await Promise.all(
      survivors.map((h) => resolveTrust(deps.core, ctx.orgId, h.entityType, h.entityId)),
    );
    return survivors.map((h, i) => ({
      id: randomUUID(),
      kind: kindOf(h.entityType),
      title: cardTitle(h.entityType),
      body: h.content.slice(0, CARD_BODY_MAX),
      confidence: h.score,
      trust: trusts[i]!,
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
