/**
 * 「研究更多」（mode='more'）純函式（RESEARCH_UPGRADE v2）：在既有 CRM 資料上補缺＋佐證，較快。
 * runDeep 變體的兩個決策核心，抽成無 IO 純函式供 orchestrator 呼叫與單測：
 *  - buildMoreGapQueries：讀「目前 DB 值」找空欄 → 產定向雙語查詢（cap 12/輪）當 follow-up round 種子。
 *  - decideEvidenceBoost：公司 scalar 欄新值與既有值正規化相等且來源網域不同 → 佐證升信心（supersede provenance）。
 *
 * 雙語不變量沿用：主要欄留來源語言、*Zh gloss。此處只產查詢與 provenance 決策，不落庫（orchestrator 負責）。
 */

/**
 * 空值判準（more fill-empty / gap 偵測）：null/undefined、trim 後空字串、空陣列、空物件（0 鍵）為空；
 * 數字（含 0）、布林、非空物件/陣列為非空。
 */
export function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

/** scalar 正規化（佐證相等判定）：數字→字串；其餘 trim＋小寫＋收斂內部空白。 */
export function normalizeScalar(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  return String(v).trim().toLowerCase().replace(/\s+/g, " ");
}

/** 取 URL host（去 www.、小寫）；非法/缺→undefined。 */
function hostOf(u?: string): string | undefined {
  if (!u) return undefined;
  try {
    return new URL(u).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return undefined;
  }
}

// ── buildMoreGapQueries ───────────────────────────────────────
/** 追蹤的四個社群平台（缺帳號→補查）；orchestrator 亦據此算 socialPlatformsPresent（單一真源）。 */
export const SOCIAL_PLATFORMS = ["youtube", "facebook", "instagram", "threads"] as const;

interface CompanyGapProbe {
  /** 全部為空才算此角度缺口。 */
  keys: string[];
  angle: string;
  zh: (n: string) => string;
  en: (n: string) => string;
}
/** 公司 scalar 欄缺口探針（keys 全空→補查該角度）。 */
const COMPANY_GAP_PROBES: CompanyGapProbe[] = [
  {
    keys: ["fundingStage", "fundingTotal", "lastFundingAmount", "investors"],
    angle: "funding",
    zh: (n) => `${n} 募資 融資輪 投資人 估值 資本額`,
    en: (n) => `${n} funding round investors valuation`,
  },
  {
    keys: ["industry"],
    angle: "overview",
    zh: (n) => `${n} 產業別 所屬產業 主要業務領域`,
    en: (n) => `${n} industry sector primary business`,
  },
  {
    keys: ["tagline"],
    angle: "overview",
    zh: (n) => `${n} 品牌標語 slogan 願景 使命`,
    en: (n) => `${n} tagline slogan mission statement`,
  },
  {
    keys: ["businessModel"],
    angle: "overview",
    zh: (n) => `${n} 商業模式 獲利模式 收費方式`,
    en: (n) => `${n} business model revenue model monetization`,
  },
  {
    keys: ["foundedYear"],
    angle: "overview",
    zh: (n) => `${n} 成立年份 創立時間 公司歷史`,
    en: (n) => `${n} founded year established company history`,
  },
  {
    keys: ["employeeCount", "employeeRange"],
    angle: "overview",
    zh: (n) => `${n} 員工人數 公司規模 團隊規模`,
    en: (n) => `${n} employee count company size headcount`,
  },
  {
    keys: ["annualRevenue", "revenueRange"],
    angle: "funding",
    zh: (n) => `${n} 年營收 營收規模 財務`,
    en: (n) => `${n} annual revenue financials scale`,
  },
  {
    keys: ["hqCity", "hqCountry", "hqAddress"],
    angle: "overview",
    zh: (n) => `${n} 總部 所在地 地址 據點`,
    en: (n) => `${n} headquarters location address offices`,
  },
];

export interface MoreGapInput {
  companyName: string;
  /** 排序提示：華語公司 zh 先出（依公司名 CJK 或呼叫端判定）。缺→en 先。 */
  bilingual?: boolean;
  /** 公司 scalar 欄目前值（空/缺→視為缺口）。 */
  company: Record<string, unknown>;
  /** 產品（缺 pricing/specs/model 任一→補查）。pricing/specs/model 值型不拘，空判準見 isEmptyValue。 */
  products?: { name?: string; pricing?: unknown; specs?: unknown; model?: unknown }[];
  /** 缺 background 或 photo 的主管顯示名（呼叫端已篩選）。 */
  contactsNeedingDetail?: string[];
  /** 已有帳號的社群平台集合（youtube/facebook/instagram/threads）；不在此集合者→補查。 */
  socialPlatformsPresent?: string[];
}

/** more 模式 gap 種子上限（cap 12/輪，沿用 ROUND_QUERY_CEIL 二次收斂）。 */
export const MORE_GAP_QUERY_CAP = 12;

/**
 * 依「目前 DB 值」的空欄產定向雙語查詢（cap 12）。優先序：公司欄→產品→主管→社群平台。
 * 純函式（無 IO）：呼叫端先把 DB 讀成 MoreGapInput 再傳入。供 orchestrator follow-up round 種子與單測。
 */
export function buildMoreGapQueries(input: MoreGapInput): { angle: string; query: string }[] {
  const n = input.companyName.trim();
  const out: { angle: string; query: string }[] = [];
  const pushPair = (angle: string, zh: string, en: string): void => {
    if (input.bilingual) {
      out.push({ angle, query: zh });
      out.push({ angle, query: en });
    } else {
      out.push({ angle, query: en });
      out.push({ angle, query: zh });
    }
  };
  if (!n) return out;

  // 1) 公司 scalar 欄缺口。
  for (const probe of COMPANY_GAP_PROBES) {
    if (probe.keys.every((k) => isEmptyValue(input.company[k]))) {
      pushPair(probe.angle, probe.zh(n), probe.en(n));
    }
  }
  // 2) 產品缺 pricing/specs/model。
  for (const p of input.products ?? []) {
    const name = typeof p.name === "string" ? p.name.trim() : "";
    if (!name) continue;
    const missing = isEmptyValue(p.pricing) || isEmptyValue(p.specs) || isEmptyValue(p.model);
    if (missing) pushPair("products", `${n} ${name} 價格 規格 型號 方案`, `${name} ${n} pricing specifications model`);
  }
  // 3) 主管缺背景/照片。
  for (const raw of input.contactsNeedingDetail ?? []) {
    const nm = typeof raw === "string" ? raw.trim() : "";
    if (!nm) continue;
    pushPair("leadership", `${nm} ${n} 學經歷 背景 現職 LinkedIn 照片`, `${nm} ${n} background career profile LinkedIn photo`);
  }
  // 4) 社群平台缺帳號（每平台一條雙語混合，省 cap）。
  const present = new Set((input.socialPlatformsPresent ?? []).map((s) => s.toLowerCase()));
  for (const plat of SOCIAL_PLATFORMS) {
    if (present.has(plat)) continue;
    out.push({ angle: "social", query: `${n} 官方 ${plat} 帳號 official ${plat} account` });
  }
  return out.slice(0, MORE_GAP_QUERY_CAP);
}

// ── decideEvidenceBoost ───────────────────────────────────────
export interface EvidenceBoostInput {
  fieldName: string;
  /** 既有 company domain 欄值（DB 現值）。 */
  existingValue: unknown;
  /** 新一輪研究帶回的值（provenance value）。 */
  newValue: string;
  /** 新值來源 URL（真實出處，redirect 已解析）。 */
  newSourceUrl?: string;
  newSourceType?: string;
  /** 該欄既有（未 superseded）provenance——決定舊信心/舊來源網域/verified。 */
  existing?: { sourceUrl?: string; confidence?: number; verified?: 0 | 1 };
}

/** 佐證升信心後要寫的新 provenance（orchestrator 補 entityType/entityId/filledBy）。 */
export interface EvidenceBoost {
  fieldName: string;
  valueSnapshot: string;
  sourceUrl?: string;
  sourceType?: string;
  confidence: number;
  verified: 0 | 1;
}

/**
 * more 模式佐證升信心判定（純函式）：公司 scalar 欄「新值與既有值正規化相等」且「新 sourceUrl 網域 ≠ 既有 provenance 網域」
 * → 回一筆 supersede provenance（confidence=min(0.9, 舊信心+0.15)、保留既有值當快照、**不動 verified**）；不符→null。
 * 既有值空、無新來源網域、同網域佐證、值不相等 → 皆不升（null）。
 */
export function decideEvidenceBoost(input: EvidenceBoostInput): EvidenceBoost | null {
  if (isEmptyValue(input.existingValue)) return null; // 既有為空 → 走 fill-empty，不是佐證
  const existingNorm = normalizeScalar(input.existingValue);
  if (!existingNorm || existingNorm !== normalizeScalar(input.newValue)) return null; // 非正規化相等
  const newDomain = hostOf(input.newSourceUrl);
  if (!newDomain) return null; // 無真實新來源網域 → 不算獨立佐證
  const oldDomain = hostOf(input.existing?.sourceUrl);
  if (oldDomain && oldDomain === newDomain) return null; // 同網域 → 非獨立佐證
  const oldConf = typeof input.existing?.confidence === "number" ? input.existing.confidence : 0.5;
  return {
    fieldName: input.fieldName,
    valueSnapshot: String(input.existingValue), // 保留既有值（被佐證），不改值
    sourceUrl: input.newSourceUrl,
    sourceType: input.newSourceType,
    confidence: Math.min(0.9, oldConf + 0.15),
    verified: input.existing?.verified ?? 0, // 不動 verified
  };
}
