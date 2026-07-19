/**
 * 主管照片獵取（enrichKeyPeople 內用）純解析（RESEARCH_UPGRADE v2）。
 * 對仍無 photoUrl 的主管，用其背景補查 grounding 的 citation 頁 fetchRaw 回的 HTML，
 * 找「alt 含人名 token（≥2 字）」的 <img> src；退而求其次，僅當 <title> 含人名才收 og:image。
 * 一律過絕對 http(s)＋副檔名（svg/ico）＋常見追蹤/佔位像素＋佔位/預設圖檔名黑名單過濾。純函式（無 IO），供 orchestrator 呼叫與單測。
 * 嚴禁捏造：任何條件不符即回 undefined（呼叫端不填 photoUrl）。
 */

export interface PhotoHuntInput {
  /** 來源語言姓名（英文名等）。 */
  fullName?: string;
  /** 繁中姓名 gloss。 */
  fullNameZh?: string;
  /** 該頁 URL（相對 src 絕對化基準；provenance sourceUrl 用）。 */
  pageUrl: string;
}

/** 裝飾/向量圖檔（排除）。 */
const PHOTO_EXCLUDE_EXT_RE = /\.(svg|ico)(\?|#|$)/i;
/** 常見追蹤/佔位像素（無尺寸資訊時的字串啟發式）。 */
const TRACKING_RE = /(?:^|[/_-])(?:1x1|pixel|spacer|blank|beacon|transparent|tracking)(?:[/_.-]|$)/i;
/**
 * 佔位/預設圖檔名關鍵字（比對整個 URL path、大小寫不敏感）——排除 FB/OG 預設圖、無圖佔位、預設頭像等。
 * 實測抓到 https://www.niea.org.tw/public/element/FB_default_image.jpg（FB 預設佔位圖）誤填為主管照片。
 * 涵蓋：default（含 avatar-default/og-default/fb_default 等 *-default 變體）、placeholder、blank、
 * noimage/no-image/no_image、fallback、dummy、sprite、spacer。子字串比對（保守擋佔位圖）。
 */
const PLACEHOLDER_PATH_RE = /(?:default|placeholder|blank|no[-_]?image|fallback|dummy|sprite|spacer)/i;

/** 是否含 CJK 表意文字（用以決定比對策略：CJK 走子字串、拉丁走詞界）。 */
function hasCjk(s: string): boolean {
  return /[㐀-鿿豈-﫿]/.test(s);
}

/** 轉義 regex 特殊字元（供詞界比對動態建構）。 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 取姓名 token：全名整串（≥2 字）＋以空白切出的各段。fullNameZh 先、fullName 後。
 * 拉丁段需 ≥3 字才收（2 字母段如 Li/Wu/Yu/An/Xu… 太易誤中英文詞，交由整串 token 詞界比對承載）；
 * CJK 段 ≥2 字即收（中日韓無詞界，2 字姓名已足夠專一）。
 */
function nameTokens(fullName?: string, fullNameZh?: string): string[] {
  const toks = new Set<string>();
  for (const s of [fullNameZh, fullName]) {
    if (typeof s !== "string") continue;
    const t = s.trim();
    if (t.length >= 2) toks.add(t);
    for (const part of t.split(/\s+/)) {
      const minLen = hasCjk(part) ? 2 : 3;
      if (part.length >= minLen) toks.add(part);
    }
  }
  return [...toks];
}

/**
 * 文字（alt/title）是否含任一姓名 token（大小寫不敏感）。
 * CJK token 以子字串比對（無詞界可用）；拉丁 token 以「詞界」（\b…\b）比對——
 * 避免 'li'/'wu'/'yu' 等短段以子字串誤中 Quality/click/reliable/application 等常見英文詞，
 * 導致把版面裝飾/導覽/廣告圖誤指派為某主管頭像（confirmed finding）。
 */
function textHasName(text: string, tokens: string[]): boolean {
  const lower = text.toLowerCase();
  return tokens.some((tok) => {
    const t = tok.trim();
    if (!t) return false;
    if (hasCjk(t)) return lower.includes(t.toLowerCase());
    return new RegExp(`\\b${escapeRegExp(t)}\\b`, "i").test(text);
  });
}

/**
 * 從標籤取某屬性值（雙引號/單引號/裸值三型；大小寫不敏感）。
 * 前綴用 (?:^|[\s"']) 而非 \b：\b 會把連字號當詞界，令 attr("alt") 誤中 data-alt、attr("src") 誤中 data-src
 * （抓到錯照片）。改為要求屬性名前一字元是行首/空白/引號（引號涵蓋 <img src="x"alt="y"> 無空白相鄰型），
 * 使 data-alt/data-src 的 -alt/-src 不再被誤配。屬性名皆為程式內字面量（alt/src/data-src/property/name/content），無需轉義。
 */
function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|[\\s"'])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  if (!m) return undefined;
  return m[1] ?? m[2] ?? m[3];
}

/** 絕對化＋過濾（絕對 http(s)、非 svg/ico、非追蹤像素、非佔位/預設圖）；不符→undefined。 */
function toUsablePhoto(src: string, pageUrl: string): string | undefined {
  const raw = src.trim();
  if (!raw) return undefined;
  let u: URL;
  try {
    u = new URL(raw, pageUrl);
  } catch {
    return undefined;
  }
  const abs = u.href;
  if (!/^https?:\/\//i.test(abs)) return undefined; // 只接受絕對 http(s)（含排除 data:）
  if (PHOTO_EXCLUDE_EXT_RE.test(abs)) return undefined;
  if (TRACKING_RE.test(abs)) return undefined;
  if (PLACEHOLDER_PATH_RE.test(u.pathname)) return undefined; // 佔位/預設圖黑名單（比對整個 URL path）
  return abs;
}

const OG_IMAGE_KEYS = new Set([
  "og:image",
  "og:image:secure_url",
  "og:image:url",
  "twitter:image",
  "twitter:image:src",
]);

/**
 * 從頁面 HTML 找符合人名的照片 URL：
 *  1) 掃 <img>：alt 含人名 token → 取其 src（絕對化＋過濾），第一個命中即回。
 *  2) 皆無命中且 <title> 含人名 → 回 og:image/twitter:image（絕對化＋過濾）。
 * 無姓名 token 或全數不符 → undefined（嚴禁捏造）。
 */
export function findPersonPhotoInHtml(html: string, input: PhotoHuntInput): string | undefined {
  if (typeof html !== "string" || !html) return undefined;
  const tokens = nameTokens(input.fullName, input.fullNameZh);
  if (tokens.length === 0) return undefined;

  // 1) <img alt 含人名> → src / data-src。
  const imgRe = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const tag = m[0];
    const alt = attr(tag, "alt");
    if (!alt || !textHasName(alt, tokens)) continue;
    const src = attr(tag, "src") ?? attr(tag, "data-src");
    if (!src) continue;
    const usable = toUsablePhoto(src, input.pageUrl);
    if (usable) return usable;
  }

  // 2) og:image / twitter:image——僅當 <title> 含人名。
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  if (title && textHasName(title, tokens)) {
    const metaRe = /<meta\b[^>]*>/gi;
    let mm: RegExpExecArray | null;
    while ((mm = metaRe.exec(html)) !== null) {
      const tag = mm[0];
      const key = (attr(tag, "property") ?? attr(tag, "name") ?? "").toLowerCase();
      if (!OG_IMAGE_KEYS.has(key)) continue;
      const content = attr(tag, "content");
      if (!content) continue;
      const usable = toUsablePhoto(content, input.pageUrl);
      if (usable) return usable;
    }
  }
  return undefined;
}
