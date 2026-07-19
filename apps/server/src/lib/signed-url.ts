/**
 * Asset 串流簽章（契約 §3）。解「<img> 帶不了 Bearer」：原始頁圖片以短效 HMAC 簽章 URL 授權，
 * 而非 Bearer。GET /api/decks/:id/assets/:assetId?exp=&sig= 的 route 用 verifyAssetSig 放行。
 *
 * sig = HMAC_SHA256(secret, `${deckId}:${assetId}:${exp}`)，hex。exp＝unix 秒（預設 TTL 8h，見下）。
 * secret 來源（不新增必填 boot env，避免部署卡關）：
 *   1) process.env.SERVER_SIGNING_SECRET（若設）。
 *   2) 否則從既有 JWT_SECRET 以 HKDF-SHA256 衍生一把獨立金鑰（與 JWT 簽發用途隔離；info 綁定用途字串）。
 * 兩者皆在首次呼叫時解析並記憶（module-level）。
 */
import { createHmac, timingSafeEqual, hkdfSync } from "node:crypto";

/**
 * 簽章 URL 的預設有效期（秒）。原始頁圖片供顯示，長會議/長編輯常持續數小時 → 預設拉到會議尺度（8h＝28800），
 * 避免 marathon session 中原始頁 <img> 因簽章過期回 403 破圖。可用 env `ASSET_URL_DEFAULT_TTL_SEC` 覆寫（正整數秒）。
 * 前端另有週期性 getDeck 續簽 backstop（PresentStage/SlideEditor，間隔 < TTL）——雙保險。
 */
function resolveDefaultTtlSec(): number {
  const raw = Number((process.env.ASSET_URL_DEFAULT_TTL_SEC ?? "").trim());
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 28800;
}
export const ASSET_URL_DEFAULT_TTL_SEC = resolveDefaultTtlSec();

/** HKDF info：把衍生金鑰綁定到「asset URL 簽章」用途，與其他潛在 JWT 衍生用途分離。 */
const HKDF_INFO = "meetcopilot/asset-url/v1";

let cachedSecret: Buffer | null = null;

/** 解析（並記憶）簽章金鑰。SERVER_SIGNING_SECRET 優先；否則從 JWT_SECRET 衍生。 */
function signingSecret(): Buffer {
  if (cachedSecret) return cachedSecret;
  const explicit = (process.env.SERVER_SIGNING_SECRET ?? "").trim();
  if (explicit) {
    cachedSecret = Buffer.from(explicit, "utf8");
    return cachedSecret;
  }
  // 缺省：由 JWT_SECRET 衍生（boot 時 config 已 fail-fast 保證非佔位；此處仍給非空 fallback 以防單元測試無 env）。
  const ikm = (process.env.JWT_SECRET ?? "").trim() || "meetcopilot-dev-unsafe-signing-fallback";
  const derived = hkdfSync("sha256", Buffer.from(ikm, "utf8"), Buffer.alloc(0), Buffer.from(HKDF_INFO, "utf8"), 32);
  cachedSecret = Buffer.from(derived);
  return cachedSecret;
}

/** 計算 sig（hex）。 */
function computeSig(deckId: string, assetId: string, exp: number): string {
  return createHmac("sha256", signingSecret()).update(`${deckId}:${assetId}:${exp}`).digest("hex");
}

/**
 * 產生簽章 URL（相對路徑，帶 ?exp=&sig=）。回傳可直接放進原始頁 SlideSpec 的 image.dataUri。
 * 前端 <img src> 以此相對路徑（`/api/decks/...`）對 API origin 解析。
 */
export function signAssetUrl(deckId: string, assetId: string, ttlSec: number = ASSET_URL_DEFAULT_TTL_SEC): string {
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, Math.trunc(ttlSec));
  const sig = computeSig(deckId, assetId, exp);
  return `/api/decks/${encodeURIComponent(deckId)}/assets/${encodeURIComponent(assetId)}?exp=${exp}&sig=${sig}`;
}

/**
 * 驗章：exp 未過期且 sig 相符 → true。常數時間比對（timingSafeEqual），長度不符/非 hex → false。
 * 不驗租戶（此層只驗簽章有效性）；asset.deckId==deckId 與 org 綁定由 route 另做（縱深防禦）。
 */
export function verifyAssetSig(deckId: string, assetId: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || !Number.isInteger(exp)) return false;
  if (exp < Math.floor(Date.now() / 1000)) return false; // 已過期
  if (typeof sig !== "string" || !/^[0-9a-f]+$/i.test(sig)) return false;
  const expected = Buffer.from(computeSig(deckId, assetId, exp), "hex");
  const provided = Buffer.from(sig, "hex");
  if (expected.length === 0 || expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
