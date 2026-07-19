/**
 * Typed REST client — the single frontend↔backend REST seam (API_CONTRACT §0/§1).
 *
 * - Base URL from NEXT_PUBLIC_API_BASE (default http://localhost:8787); NEVER hardcode localhost in components.
 * - Auth: `Authorization: Bearer <JWT>` on every call except register/login. org isolation is derived
 *   server-side from the JWT — the frontend never sends orgId.
 * - Error contract: non-2xx is always `{ error: string }`; surfaced as `ApiError` carrying that body.
 */
import type {
  MembershipRole,
  Company,
  CompanySummary,
  Contact,
  ContactSummary,
  CompanyProduct,
  ProductPersonLink,
  ProductPersonRole,
  CompanyNews,
  CompanyLocation,
  CompanyFunding,
  CompanyTech,
  CompanyDepartment,
  Deal,
  Note,
  NoteType,
  NoteEntityType,
  FieldProvenance,
  AccountStatus,
  CrawlMode,
  CrawlTargetType,
  CrawlJobStatus,
  // ── M2 Decks (§4) ──
  Deck,
  DeckSummary,
  DeckView,
  GenerateDeckInput,
  ImageKind,
  ImageJobView,
  SlideSpec,
  // ── M3 realtime seam types (§5/§6) ──
  SignalItem,
  TranscriptSegment,
  // ── M4 Train (§7) ──
  PersonaOption,
  StartTrainSessionResult,
  TrainDifficulty,
  TrainReport,
  TrainTurn,
  // ── M5 Org / invites (§D) ──
  Invite,
  InviteRole,
  OrgMember,
} from "@meetcopilot/shared";

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

/** Bearer header for the current token (empty when logged out). Shared by JSON/multipart/blob calls. */
function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Parse a non-2xx response's `{ error }` body (best-effort) and throw ApiError. Single error path. */
async function failFrom(res: Response): Promise<never> {
  let errBody: { error?: string } = {};
  try {
    errBody = (await res.json()) as { error?: string };
  } catch {
    // non-JSON error body: leave empty; ApiError falls back to `HTTP <status>`
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
    throw new ApiError(0, { error: "network request failed" });
  }

  if (!res.ok) return failFrom(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Multipart POST (file upload; browser sets the boundary Content-Type). Always Bearer. */
async function requestForm<T>(path: string, form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: "POST", headers: authHeaders(), body: form });
  } catch {
    throw new ApiError(0, { error: "network request failed" });
  }
  if (!res.ok) return failFrom(res);
  return (await res.json()) as T;
}

/** GET a binary file (e.g. .pptx export). Bearer auth means we cannot use a plain <a href>. */
async function requestBlob(path: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  } catch {
    throw new ApiError(0, { error: "network request failed" });
  }
  if (!res.ok) return failFrom(res);
  return res.blob();
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

/**
 * Google Sign-In: exchange a Google ID token (GIS `credential`) for a MeetCopilot JWT. The server verifies
 * the token and find-or-creates a local user+org by the verified Google email (same identity as EZpage).
 * Returns the SAME {token,user,org} shape as login/register.
 */
export function apiGoogleLogin(idToken: string): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/google", { method: "POST", body: { idToken }, auth: false });
}

export function apiMe(): Promise<MeResponse> {
  return request<MeResponse>("/api/auth/me");
}

/**
 * Liveness probe (API_CONTRACT §1, v1.1). `GET /api/health → { ok:true }` (unauthenticated).
 */
export function apiHealth(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/api/health", { auth: false });
}

// ── CRM shared shapes (API_CONTRACT §2/§3) ──────────────────────

/** Paginated list envelope (`?page=&pageSize=` → `{ items, total }`). */
export interface Paged<T> {
  items: T[];
  total: number;
}

/** GET /api/crm/companies/:id — full Company plus rollup counts. */
export type CompanyDetail = Company & {
  counts: { contacts: number; products: number; news: number; deals: number };
};

export interface CompanyListParams {
  query?: string;
  status?: AccountStatus | "";
  page?: number;
  pageSize?: number;
}

/**
 * 研究模式（含 v2「補充研究」more）。`more` 尚未進 shared 的 `CrawlMode`——由 server/packages 工程師
 * 平行加入（routes MODES 加 more），web 端先以本地聯集鏡像，避免 tsc 因 shared 未就緒而紅；shared
 * 補上後本聯集仍相容（"more" 為冗餘成員）。
 */
export type EnrichMode = CrawlMode | "more";

/** GET /api/research/jobs/:id — job status (API_CONTRACT §3). */
export interface ResearchJob {
  id: string;
  targetType: CrawlTargetType;
  targetId: string;
  mode: EnrichMode;
  status: CrawlJobStatus;
  fieldsFilled?: number;
  sources?: string[];
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  /**
   * Job 建立時間（escape-hatch 逃生口的時間錨；contract §5/§6）。wire 形狀依後端而異：
   * SQLite/現行 rowToJob 回 epoch ms（number）；Postgres/ISO 化後端可能回 ISO 字串或
   * 「YYYY-MM-DD HH:MM:SS」——故型別放寬為 number | string，解析交給 EnrichPanel 的 toEpochMs。
   */
  createdAt?: number | string;
}

export interface GroundResult {
  answer: string;
  citations: { title: string; url: string }[];
}

function qs(params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

// ── Companies (API_CONTRACT §2) ─────────────────────────────────
export function listCompanies(p: CompanyListParams = {}): Promise<Paged<CompanySummary>> {
  return request<Paged<CompanySummary>>(
    `/api/crm/companies${qs({ query: p.query, status: p.status, page: p.page, pageSize: p.pageSize })}`,
  );
}
export function createCompany(input: { name: string; domain?: string; websiteUrl?: string }): Promise<Company> {
  return request<Company>("/api/crm/companies", { method: "POST", body: input });
}
export function getCompany(id: string): Promise<CompanyDetail> {
  return request<CompanyDetail>(`/api/crm/companies/${id}`);
}
/** PATCH = 細填 (human override); server writes filled_by='human' provenance for each changed field. */
export function updateCompany(id: string, patch: Partial<Company>): Promise<Company> {
  return request<Company>(`/api/crm/companies/${id}`, { method: "PATCH", body: patch });
}
export function deleteCompany(id: string): Promise<void> {
  return request<void>(`/api/crm/companies/${id}`, { method: "DELETE" });
}
export function getCompanyNews(id: string): Promise<CompanyNews[]> {
  return request<CompanyNews[]>(`/api/crm/companies/${id}/news`);
}
export function getCompanyLocations(id: string): Promise<CompanyLocation[]> {
  return request<CompanyLocation[]>(`/api/crm/companies/${id}/locations`);
}
export function getCompanyFunding(id: string): Promise<CompanyFunding[]> {
  return request<CompanyFunding[]>(`/api/crm/companies/${id}/funding`);
}
export function getCompanyTech(id: string): Promise<CompanyTech[]> {
  return request<CompanyTech[]>(`/api/crm/companies/${id}/tech`);
}
export function getCompanyDepartments(id: string): Promise<CompanyDepartment[]> {
  return request<CompanyDepartment[]>(`/api/crm/companies/${id}/departments`);
}

// ── Company social (帳號連結 + 貼文/影片) (API_CONTRACT §2；WS-C) ─
// NOTE: server 端點 GET /api/crm/companies/:id/social 由 server 工程師平行實作；下列型別為 web 端
// 本地鏡像（SocialPost/CompanySocial 尚未進 shared——避免 tsc 因 shared 未就緒而紅）。

/** 社群貼文/影片指標（company_social_posts.metrics_json 解析；youtube 存 views/subscribers 等）。 */
export interface SocialPostMetrics {
  views?: number;
  subscribers?: number;
  likes?: number;
  comments?: number;
  videoCount?: number;
  [key: string]: number | string | undefined;
}

/** 社群貼文/影片一列（company_social_posts；migration 016）。 */
export interface SocialPost {
  id: string;
  orgId?: string;
  companyId?: string;
  platform: string;
  url?: string;
  title?: string;
  content?: string;
  publishedAt?: number;
  metrics?: SocialPostMetrics;
  createdAt?: number;
}

/**
 * 帳號連結整併（companies.social_links JSON ＋ 六個 social_* 單欄）。已知平台鍵為可選字串，
 * 另留 index signature 收 JSON 欄可能帶入的其它平台（如 threads/instagram/tiktok）。
 */
export interface SocialLinks {
  linkedin?: string;
  twitter?: string;
  facebook?: string;
  youtube?: string;
  crunchbase?: string;
  github?: string;
  threads?: string;
  instagram?: string;
  tiktok?: string;
  [key: string]: string | undefined;
}

/** GET /api/crm/companies/:id/social → 帳號連結 ＋ 貼文清單。 */
export interface CompanySocial {
  links: SocialLinks;
  posts: SocialPost[];
}
export function getSocial(id: string): Promise<CompanySocial> {
  return request<CompanySocial>(`/api/crm/companies/${id}/social`);
}

// ── Contacts (API_CONTRACT §2) ──────────────────────────────────
export function listContacts(companyId: string): Promise<ContactSummary[]> {
  return request<ContactSummary[]>(`/api/crm/companies/${companyId}/contacts`);
}
export function createContact(companyId: string, input: { fullName: string; title?: string }): Promise<Contact> {
  return request<Contact>(`/api/crm/companies/${companyId}/contacts`, { method: "POST", body: input });
}
export function getContact(id: string): Promise<Contact> {
  return request<Contact>(`/api/crm/contacts/${id}`);
}
export function updateContact(id: string, patch: Partial<Contact>): Promise<Contact> {
  return request<Contact>(`/api/crm/contacts/${id}`, { method: "PATCH", body: patch });
}
export function deleteContact(id: string): Promise<void> {
  return request<void>(`/api/crm/contacts/${id}`, { method: "DELETE" });
}

// ── Company products (deep profile) (API_CONTRACT §2) ───────────
export function listProducts(companyId: string): Promise<CompanyProduct[]> {
  return request<CompanyProduct[]>(`/api/crm/companies/${companyId}/products`);
}
export function createProduct(companyId: string, input: { name: string }): Promise<CompanyProduct> {
  return request<CompanyProduct>(`/api/crm/companies/${companyId}/products`, { method: "POST", body: input });
}
export function getProduct(id: string): Promise<CompanyProduct> {
  return request<CompanyProduct>(`/api/crm/products/${id}`);
}
export function updateProduct(id: string, patch: Partial<CompanyProduct>): Promise<CompanyProduct> {
  return request<CompanyProduct>(`/api/crm/products/${id}`, { method: "PATCH", body: patch });
}
export function deleteProduct(id: string): Promise<void> {
  return request<void>(`/api/crm/products/${id}`, { method: "DELETE" });
}
export function getProductPeople(id: string): Promise<ProductPersonLink[]> {
  return request<ProductPersonLink[]>(`/api/crm/products/${id}/people`);
}
export function addProductPerson(
  id: string,
  input: { contactId: string; role: ProductPersonRole; titleOnProduct?: string },
): Promise<ProductPersonLink> {
  return request<ProductPersonLink>(`/api/crm/products/${id}/people`, { method: "POST", body: input });
}
export function removeProductPerson(id: string, contactId: string): Promise<void> {
  return request<void>(`/api/crm/products/${id}/people`, { method: "DELETE", body: { contactId } });
}

// ── Deals (API_CONTRACT §2) ─────────────────────────────────────
// NOTE: §2 lists `CRUD /api/crm/deals` without a documented company filter; the detail
// Deals tab needs a per-company view, so we pass `?companyId=`. Flagged as a contract
// assumption for the backend agent to confirm/freeze.
export function listDeals(companyId: string): Promise<Paged<Deal>> {
  return request<Paged<Deal>>(`/api/crm/deals${qs({ companyId })}`);
}

// ── Notes (API_CONTRACT §2) ─────────────────────────────────────
export function listNotes(entityType: NoteEntityType, entityId: string): Promise<Note[]> {
  return request<Note[]>(`/api/crm/notes${qs({ entityType, entityId })}`);
}
export function createNote(input: {
  entityType: NoteEntityType;
  entityId: string;
  body: string;
  noteType?: NoteType;
  pinned?: 0 | 1;
}): Promise<Note> {
  return request<Note>("/api/crm/notes", { method: "POST", body: input });
}
export function updateNote(id: string, patch: Partial<Pick<Note, "body" | "noteType" | "pinned">>): Promise<Note> {
  return request<Note>(`/api/crm/notes/${id}`, { method: "PATCH", body: patch });
}
export function deleteNote(id: string): Promise<void> {
  return request<void>(`/api/crm/notes/${id}`, { method: "DELETE" });
}

// ── Provenance (「確認/細填」data source) (API_CONTRACT §2) ──────
export function getProvenance(entityType: string, entityId: string): Promise<FieldProvenance[]> {
  return request<FieldProvenance[]>(`/api/crm/provenance${qs({ entityType, entityId })}`);
}
/** 確認: mark a field verified=1 (value unchanged). 細填 = PATCH the entity instead. */
export function confirmProvenance(input: {
  entityType: string;
  entityId: string;
  fieldName: string;
}): Promise<void> {
  return request<void>("/api/crm/provenance/confirm", { method: "POST", body: input });
}

// ── Research engine (enrich + grounding) (API_CONTRACT §3) ──────
export function enrich(input: {
  targetType: CrawlTargetType;
  targetId: string;
  mode: EnrichMode;
  url?: string;
}): Promise<{ jobId: string }> {
  return request<{ jobId: string }>("/api/research/enrich", { method: "POST", body: input });
}
export function getResearchJob(id: string): Promise<ResearchJob> {
  return request<ResearchJob>(`/api/research/jobs/${id}`);
}
export function listResearchJobs(targetId: string): Promise<ResearchJob[]> {
  return request<ResearchJob[]>(`/api/research/jobs${qs({ targetId })}`);
}
export function ground(input: { query: string; companyId?: string; meetingId?: string }): Promise<GroundResult> {
  return request<GroundResult>("/api/research/ground", { method: "POST", body: input });
}

// ── Decks / DynamicSlide (API_CONTRACT §4) ──────────────────────
// Long tasks (image generation) use the job pattern: POST → 202 { jobId }, GET polls.
export function listDecks(): Promise<Paged<DeckSummary>> {
  return request<Paged<DeckSummary>>("/api/decks");
}
/** Wizard generate (sync — may be slow; caller shows a loading state). companyId enables CRM grounding. */
export function generateDeck(input: GenerateDeckInput): Promise<Deck> {
  return request<Deck>("/api/decks/generate", { method: "POST", body: input });
}
/**
 * Import a .pptx/.pdf (multipart). Conversion (rasterize original pages) runs as a background job,
 * so this returns 202 `{ deckId, jobId }` immediately — the deck starts `importStatus:'processing'`
 * with 0 slides; the editor routes to /studio/:deckId and polls getDeck until 'ready' (or 'failed').
 */
export function importDeck(file: File): Promise<{ deckId: string; jobId: string }> {
  const form = new FormData();
  form.append("file", file);
  return requestForm<{ deckId: string; jobId: string }>("/api/decks/import", form);
}
export function getDeck(id: string): Promise<DeckView> {
  return request<DeckView>(`/api/decks/${id}`);
}
/**
 * Edit a slide (pre-meeting; live = pending region only, else 409 per I1).
 * Returns void — the caller already holds the SlideSpec it sent; surface a 409 as the "already-played" error state.
 */
export function patchSlide(deckId: string, index: number, slide: SlideSpec): Promise<void> {
  return request<void>(`/api/decks/${deckId}/slides/${index}`, { method: "PATCH", body: { slide } });
}
/** Enqueue a pre-meeting AI image (OpenAI gpt-image-2, ~10–80s) → 202 { jobId }. */
export function enqueueImageJob(
  deckId: string,
  input: { slideIndex: number; kind: ImageKind; prompt?: string },
): Promise<{ jobId: string }> {
  return request<{ jobId: string }>(`/api/decks/${deckId}/image-jobs`, { method: "POST", body: input });
}
/** Poll an image job. status='refused' ⇒ moderation blocked ⇒ frontend shows fallback gradient. */
export function getImageJob(jobId: string): Promise<ImageJobView> {
  return request<ImageJobView>(`/api/image-jobs/${jobId}`);
}
/**
 * Download the deck in its native format via the dual-path export endpoint: pptx/native decks → .pptx,
 * pdf decks → .pdf (server picks by deck.sourceKind; the caller sets the download filename extension).
 * Original imported pages are preserved byte-for-byte; only supplement pages are appended. Returns a Blob
 * (Bearer auth precludes <a href>).
 */
export function exportDeck(id: string): Promise<Blob> {
  return requestBlob(`/api/decks/${id}/export`);
}
/** Wizard grounding: fetch readable text from a URL (SSRF-guarded server-side). */
export function extractUrl(url: string): Promise<{ title?: string; text: string }> {
  return request<{ title?: string; text: string }>("/api/extract-url", { method: "POST", body: { url } });
}
/** Wizard grounding: extract text from an uploaded PDF (multipart). */
export function extractPdf(file: File): Promise<{ text: string }> {
  const form = new FormData();
  form.append("file", file);
  return requestForm<{ text: string }>("/api/extract-pdf", form);
}

// ── Meetings / live session (API_CONTRACT §5) ───────────────────

/** Meeting reference (POST /api/meetings result + list rows). Full domain lands with M3. */
export interface MeetingRef {
  id: string;
  title?: string;
  companyId?: string;
  dealId?: string;
  deckId?: string;
  status?: string;
  createdAt?: number;
}
/** POST /api/meetings result: the meeting + short-lived WS credentials (role-bound wsToken). */
export interface CreateMeetingResult {
  meeting: MeetingRef;
  wsUrl: string;
  wsToken: string;
}
/** GET /api/meetings/:id — post-meeting review. */
export interface MeetingDetail {
  meeting: MeetingRef;
  signals: SignalItem[];
  transcript: TranscriptSegment[];
  actions: unknown[];
}
export function createMeeting(input: {
  title: string;
  companyId?: string;
  dealId?: string;
  deckId?: string;
}): Promise<CreateMeetingResult> {
  return request<CreateMeetingResult>("/api/meetings", { method: "POST", body: input });
}
export function getMeeting(id: string): Promise<MeetingDetail> {
  return request<MeetingDetail>(`/api/meetings/${id}`);
}
export function endMeeting(id: string): Promise<{ summary?: string }> {
  return request<{ summary?: string }>(`/api/meetings/${id}/end`, { method: "POST" });
}
export function listMeetings(): Promise<Paged<MeetingRef>> {
  return request<Paged<MeetingRef>>("/api/meetings");
}
/**
 * Approval-gated meeting-signal → CRM writeback (API_CONTRACT §5; CRM_SCHEMA §7). `value` is the human-approved
 * value (may be edited from the signal's suggestion): array fields append it, scalar fields set it. Server stamps
 * provenance filled_by='human' + source_type='meeting' + source_detail=meetingId + verified=1.
 */
export function writebackSignal(
  meetingId: string,
  signalId: string,
  input: { targetType: "contact" | "deal"; targetId: string; field: string; value: unknown },
): Promise<{ target: Contact | Deal }> {
  return request<{ target: Contact | Deal }>(
    `/api/meetings/${meetingId}/signals/${signalId}/writeback`,
    { method: "POST", body: input },
  );
}

// ── Train / voice simulation (API_CONTRACT §7) ──────────────────
/** Only contacts whose persona fields pass the verified gate are returned (trust rule). */
export function listPersonas(companyId?: string): Promise<PersonaOption[]> {
  return request<PersonaOption[]>(`/api/train/personas${qs({ companyId })}`);
}
/** Start a session → ephemeralToken to connect the browser DIRECTLY to Gemini Live (audio never hits our server). */
export function startTrainSession(input: {
  contactId: string;
  dealId?: string;
  difficulty?: TrainDifficulty;
}): Promise<StartTrainSessionResult> {
  return request<StartTrainSessionResult>("/api/train/sessions", { method: "POST", body: input });
}
/** Upload the two-way transcript (during / at end of practice). */
export function saveTrainTranscript(sessionId: string, turns: TrainTurn[]): Promise<void> {
  return request<void>(`/api/train/sessions/${sessionId}/transcript`, { method: "POST", body: { turns } });
}
/** Finish → triggers scoring → { reportId }. */
export function finishTrainSession(sessionId: string): Promise<{ reportId: string }> {
  return request<{ reportId: string }>(`/api/train/sessions/${sessionId}/finish`, { method: "POST" });
}
export function getTrainReport(reportId: string): Promise<TrainReport> {
  return request<TrainReport>(`/api/train/reports/${reportId}`);
}

// ── Org / invite-based membership (API_CONTRACT §D) ─────────────
// All owner/admin only except accept (any logged-in user). org isolation is server-side from the JWT
// (management) or from the invite token (accept) — the frontend never sends orgId.

/** POST /api/org/invites result: the created invite + a copyable accept link. */
export interface CreateInviteResult {
  invite: Invite;
  acceptUrl: string;
}
/** POST /api/org/invites/accept result: the joined org + granted role. */
export interface AcceptInviteResult {
  org: AuthOrg;
  role: MembershipRole;
}

export function listOrgMembers(): Promise<OrgMember[]> {
  return request<OrgMember[]>("/api/org/members");
}
export function listOrgInvites(): Promise<Invite[]> {
  return request<Invite[]>("/api/org/invites");
}
export function createOrgInvite(input: { email: string; role: InviteRole }): Promise<CreateInviteResult> {
  return request<CreateInviteResult>("/api/org/invites", { method: "POST", body: input });
}
export function revokeOrgInvite(id: string): Promise<void> {
  return request<void>(`/api/org/invites/${id}`, { method: "DELETE" });
}
export function acceptOrgInvite(token: string): Promise<AcceptInviteResult> {
  return request<AcceptInviteResult>("/api/org/invites/accept", { method: "POST", body: { token } });
}
export function updateOrgMemberRole(userId: string, role: MembershipRole): Promise<void> {
  return request<void>(`/api/org/members/${userId}`, { method: "PATCH", body: { role } });
}
export function removeOrgMember(userId: string): Promise<void> {
  return request<void>(`/api/org/members/${userId}`, { method: "DELETE" });
}
