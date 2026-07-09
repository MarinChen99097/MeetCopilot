/**
 * Typed REST client — admin 前端↔後端唯一 REST 接縫（ADMIN_CONTRACT §4）。
 *
 * - Base URL 讀 NEXT_PUBLIC_API_BASE（dev fallback http://localhost:8787）；元件內**絕不** hardcode 網址。
 * - Auth: 每次呼叫帶 `Authorization: Bearer <JWT>`（login/google 除外）。org 隔離由 server 從 JWT 推導。
 * - 錯誤契約：非 2xx 一律 `{ error: string }`，包成 ApiError（帶 HTTP status）。
 * - admin 端點全走 platformAdminRequired：非 admin token → 403（A1）。
 */
import type {
  AdminHealth,
  AdminOverview,
  AuthResponse,
  JobStats,
  JobsPage,
  MeResponse,
  OrgDetail,
  OrgStatus,
  OrgsList,
  StatusPatchResult,
  UsageEventsPage,
  UsageGroupBy,
  UsageSummary,
  UserStatus,
} from "./api-types";
import { getToken } from "./auth";

/** REST base URL；env 驅動（dev fallback）。 */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8787";

/** 非 2xx / 網路失敗時拋出；帶 `{ error }` body 與 HTTP status。 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public body: { error?: string },
  ) {
    super(body.error ?? `HTTP ${status}`);
    this.name = "ApiError";
  }
}

/** ApiError → 其 zh-TW 訊息；非 ApiError（網路/未知）→ fallback。 */
export function errMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** 是否帶 Authorization header（預設 true）；login/google 傳 false。 */
  auth?: boolean;
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function failFrom(res: Response): Promise<never> {
  let errBody: { error?: string } = {};
  try {
    errBody = (await res.json()) as { error?: string };
  } catch {
    // 非 JSON error body：留空，ApiError fallback 到 `HTTP <status>`。
  }
  throw new ApiError(res.status, errBody);
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true } = opts;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) Object.assign(headers, authHeaders());

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: "網路連線失敗" });
  }

  if (!res.ok) return failFrom(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** query-string builder：略過 undefined/空字串。 */
function qs(params: Record<string, string | number | undefined | null>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

/**
 * 日期範圍參數 `YYYY-MM-DD` → epoch-ms number（ADMIN_CONTRACT §4/§8：from/to 一律 epoch-ms）。
 * DateRangePicker/單日 cell 給的是 UTC 日字串；server parseEpoch 做 `Number(raw)`，
 * 直接送字串會變 NaN → 400。故在此集中轉換：
 * - edge="start"（起日）→ 當日 00:00:00.000Z；
 * - edge="end"（迄日）→ 當日 23:59:59.999Z（**必須涵蓋整日**，否則同日事件被 `created_at <= to` 排除）。
 * 空值回 undefined（qs 會略過）；非 `YYYY-MM-DD`（含已是數字字串）則原樣數值化回傳，避免二次轉換。
 */
function dayParamToEpochMs(day: string | undefined, edge: "start" | "end"): number | undefined {
  if (!day) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const n = Number(day);
    return Number.isFinite(n) ? n : undefined;
  }
  const suffix = edge === "start" ? "T00:00:00.000Z" : "T23:59:59.999Z";
  const ms = Date.parse(`${day}${suffix}`);
  return Number.isNaN(ms) ? undefined : ms;
}

// ── Auth（沿用既有 /api/auth/*）──────────────────────────────────────────────
export function apiLogin(input: { email: string; password: string }): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/login", { method: "POST", body: input, auth: false });
}
export function apiGoogleLogin(idToken: string): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/google", { method: "POST", body: { idToken }, auth: false });
}
export function apiMe(): Promise<MeResponse> {
  return request<MeResponse>("/api/auth/me");
}

// ── Admin 端點（全 platformAdminRequired；§4）────────────────────────────────

/** #1 總覽卡片。 */
export function getOverview(): Promise<AdminOverview> {
  return request<AdminOverview>("/api/admin/overview");
}

/** #2 用量聚合。 */
export function getUsage(p: { from: string; to: string; groupBy: UsageGroupBy }): Promise<UsageSummary> {
  return request<UsageSummary>(
    `/api/admin/usage${qs({ from: dayParamToEpochMs(p.from, "start"), to: dayParamToEpochMs(p.to, "end"), groupBy: p.groupBy })}`,
  );
}

/** #3 用量明細（分頁；limit 上限 200）。 */
export function getUsageEvents(p: {
  from: string;
  to: string;
  orgId?: string;
  kind?: string;
  limit?: number;
  offset?: number;
}): Promise<UsageEventsPage> {
  return request<UsageEventsPage>(
    `/api/admin/usage/events${qs({
      from: dayParamToEpochMs(p.from, "start"),
      to: dayParamToEpochMs(p.to, "end"),
      orgId: p.orgId,
      kind: p.kind,
      limit: p.limit,
      offset: p.offset,
    })}`,
  );
}

/** #4 組織清單。 */
export function listOrgs(p: { query?: string; status?: OrgStatus | "" } = {}): Promise<OrgsList> {
  return request<OrgsList>(`/api/admin/orgs${qs({ query: p.query, status: p.status })}`);
}

/** #5 組織明細。 */
export function getOrg(id: string): Promise<OrgDetail> {
  return request<OrgDetail>(`/api/admin/orgs/${encodeURIComponent(id)}`);
}

/** #6 停權/復權——組織。 */
export function setOrgStatus(id: string, status: OrgStatus): Promise<StatusPatchResult> {
  return request<StatusPatchResult>(`/api/admin/orgs/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: { status },
  });
}

/** #6 停權/復權——使用者。 */
export function setUserStatus(id: string, status: UserStatus): Promise<StatusPatchResult> {
  return request<StatusPatchResult>(`/api/admin/users/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: { status },
  });
}

/** #7 研究 job 清單（分頁）。 */
export function listJobs(p: {
  status?: string;
  mode?: string;
  orgId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<JobsPage> {
  return request<JobsPage>(
    `/api/admin/jobs${qs({
      status: p.status,
      mode: p.mode,
      orgId: p.orgId,
      from: dayParamToEpochMs(p.from, "start"),
      to: dayParamToEpochMs(p.to, "end"),
      limit: p.limit,
      offset: p.offset,
    })}`,
  );
}

/** #8 job 統計。 */
export function getJobStats(days = 14): Promise<JobStats> {
  return request<JobStats>(`/api/admin/jobs/stats${qs({ days })}`);
}

/** #9 系統健康。也用於登入後的 platformAdmin 探測（A1）：403 = 非 admin。 */
export function getHealth(): Promise<AdminHealth> {
  return request<AdminHealth>("/api/admin/health");
}
