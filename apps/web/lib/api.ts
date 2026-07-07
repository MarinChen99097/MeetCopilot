/**
 * Typed REST client — the single frontend↔backend REST seam (API_CONTRACT §0/§1).
 *
 * - Base URL from NEXT_PUBLIC_API_BASE (default http://localhost:8787); NEVER hardcode localhost in components.
 * - Auth: `Authorization: Bearer <JWT>` on every call except register/login. org isolation is derived
 *   server-side from the JWT — the frontend never sends orgId.
 * - Error contract: non-2xx is always `{ error: string }`; surfaced as `ApiError` carrying that body.
 */
import type { MembershipRole } from "@meetcopilot/shared";

/** REST base URL (the "cloud path"); env-driven per API_CONTRACT §0. */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8787";

const TOKEN_KEY = "mc_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

/** Clear local token only; WS teardown is the caller's responsibility. */
export function logout(): void {
  setToken(null);
}

/** Error thrown for network failures and non-2xx responses; carries the `{ error }` body + HTTP status. */
export class ApiError extends Error {
  constructor(
    public status: number,
    /** Parsed `{ error }` body (best-effort; `error` absent on non-JSON responses). */
    public body: { error?: string },
  ) {
    super(body.error ?? `HTTP ${status}`);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Attach Authorization header (default true). register/login pass false. */
  auth?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true } = opts;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: "network request failed" });
  }

  if (!res.ok) {
    let errBody: { error?: string } = {};
    try {
      errBody = (await res.json()) as { error?: string };
    } catch {
      // non-JSON error body: leave errBody empty; ApiError falls back to `HTTP <status>`
    }
    throw new ApiError(res.status, errBody);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ── Contract types (API_CONTRACT §1) ────────────────────────────
export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}
export interface AuthOrg {
  id: string;
  name: string;
}
/** register/login response. */
export interface AuthResponse {
  token: string;
  user: AuthUser;
  org: AuthOrg;
}
/** /auth/me response. */
export interface MeResponse {
  user: AuthUser;
  org: AuthOrg;
  role: MembershipRole;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  orgName: string;
}
export interface LoginInput {
  email: string;
  password: string;
}

// ── Auth endpoints (API_CONTRACT §1) ────────────────────────────
export function apiRegister(input: RegisterInput): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/register", { method: "POST", body: input, auth: false });
}

export function apiLogin(input: LoginInput): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/login", { method: "POST", body: input, auth: false });
}

export function apiMe(): Promise<MeResponse> {
  return request<MeResponse>("/api/auth/me");
}

/**
 * Liveness probe. NOTE: not defined in API_CONTRACT §1 — assumed `GET /api/health → { ok }`.
 * Flagged as a contract gap; adjust once the server route is frozen.
 */
export function apiHealth(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/api/health", { auth: false });
}
