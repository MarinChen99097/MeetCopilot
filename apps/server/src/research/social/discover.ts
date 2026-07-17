/**
 * 社群帳號發現與正規化（RESEARCH_UPGRADE_CONTRACT §1.2）。
 * 來源：官網 `<a href>`（crawler.socialLinks）＋公司既有欄位（socialYoutube/socialFacebook）＋既有 social_links 欄。
 * 產出：SocialHandles（值＝完整 URL）＋ social_links JSON（落 companies.social_links）。純函式、無 IO、可單測。
 */
import type { SocialHandles } from "./types.js";

type Platform = keyof SocialHandles; // youtube | facebook | instagram | threads

/** 由 URL host 判定平台；非四平台回 undefined。 */
export function classifySocialUrl(rawUrl: string): Platform | undefined {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (/(^|\.)youtube\.com$/.test(host) || host === "youtu.be") return "youtube";
  if (/(^|\.)facebook\.com$/.test(host)) return "facebook";
  if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
  if (/(^|\.)threads\.(net|com)$/.test(host)) return "threads";
  return undefined;
}

/** 正規化一個社群 URL（去 hash、去尾斜線）。非 http(s) 回 undefined。 */
function normalizeUrl(rawUrl: string): string | undefined {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    u.hash = "";
    let s = u.toString();
    if (u.pathname.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return undefined;
  }
}

/**
 * 從多個候選 URL 清單合出 SocialHandles（每平台取第一個命中的正規化 URL；先出現者勝）。
 * 候選來源依序傳入（愈可信愈前，如：既有 social_links → 公司欄位 → 官網 hrefs）。
 */
export function discoverHandles(...sources: (string[] | undefined)[]): SocialHandles {
  const handles: SocialHandles = {};
  for (const list of sources) {
    for (const raw of list ?? []) {
      if (!raw) continue;
      const platform = classifySocialUrl(raw);
      if (!platform || handles[platform]) continue;
      const norm = normalizeUrl(raw);
      if (norm) handles[platform] = norm;
    }
  }
  return handles;
}

/** SocialHandles → social_links JSON 字串（只含非空平台）；全空回 undefined（不落庫空物件）。 */
export function socialLinksJson(handles: SocialHandles): string | undefined {
  const obj: Record<string, string> = {};
  for (const p of ["youtube", "facebook", "instagram", "threads"] as Platform[]) {
    const v = handles[p];
    if (v) obj[p] = v;
  }
  return Object.keys(obj).length > 0 ? JSON.stringify(obj) : undefined;
}

/** 解析 companies.social_links JSON（既有欄位）成 URL 清單；壞值回 []。 */
export function parseSocialLinksColumn(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    return Object.values(obj).filter((v): v is string => typeof v === "string" && v.length > 0);
  } catch {
    return [];
  }
}
