/**
 * 擷取器共用（extractor.ts / deep-extractor.ts 之間去重）：未歸類情報型別＋去重收攏、文字正規化、
 * narrativeZh/uncategorized 的 responseSchema 片段。純抽共用、不改語意——各擷取器輸出與原本逐字一致。
 *
 * ⚠️ 兩擷取器 SYSTEM prompt 內 narrativeZh/uncategorized 兩句**刻意不合併**：站點抽取（company/contacts/
 *   products/news）與全網合成（company/news/funding/people/competitors/…＋[S#] 來源標註）措辭各自貼切，
 *   合併會改變送模型的語意。故此處只共用**結構完全相同**的 responseSchema 片段，prompt 句子留在各檔逐字保留。
 */
import { Type } from "@google/genai";

/** 未歸類情報單筆（WP2 §2）：不進既有欄位的重要事實＋其來源 URL（供筆記區「未歸類情報」附來源連結）。 */
export interface UncategorizedIntel {
  text: string;
  sourceUrl?: string;
}

/**
 * trim；空字串/非字串 → undefined。統一 narrativeZh 與各文字欄的正規化
 * （收攏原 deep-extractor cleanStr／extractor inline ternary／orchestrator `?.trim()` 三種等價寫法）。
 */
export function cleanStr(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** 未歸類情報去重上限（兩擷取器一致）。 */
export const MAX_UNCATEGORIZED = 25;

/**
 * 清 URL 尾端污染（逗號/分號/引號/括號/空白，防「websiteUrl 帶尾逗號」等模型/join 污染）後，
 * **只接受絕對 http(s)**——相對、mailto:/data:/javascript:、非法一律 undefined。
 * 落庫前的 URL 欄正規化（websiteUrl/logoUrl/productUrl/docsUrl…）杜絕模型臆造的非 http 連結入庫。純函式，供單測。
 */
export function cleanUrl(u: unknown): string | undefined {
  if (typeof u !== "string") return undefined;
  const trimmed = u.trim().replace(/[\s,;'"’“”)\]}]+$/u, "");
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return trimmed; // 保留原字串形（避免 URL.toString 加尾斜線等正規化意外）
  } catch {
    return undefined; // 相對/非法 → 非絕對 http(s)
  }
}

/**
 * 圖片白名單驗證（防幻覺；契約三）：只保留「確實存在於爬到的圖片清單（whitelist）」的 URL。
 * 模型憑空捏造、清單中沒有的 URL 一律丟棄。trim → 去空/非字串 → 白名單過濾 → 保序去重。純函式，供單測。
 */
export function filterToImageWhitelist(urls: unknown, whitelist: ReadonlySet<string>): string[] {
  if (!Array.isArray(urls)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    if (typeof u !== "string") continue;
    const t = u.trim();
    if (!t || seen.has(t)) continue;
    if (!whitelist.has(t)) continue; // 不在爬到的清單＝模型幻覺 → 丟棄
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** 單一圖片 URL 白名單驗證（人物 photoUrl 用）：在清單中才回傳，否則 undefined。 */
export function validatePhotoUrl(url: unknown, whitelist: ReadonlySet<string>): string | undefined {
  if (typeof url !== "string") return undefined;
  const t = url.trim();
  return t.length > 0 && whitelist.has(t) ? t : undefined;
}

/** 模型回傳的未歸類單筆原形（text 經 cleanStr；sourceIndex 由呼叫端 resolveUrl 解讀成真實來源）。 */
export interface RawUncat {
  text?: string;
  sourceIndex?: number;
}

/**
 * 去重收攏未歸類情報：cleanStr（trim）→ 去空 → 依 text 去重 → 上限 MAX_UNCATEGORIZED。
 * sourceUrl 由 resolveUrl(item) 決定（站點抽取＝固定站台 URL；全網合成＝依 sourceIndex 對應真實來源）。
 */
export function dedupUncat<T extends RawUncat>(
  items: T[] | undefined,
  resolveUrl: (item: T) => string | undefined,
): UncategorizedIntel[] {
  const out: UncategorizedIntel[] = [];
  const seen = new Set<string>();
  for (const u of items ?? []) {
    const text = cleanStr(u?.text);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ text, sourceUrl: resolveUrl(u) });
    if (out.length >= MAX_UNCATEGORIZED) break;
  }
  return out;
}

/**
 * narrativeZh + uncategorized 的 responseSchema 片段（兩擷取器逐字相同）。spread 進各自 RESPONSE_SCHEMA.properties。
 * WP2 §2：zh-TW 敘事（8–20 句）＋未歸類情報（≤25）——凡歸類不進既有欄位的重要事實一律進 uncategorized。
 */
export const NARRATIVE_UNCAT_SCHEMA: Record<string, unknown> = {
  narrativeZh: { type: Type.STRING },
  uncategorized: {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: { text: { type: Type.STRING }, sourceIndex: { type: Type.INTEGER } },
      required: ["text"],
    },
  },
};
