/**
 * admin-queries — 平台管理後台的**跨 org** 資料查詢（ADMIN_CONTRACT §4）。
 *
 * 這裡是唯一刻意「不帶 org filter」的模組：admin 是平台營運視角，需跨租戶讀取。故一律走 raw `DbPort`
 * （ports.ts §10）的參數化 SQL，而非 org-scoped repository。安全由 route 層的 `platformAdminRequired`（A1）
 * 把關——本模組不做授權，只做查詢。
 *
 * 方言相容（SQLite ⇄ Postgres）：
 *  - 佔位符一律 `?`（PgDbPort 於邊界轉 `$n`，見 pg-db.ts）。
 *  - 欄位別名一律小寫 snake（PG 會把未加引號的別名摺成小寫）——回傳前於 JS 映射成 camelCase。
 *  - 日期分組（groupBy=day / stats）用 **JS 依 UTC 分桶**，不用 strftime/to_char（兩方言語法不同）。
 *  - COALESCE/SUM/COUNT/CASE/LEFT JOIN/LIMIT/OFFSET 兩方言皆同。
 *
 * A3（不回秘密）：任何查詢都不 SELECT password_hash / invite.token / api key。
 */
import type { CrmCore, DbPort } from "@meetcopilot/crm";
import type { UsageKind } from "@meetcopilot/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────
// 共用 job 映射（durationMs/queueMs server 端算好；§4 #7）
// ─────────────────────────────────────────────────────────────
interface JobRow {
  id: string;
  org_id: string;
  org_name: string | null;
  target_type: string;
  target_id: string;
  mode: string;
  status: string;
  error: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface AdminJobItem {
  id: string;
  orgId: string;
  orgName: string | null;
  targetType: string;
  targetId: string;
  targetName?: string;
  mode: string;
  status: string;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  queueMs: number | null;
}

function mapJob(r: JobRow): AdminJobItem {
  const durationMs = r.started_at != null && r.finished_at != null ? r.finished_at - r.started_at : null;
  const queueMs = r.started_at != null ? r.started_at - r.created_at : null;
  return {
    id: r.id,
    orgId: r.org_id,
    orgName: r.org_name,
    targetType: r.target_type,
    targetId: r.target_id,
    mode: r.mode,
    status: r.status,
    error: r.error,
    createdAt: Number(r.created_at),
    startedAt: r.started_at != null ? Number(r.started_at) : null,
    finishedAt: r.finished_at != null ? Number(r.finished_at) : null,
    durationMs: durationMs != null ? Number(durationMs) : null,
    queueMs: queueMs != null ? Number(queueMs) : null,
  };
}

const JOB_SELECT = `SELECT j.id AS id, j.org_id AS org_id, o.name AS org_name, j.target_type AS target_type,
                           j.target_id AS target_id, j.mode AS mode, j.status AS status, j.error AS error,
                           j.created_at AS created_at, j.started_at AS started_at, j.finished_at AS finished_at
                      FROM crawl_jobs j LEFT JOIN orgs o ON o.id = j.org_id`;

// ─────────────────────────────────────────────────────────────
// #1 GET /api/admin/overview
// ─────────────────────────────────────────────────────────────
export interface AdminOverview {
  costUsd: { today: number; last7d: number; last30d: number };
  orgs: { total: number; suspended: number };
  users: { total: number };
  jobs: { running: number; failedLast7d: number; doneLast7d: number };
  health: { ready: boolean };
}

/** UTC 當日 0 時的 epoch ms。 */
function utcMidnight(now: number): number {
  return Date.parse(new Date(now).toISOString().slice(0, 10) + "T00:00:00.000Z");
}

async function sumCost(db: DbPort, sinceMs: number): Promise<number> {
  const row = await db.get<{ c: number }>(
    "SELECT COALESCE(SUM(est_cost_usd), 0) AS c FROM usage_events WHERE created_at >= ?",
    [sinceMs],
  );
  return Number(row?.c ?? 0);
}

async function countJobs(db: DbPort, where: string, params: unknown[]): Promise<number> {
  const row = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM crawl_jobs WHERE ${where}`, params);
  return Number(row?.n ?? 0);
}

export async function adminOverview(db: DbPort, now: number): Promise<AdminOverview> {
  const since7 = now - 7 * DAY_MS;
  const since30 = now - 30 * DAY_MS;
  // 冷路徑，但這些讀取彼此獨立 → 一次併發（結果與逐一 await 完全相同；PG 併行、SQLite 同步無害）。
  const [orgAgg, userAgg, costToday, costLast7d, costLast30d, jobsRunning, jobsFailedLast7d, jobsDoneLast7d, ready] =
    await Promise.all([
      db.get<{ total: number; suspended: number }>(
        "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END), 0) AS suspended FROM orgs",
        [],
      ),
      db.get<{ total: number }>("SELECT COUNT(*) AS total FROM users", []),
      sumCost(db, utcMidnight(now)),
      sumCost(db, since7),
      sumCost(db, since30),
      countJobs(db, "status = 'running'", []),
      countJobs(db, "status = 'failed' AND created_at >= ?", [since7]),
      countJobs(db, "status = 'done' AND created_at >= ?", [since7]),
      dbReady(db),
    ]);
  return {
    costUsd: { today: costToday, last7d: costLast7d, last30d: costLast30d },
    orgs: { total: Number(orgAgg?.total ?? 0), suspended: Number(orgAgg?.suspended ?? 0) },
    users: { total: Number(userAgg?.total ?? 0) },
    jobs: { running: jobsRunning, failedLast7d: jobsFailedLast7d, doneLast7d: jobsDoneLast7d },
    health: { ready },
  };
}

// ─────────────────────────────────────────────────────────────
// #2 GET /api/admin/usage?from&to&groupBy=org|kind|model|day
// ─────────────────────────────────────────────────────────────
export type UsageGroupBy = "org" | "kind" | "model" | "day";

export interface AdminUsageRow {
  key: string;
  orgName?: string;
  events: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}
export interface AdminUsage {
  from: number;
  to: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  rows: AdminUsageRow[];
}

export async function adminUsage(
  db: DbPort,
  opts: { from: number; to: number; groupBy: UsageGroupBy },
): Promise<AdminUsage> {
  const { from, to, groupBy } = opts;
  let rows: AdminUsageRow[];

  if (groupBy === "day") {
    // JS 依 UTC 分桶（方言無關）。窗內事件量有界（預設 30 天），逐列拉回即可。
    const raw = await db.all<{ created_at: number; input_tokens: number | null; output_tokens: number | null; est_cost_usd: number }>(
      "SELECT created_at, input_tokens, output_tokens, est_cost_usd FROM usage_events WHERE created_at >= ? AND created_at <= ?",
      [from, to],
    );
    const byDay = new Map<string, AdminUsageRow>();
    for (const r of raw) {
      const day = new Date(Number(r.created_at)).toISOString().slice(0, 10);
      const acc = byDay.get(day) ?? { key: day, events: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
      acc.events += 1;
      acc.inputTokens += Number(r.input_tokens ?? 0);
      acc.outputTokens += Number(r.output_tokens ?? 0);
      acc.costUsd += Number(r.est_cost_usd ?? 0);
      byDay.set(day, acc);
    }
    rows = [...byDay.values()].sort((a, b) => a.key.localeCompare(b.key));
  } else {
    const groupCol = groupBy === "org" ? "u.org_id" : groupBy === "kind" ? "u.kind" : "u.model";
    const orgNameSel = groupBy === "org" ? ", o.name AS org_name" : "";
    const orgJoin = groupBy === "org" ? " LEFT JOIN orgs o ON o.id = u.org_id" : "";
    const groupExtra = groupBy === "org" ? ", o.name" : "";
    const raw = await db.all<{
      key: string | null;
      org_name?: string | null;
      events: number;
      in_tokens: number;
      out_tokens: number;
      cost_usd: number;
    }>(
      `SELECT ${groupCol} AS key${orgNameSel},
              COUNT(*) AS events,
              COALESCE(SUM(u.input_tokens), 0) AS in_tokens,
              COALESCE(SUM(u.output_tokens), 0) AS out_tokens,
              COALESCE(SUM(u.est_cost_usd), 0) AS cost_usd
         FROM usage_events u${orgJoin}
        WHERE u.created_at >= ? AND u.created_at <= ?
        GROUP BY ${groupCol}${groupExtra}
        ORDER BY cost_usd DESC`,
      [from, to],
    );
    rows = raw.map((r) => ({
      key: r.key ?? "(none)",
      ...(groupBy === "org" ? { orgName: r.org_name ?? undefined } : {}),
      events: Number(r.events),
      inputTokens: Number(r.in_tokens),
      outputTokens: Number(r.out_tokens),
      costUsd: Number(r.cost_usd),
    }));
  }

  const totalCostUsd = rows.reduce((s, r) => s + r.costUsd, 0);
  const totalInputTokens = rows.reduce((s, r) => s + r.inputTokens, 0);
  const totalOutputTokens = rows.reduce((s, r) => s + r.outputTokens, 0);
  return { from, to, totalCostUsd, totalInputTokens, totalOutputTokens, rows };
}

// ─────────────────────────────────────────────────────────────
// #3 GET /api/admin/usage/events
// ─────────────────────────────────────────────────────────────
export interface AdminUsageEvent {
  id: string;
  orgId: string;
  orgName: string | null;
  userId: string | null;
  userEmail?: string;
  kind: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estCostUsd: number;
  meetingId: string | null;
  createdAt: number;
}

export async function adminUsageEvents(
  db: DbPort,
  opts: { from: number; to: number; orgId?: string; kind?: string; limit: number; offset: number },
): Promise<{ total: number; items: AdminUsageEvent[] }> {
  const filters: string[] = ["u.created_at >= ?", "u.created_at <= ?"];
  const params: unknown[] = [opts.from, opts.to];
  if (opts.orgId) {
    filters.push("u.org_id = ?");
    params.push(opts.orgId);
  }
  if (opts.kind) {
    filters.push("u.kind = ?");
    params.push(opts.kind);
  }
  const where = filters.join(" AND ");

  const totalRow = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM usage_events u WHERE ${where}`, params);
  const rows = await db.all<{
    id: string;
    org_id: string;
    org_name: string | null;
    user_id: string | null;
    user_email: string | null;
    kind: string;
    model: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    est_cost_usd: number;
    meeting_id: string | null;
    created_at: number;
  }>(
    `SELECT u.id AS id, u.org_id AS org_id, o.name AS org_name, u.user_id AS user_id, us.email AS user_email,
            u.kind AS kind, u.model AS model, u.input_tokens AS input_tokens, u.output_tokens AS output_tokens,
            u.est_cost_usd AS est_cost_usd, u.meeting_id AS meeting_id, u.created_at AS created_at
       FROM usage_events u
       LEFT JOIN orgs o ON o.id = u.org_id
       LEFT JOIN users us ON us.id = u.user_id
      WHERE ${where}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, opts.limit, opts.offset],
  );

  return {
    total: Number(totalRow?.n ?? 0),
    items: rows.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      orgName: r.org_name,
      userId: r.user_id,
      userEmail: r.user_email ?? undefined,
      kind: r.kind,
      model: r.model,
      inputTokens: r.input_tokens != null ? Number(r.input_tokens) : null,
      outputTokens: r.output_tokens != null ? Number(r.output_tokens) : null,
      estCostUsd: Number(r.est_cost_usd),
      meetingId: r.meeting_id,
      createdAt: Number(r.created_at),
    })),
  };
}

// ─────────────────────────────────────────────────────────────
// #4 GET /api/admin/orgs
// ─────────────────────────────────────────────────────────────
export interface AdminOrgListItem {
  id: string;
  name: string;
  status: string;
  plan: string | null;
  createdAt: number;
  memberCount: number;
  costUsd30d: number;
}

export async function adminOrgs(
  db: DbPort,
  opts: { query?: string; status?: string; now: number },
): Promise<{ items: AdminOrgListItem[] }> {
  const since30 = opts.now - 30 * DAY_MS;
  const filters: string[] = [];
  const params: unknown[] = [since30]; // correlated subquery param first (appears before WHERE params in SQL text)
  if (opts.query) {
    filters.push("LOWER(o.name) LIKE ?");
    params.push(`%${opts.query.toLowerCase()}%`);
  }
  if (opts.status) {
    filters.push("o.status = ?");
    params.push(opts.status);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const rows = await db.all<{
    id: string;
    name: string;
    status: string;
    plan: string | null;
    created_at: number;
    member_count: number;
    cost_usd_30d: number;
  }>(
    `SELECT o.id AS id, o.name AS name, o.status AS status, o.plan AS plan, o.created_at AS created_at,
            (SELECT COUNT(*) FROM memberships m WHERE m.org_id = o.id) AS member_count,
            (SELECT COALESCE(SUM(e.est_cost_usd), 0) FROM usage_events e WHERE e.org_id = o.id AND e.created_at >= ?) AS cost_usd_30d
       FROM orgs o
       ${where}
      ORDER BY o.created_at DESC`,
    params,
  );
  return {
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      plan: r.plan,
      createdAt: Number(r.created_at),
      memberCount: Number(r.member_count),
      costUsd30d: Number(r.cost_usd_30d),
    })),
  };
}

// ─────────────────────────────────────────────────────────────
// #5 GET /api/admin/orgs/:id
// ─────────────────────────────────────────────────────────────
export interface AdminOrgDetail {
  org: { id: string; name: string; status: string; plan: string | null; createdAt: number };
  members: { userId: string; email: string; displayName: string; role: string; status: string }[];
  invites: { id: string; email: string; role: string; acceptedAt: number | null; expiresAt: number | null }[];
  usage30d: { costUsd: number; byKind: { kind: string; costUsd: number }[] };
  recentJobs: AdminJobItem[];
}

export async function adminOrgDetail(core: CrmCore, orgId: string, now: number): Promise<AdminOrgDetail | null> {
  const db = core.db;
  const org = await db.get<{ id: string; name: string; status: string; plan: string | null; created_at: number }>(
    "SELECT id AS id, name AS name, status AS status, plan AS plan, created_at AS created_at FROM orgs WHERE id = ?",
    [orgId],
  );
  if (!org) return null;

  const members = await db.all<{ user_id: string; email: string | null; display_name: string | null; role: string; status: string | null }>(
    `SELECT m.user_id AS user_id, u.email AS email, u.display_name AS display_name, m.role AS role, u.status AS status
       FROM memberships m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.org_id = ? ORDER BY m.created_at ASC`,
    [orgId],
  );

  // A3：復用 SqliteInviteRepository.list（org-scoped），但**只投影不含 token 的欄位**——絕不回 invite.token。
  const invites = (await core.invites.list(orgId)).map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    acceptedAt: i.acceptedAt ?? null,
    expiresAt: i.expiresAt ?? null,
  }));

  // per-org 30 日用量：復用 core.usage.rollup（回 {totalCostUsd, byKind} 超集）。rollup 的 [from,to] 含端點、
  // to=now 不排除任何既有事件（事件不可能在未來），與原「created_at >= since30」等價。映射回原 {kind,costUsd}
  // 形狀並保留 cost DESC 排序；總成本取 rollup.totalCostUsd（＝各 kind est_cost 加總，與原 reduce 同值）。
  const since30 = now - 30 * DAY_MS;
  const rollup = await core.usage.rollup(orgId, since30, now);
  const byKind = rollup.byKind
    .map((r) => ({ kind: r.kind, costUsd: r.costUsd }))
    .sort((a, b) => b.costUsd - a.costUsd);
  const usage30dCost = rollup.totalCostUsd;

  const jobRows = await db.all<JobRow>(`${JOB_SELECT} WHERE j.org_id = ? ORDER BY j.created_at DESC LIMIT 10`, [orgId]);

  return {
    org: { id: org.id, name: org.name, status: org.status, plan: org.plan, createdAt: Number(org.created_at) },
    members: members.map((m) => ({
      userId: m.user_id,
      email: m.email ?? "",
      displayName: m.display_name ?? "",
      role: m.role,
      status: m.status ?? "active",
    })),
    invites,
    usage30d: { costUsd: usage30dCost, byKind },
    recentJobs: jobRows.map(mapJob),
  };
}

// ─────────────────────────────────────────────────────────────
// #6 PATCH status（org / user）＋自鎖守門用查詢
// ─────────────────────────────────────────────────────────────
/** 回 org 是否存在（供 404 判定）。 */
export async function orgExists(db: DbPort, orgId: string): Promise<boolean> {
  const row = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM orgs WHERE id = ?", [orgId]);
  return Number(row?.n ?? 0) > 0;
}
export async function userEmailById(core: CrmCore, userId: string): Promise<string | null> {
  // 復用 SqliteUserRepository.findById；此處僅取 email 回傳（A3：不外流 password_hash 等其他欄位）。
  return (await core.users.findById(userId))?.email ?? null;
}
/** org 內是否有成員的 email ∈ 平台管理員清單（防「停權含管理員的 org」自鎖）。復用 SqliteMemberRepository.list。 */
export async function orgMemberEmails(core: CrmCore, orgId: string): Promise<string[]> {
  return (await core.members.list(orgId)).map((m) => m.email);
}
export async function setOrgStatus(db: DbPort, orgId: string, status: string): Promise<number> {
  const res = await db.run("UPDATE orgs SET status = ? WHERE id = ?", [status, orgId]);
  return res.changes;
}
export async function setUserStatus(db: DbPort, userId: string, status: string): Promise<number> {
  const res = await db.run("UPDATE users SET status = ? WHERE id = ?", [status, userId]);
  return res.changes;
}

// ─────────────────────────────────────────────────────────────
// #7 GET /api/admin/jobs
// ─────────────────────────────────────────────────────────────
export async function adminJobs(
  db: DbPort,
  opts: { status?: string; mode?: string; orgId?: string; from: number; to: number; limit: number; offset: number },
): Promise<{ total: number; items: AdminJobItem[] }> {
  const filters: string[] = ["j.created_at >= ?", "j.created_at <= ?"];
  const params: unknown[] = [opts.from, opts.to];
  if (opts.status) {
    filters.push("j.status = ?");
    params.push(opts.status);
  }
  if (opts.mode) {
    filters.push("j.mode = ?");
    params.push(opts.mode);
  }
  if (opts.orgId) {
    filters.push("j.org_id = ?");
    params.push(opts.orgId);
  }
  const where = filters.join(" AND ");
  const totalRow = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM crawl_jobs j WHERE ${where}`, params);
  const rows = await db.all<JobRow>(
    `${JOB_SELECT} WHERE ${where} ORDER BY j.created_at DESC LIMIT ? OFFSET ?`,
    [...params, opts.limit, opts.offset],
  );
  return { total: Number(totalRow?.n ?? 0), items: rows.map(mapJob) };
}

// ─────────────────────────────────────────────────────────────
// #8 GET /api/admin/jobs/stats?days=N
// ─────────────────────────────────────────────────────────────
export interface AdminJobStats {
  days: { date: string; queued: number; running: number; done: number; failed: number }[];
  failRatePct: number;
  avgDurationMs: number;
  topErrors: { error: string; count: number }[];
}

export async function adminJobStats(db: DbPort, opts: { days: number; now: number }): Promise<AdminJobStats> {
  const windowStart = opts.now - opts.days * DAY_MS;
  const rows = await db.all<{
    status: string;
    error: string | null;
    created_at: number;
    started_at: number | null;
    finished_at: number | null;
  }>(
    "SELECT status, error, created_at, started_at, finished_at FROM crawl_jobs WHERE created_at >= ?",
    [windowStart],
  );

  // 逐日分桶（UTC）：先建 N 天的零列（含無 job 的日子）。
  const dayMap = new Map<string, { date: string; queued: number; running: number; done: number; failed: number }>();
  for (let i = opts.days - 1; i >= 0; i--) {
    const date = new Date(opts.now - i * DAY_MS).toISOString().slice(0, 10);
    dayMap.set(date, { date, queued: 0, running: 0, done: 0, failed: 0 });
  }

  let done = 0;
  let failed = 0;
  let durationSum = 0;
  let durationCount = 0;
  const errorCounts = new Map<string, number>();

  for (const r of rows) {
    const date = new Date(Number(r.created_at)).toISOString().slice(0, 10);
    const bucket = dayMap.get(date);
    if (bucket && (r.status === "queued" || r.status === "running" || r.status === "done" || r.status === "failed")) {
      bucket[r.status] += 1;
    }
    if (r.status === "done") {
      done += 1;
      if (r.started_at != null && r.finished_at != null) {
        durationSum += Number(r.finished_at) - Number(r.started_at);
        durationCount += 1;
      }
    } else if (r.status === "failed") {
      failed += 1;
      const norm = (r.error ?? "(no error message)").slice(0, 120);
      errorCounts.set(norm, (errorCounts.get(norm) ?? 0) + 1);
    }
  }

  const finished = done + failed;
  const failRatePct = finished > 0 ? Math.round((failed / finished) * 1000) / 10 : 0;
  const avgDurationMs = durationCount > 0 ? Math.round(durationSum / durationCount) : 0;
  const topErrors = [...errorCounts.entries()]
    .map(([error, count]) => ({ error, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return { days: [...dayMap.values()], failRatePct, avgDurationMs, topErrors };
}

// ─────────────────────────────────────────────────────────────
// #9 health helpers
// ─────────────────────────────────────────────────────────────
export async function dbReady(db: DbPort): Promise<boolean> {
  try {
    await db.get("SELECT 1 AS ok", []);
    return true;
  } catch {
    return false;
  }
}

/** 進行中會議數：已開始但未結束（started_at 有值、ended_at NULL）。best-effort，失敗回 0。 */
export async function liveMeetingsCount(db: DbPort): Promise<number> {
  try {
    const row = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM meetings WHERE started_at IS NOT NULL AND ended_at IS NULL",
      [],
    );
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}
