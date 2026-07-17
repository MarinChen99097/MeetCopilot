/**
 * 嵌入索引管線（RESEARCH_UPGRADE_CONTRACT §4.1）。生產環境過去**沒有**任何程式碼寫 embeddings（索引空 →
 * 會中檢索永遠回 []）。本模組補上：把一家公司的 CRM 情報切塊、嵌入、冪等 upsert 進 embeddings，供會中檢索消費。
 *
 * entity_type / entity_id 詞彙**對齊** realtime/retrieval.ts（collectWhitelist 以 **entity_id＝來源 row id** 過濾；
 * kindOf 以 entity_type 內含關鍵字歸類）：
 *   company_card(companyId) / contact_card(contact.id) / company_product_card(product.id) /
 *   company_news(news.id) / note(note.id)——與 migration 006 的註解列舉一致。
 *
 * 冪等：embeddings.upsert 以 (org_id, entity_type, entity_id, chunk_index) 為鍵、content_hash 未變即跳過重嵌，
 * 故重跑 buildCompanyIndex **列數不翻倍**（idempotent）。
 */
import { createHash } from "node:crypto";
import type { CrmCore } from "@meetcopilot/crm";
import type { NewEmbedding } from "@meetcopilot/shared";

const CHUNK_CHARS = 1000; // 每 chunk 上限（§4.1「≤約 1000 字元」）

export interface IndexerDeps {
  core: CrmCore;
  /** 已計費（metered）的 embed 函式：text → 向量。缺 → 無法建索引（呼叫端須先確認 Gemini 已設）。 */
  embed: (text: string) => Promise<number[]>;
  /** 嵌入模型 id（寫入 embeddings.model）。 */
  embedModel: string;
}

export interface IndexResult {
  chunks: number;
}

/** sha256 十六進位（content_hash：內容未變即跳過重嵌）。 */
function hashOf(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** 把長文切成 ≤CHUNK_CHARS 的塊（優先在換行/空白邊界切；空字串回 []）。 */
function chunkText(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  if (t.length <= CHUNK_CHARS) return [t];
  const out: string[] = [];
  let rest = t;
  while (rest.length > CHUNK_CHARS) {
    let cut = rest.lastIndexOf("\n", CHUNK_CHARS);
    if (cut < CHUNK_CHARS * 0.6) cut = rest.lastIndexOf(" ", CHUNK_CHARS);
    if (cut < CHUNK_CHARS * 0.6) cut = CHUNK_CHARS;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** 一個待索引來源（一個實體 → 一段文字，會再切塊）。 */
interface IndexSource {
  entityType: string;
  entityId: string;
  content: string;
}

function joinFields(parts: (string | undefined | null)[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p.trim().length > 0).map((p) => p.trim()).join("\n");
}

/** 蒐集一家公司的待索引來源（company_card / contact_card / company_product_card / company_news / note）。 */
async function collectSources(core: CrmCore, orgId: string, companyId: string): Promise<IndexSource[]> {
  const sources: IndexSource[] = [];

  // company_card：公司側 profile（含 description/_zh；narrative note 另以 note 索引）。
  const company = await core.companies.findById(orgId, companyId);
  if (company) {
    const content = joinFields([
      company.name,
      company.industry,
      company.tagline,
      company.description,
      company.descriptionZh,
      company.recentNewsSummary,
    ]);
    if (content) sources.push({ entityType: "company_card", entityId: companyId, content });
  }

  // contacts
  try {
    for (const c of await core.contacts.list(orgId, companyId)) {
      const full = await core.contacts.findById(orgId, c.id);
      const content = joinFields([
        full?.fullName ?? c.fullName,
        full?.title ?? c.title,
        full?.titleZh,
        full?.department,
        full?.bio,
        full?.backgroundSummary,
        full?.backgroundSummaryZh,
      ]);
      if (content) sources.push({ entityType: "contact_card", entityId: c.id, content });
    }
  } catch {
    /* optional */
  }

  // products
  try {
    for (const p of await core.companyProducts.list(orgId, companyId)) {
      const content = joinFields([p.name, p.category, p.oneLiner, p.oneLinerZh, p.description, p.descriptionZh]);
      if (content) sources.push({ entityType: "company_product_card", entityId: p.id, content });
    }
  } catch {
    /* optional */
  }

  // news
  try {
    for (const n of await core.companyChildren.listNews(orgId, companyId)) {
      const content = joinFields([n.title, n.titleZh, n.summary, n.summaryZh]);
      if (content) sources.push({ entityType: "company_news", entityId: n.id, content });
    }
  } catch {
    /* optional */
  }

  // notes（含兩單例 narrative/observations；entity_type='note'，entity_id=note.id → 進檢索白名單）。
  try {
    for (const note of await core.notes.list(orgId, "company", companyId)) {
      const content = (note.body ?? "").trim();
      if (content) sources.push({ entityType: "note", entityId: note.id, content });
    }
  } catch {
    /* optional */
  }

  return sources;
}

/**
 * 建立/更新一家公司的嵌入索引。回傳寫入（含跳過的）chunk 總數。
 * 逐 chunk embed→upsert；content_hash 未變者 upsert 內部跳過重嵌（省 embed 成本？——注意：embed 仍會呼叫，
 * 但為求正確去重仍以 upsert 端 hash 為準；此處先算 hash，未變則連 embed 都省）。
 *
 * 殘留清理：內容縮短（跨 CHUNK_CHARS 邊界）後 chunk 數變少，舊高 index chunk 不會被 upsert 覆寫而殘留，
 * 仍可被會中檢索命中出過時卡。故每個 entity upsert 完後刪除 chunk_index ≥ 新 chunk 數的殘留列（org 隔離）。
 * 已知限制：entity **整個消失**（如筆記被刪）→ 其孤兒 embeddings 不在 collectSources 回傳的來源內，
 * 且 embeddings 表無 company_id 欄可定位同公司同型別列，故無法在此安全清除（需另建 GC/schema 才處理）。
 */
export async function buildCompanyIndex(deps: IndexerDeps, orgId: string, companyId: string): Promise<IndexResult> {
  const { core, embed, embedModel } = deps;
  const sources = await collectSources(core, orgId, companyId);

  let chunks = 0;
  for (const src of sources) {
    const pieces = chunkText(src.content);
    for (let i = 0; i < pieces.length; i++) {
      const content = pieces[i]!;
      const contentHash = hashOf(content);
      // 已存在且內容未變 → 連 embed 都省（idempotent，且省 embed 成本）。
      const existing = await core.db.get<{ content_hash: string }>(
        "SELECT content_hash FROM embeddings WHERE org_id = ? AND entity_type = ? AND entity_id = ? AND chunk_index = ?",
        [orgId, src.entityType, src.entityId, i],
      );
      chunks++;
      if (existing && existing.content_hash === contentHash) continue;

      const vec = await embed(content);
      const row: NewEmbedding = {
        entityType: src.entityType,
        entityId: src.entityId,
        chunkIndex: i,
        content,
        contentHash,
        embedding: vec,
        dims: vec.length,
        model: embedModel,
      };
      await core.embeddings.upsert(orgId, [row]);
    }
    // 殘留清理：刪掉本次已不存在的高 index chunk（內容縮短後殘留的舊塊）；未殘留時為 no-op。
    await core.db.run(
      "DELETE FROM embeddings WHERE org_id = ? AND entity_type = ? AND entity_id = ? AND chunk_index >= ?",
      [orgId, src.entityType, src.entityId, pieces.length],
    );
  }
  return { chunks };
}
