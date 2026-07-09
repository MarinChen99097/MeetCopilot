/**
 * Admin JWT 存取（A3 不變量）。
 * - localStorage key 固定 `mc_admin_token`，**與 apps/web 的 `mc_token` 區隔**，避免兩 app 互踩。
 * - 前端不顯示/不儲存任何 secret；此處只存後端簽發的 JWT（非秘密）。
 */
const TOKEN_KEY = "mc_admin_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export function logout(): void {
  setToken(null);
}
