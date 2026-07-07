/**
 * 匯入內容的語言偵測（純函式，無 DB／無網路）。借 v1，重寫對齊 v2。
 * 用途：匯入管線的 deck.language 初步判斷。不明或中英混雜 → "unknown"（呼叫端退回 deck 既有語言）。
 */
const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/g;
const LATIN_RE = /[A-Za-z]/g;

export function detectLanguage(texts: string[]): "zh-TW" | "en" | "unknown" {
  const joined = texts.join("");
  const meaningfulChars = Array.from(joined).filter((ch) => !/\s/.test(ch));
  const total = meaningfulChars.length;
  if (total === 0) return "unknown";

  const cjkCount = (joined.match(CJK_RE) ?? []).length;
  const latinCount = (joined.match(LATIN_RE) ?? []).length;

  const cjkRatio = cjkCount / total;
  const latinRatio = latinCount / total;

  if (cjkRatio > 0.3) return "zh-TW";
  if (latinRatio > 0.6 && cjkRatio < 0.05) return "en";
  return "unknown";
}
