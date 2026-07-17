/**
 * SSRF-safe JSON GET（研究社群層的外呼共用；RESEARCH_UPGRADE_CONTRACT §5.2「走既有 SSRF-safe 路徑」）。
 *
 * 重用 import/extract.ts 匯出的 `resolveAndValidate`（同一套私網/保留位址判準）＋在本檔建「把已驗證 IP pin 到
 * 連線」的 undici Agent（等同 import/extract 的 pinnedAgent，關掉 DNS-rebinding TOCTOU）。只允許 https、redirect:error
 * （YouTube Data API GET 不重導；有重導即視為失敗，避免繞過 pin）、單一逾時涵蓋 body、回應大小上限。
 *
 * 只用於**固定公開主機**（www.googleapis.com 等，非使用者可控 host）；仍過 SSRF 閘作為縱深防禦。
 */
import { fetch as undiciFetch, type RequestInit } from "undici";
import { resolveAndValidate, pinnedAgent } from "../../import/extract.js";

const MAX_JSON_BYTES = 3_000_000;
const FETCH_TIMEOUT_MS = 12_000;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// DNS-pin Agent（關掉 DNS rebinding）複用 import/extract.pinnedAgent（單一來源）；社群 fetch 沿用自己的 12s 預算。

/**
 * 安全地 GET 一個 JSON API（固定公開 host）。SSRF-guarded（DNS pin）＋逾時＋大小上限。
 * 失敗（非 2xx／逾時／非 JSON／過大／SSRF 拒絕）一律 throw——呼叫端負責 skip＋log，不得害整個 job 失敗。
 * `externalSignal` 供上層 budget/abort 串接。
 */
export async function fetchJsonSafe<T = unknown>(rawUrl: string, externalSignal?: AbortSignal): Promise<T> {
  const u = new URL(rawUrl);
  if (u.protocol !== "https:") throw new Error("only https allowed for social JSON fetch");
  const { ip, family } = await resolveAndValidate(u.hostname); // 私網/保留 → throw

  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const dispatcher = pinnedAgent(ip, family, FETCH_TIMEOUT_MS);
  try {
    const init: RequestInit = {
      method: "GET",
      redirect: "error", // 不追重導（避免繞過 pin）；YouTube Data API GET 不重導
      signal: controller.signal,
      dispatcher,
      headers: { "user-agent": BROWSER_UA, accept: "application/json" },
    };
    const res = await undiciFetch(rawUrl, init);
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`social JSON fetch ${res.status}`);
    }
    const ctype = res.headers.get("content-type") ?? "";
    if (!/application\/json|text\/json/i.test(ctype)) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`unexpected content-type: ${ctype || "unknown"}`);
    }
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len && len > MAX_JSON_BYTES) {
      await res.body?.cancel().catch(() => {});
      throw new Error("social JSON response too large");
    }
    const text = await res.text();
    if (text.length > MAX_JSON_BYTES) throw new Error("social JSON response too large");
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", onAbort);
    void dispatcher.close().catch(() => {});
  }
}
