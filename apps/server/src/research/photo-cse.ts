/**
 * 主管照片獵取 v3b：Google Programmable Search（Custom Search JSON API）圖片搜尋備援。
 * 官網/citation 途徑落空後才用；env GOOGLE_CSE_API_KEY＋GOOGLE_CSE_CX 皆存在才啟用（缺任一 → 呼叫端優雅 skip）。
 * fetch 固定打 https://www.googleapis.com/customsearch/v1（**固定 API 網域、非使用者可控 host**，故非 SSRF 面，
 * 用 undici 直接呼叫、不走 crawler/pinnedAgent）。回第一張過守衛的原圖 link＋其所在頁 contextLink。best-effort。
 */
import { fetch as undiciFetch } from "undici";
import { isUsablePhotoUrl } from "./photo-hunt.js";

const CSE_ENDPOINT = "https://www.googleapis.com/customsearch/v1";
const FETCH_TIMEOUT_MS = 10_000;
/** 每次查詢取回並過守衛的結果上限。 */
const MAX_RESULTS = 4;

export interface CseConfig {
  apiKey: string;
  cx: string;
}

export interface CseImageResult {
  /** 原圖 URL（寫 contact.photoUrl）。 */
  link: string;
  /** 圖片所在頁 URL（provenance sourceUrl 優先取此，退回 link）。 */
  contextLink?: string;
}

/** CSE image 回應（只取用得到的欄）。 */
interface CseResponse {
  items?: { link?: string; image?: { contextLink?: string } }[];
}

/**
 * 解析 CSE image 回應 → 第一張「過守衛」的圖（原圖 link＋contextLink）。純函式，供單測。
 * 守衛：沿用 photo-hunt 的 isUsablePhotoUrl（絕對 http(s)＋非 svg/ico＋非追蹤像素＋非佔位/預設圖）。
 * 前 MAX_RESULTS 筆內找不到合格圖 → undefined。
 */
export function pickCseImage(resp: unknown): CseImageResult | undefined {
  const items = (resp as CseResponse | undefined)?.items;
  if (!Array.isArray(items)) return undefined;
  for (const it of items.slice(0, MAX_RESULTS)) {
    const link = typeof it?.link === "string" ? it.link.trim() : "";
    if (!link || !isUsablePhotoUrl(link)) continue;
    const ctx = it?.image?.contextLink;
    const contextLink = typeof ctx === "string" && ctx.trim() ? ctx.trim() : undefined;
    return contextLink ? { link, contextLink } : { link };
  }
  return undefined;
}

/**
 * 對「<name> <company>」做一次 CSE 圖片搜尋，回第一張過守衛的圖。
 * cfg 未設定（或 apiKey/cx 任一空）→ 直接回 undefined（不打 API）。查無/非 2xx/逾時/解析失敗 → undefined。best-effort。
 */
export async function searchPersonPhotoCse(
  cfg: CseConfig | undefined,
  name: string,
  companyName: string,
  signal?: AbortSignal,
): Promise<CseImageResult | undefined> {
  if (!cfg || !cfg.apiKey || !cfg.cx) return undefined;
  const q = `${name ?? ""} ${companyName ?? ""}`.replace(/\s+/g, " ").trim();
  if (!q) return undefined;
  const url = `${CSE_ENDPOINT}?${new URLSearchParams({
    key: cfg.apiKey,
    cx: cfg.cx,
    q,
    searchType: "image",
    num: String(MAX_RESULTS),
    safe: "active",
  }).toString()}`;

  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await undiciFetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return undefined;
    }
    const json = (await res.json()) as unknown;
    return pickCseImage(json);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}
