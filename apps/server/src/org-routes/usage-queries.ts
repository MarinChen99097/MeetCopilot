/**
 * org-scoped 用量查詢（GET /api/org/usage、/api/org/usage/events）——每個 org 看**自己**的 AI 花費明細。
 * 與 admin-routes/admin-queries 的跨 org 版同構，但**一律 `WHERE org_id = ?`**（租戶隔離；orgId 由 JWT 推導，前端不傳）。
 *
 * 慣例（同 admin-queries）：佔位符一律 `?`（PgDbPort 於邊界轉 `$n`）；日期分組用 JS 依 UTC 分桶（strftime/to_char
 * 兩方言語法不同，故不用）。成本＝寫入時凍結的 est_cost_usd 估算值（非帳單金額；稅率/markup 由前端顯示層套）。
 */
import type { DbPort } from "@meetcopilot/crm";

/**
 * 019 遷移**之前**寫入、因而沒有 `cost_tax_multiplier` 快照的舊列所採用的固定缺省稅率。
 * **刻意不接** pricing.ts 的 `DEFAULT_TAX_MULTIPLIER`——那個可被 env `COST_TAX_MULTIPLIER` 覆寫，
 * 接過去會讓「已凍結的歷史列」隨 env 浮動（改一次 env 就改寫歷史帳）。此值是歷史常數，不該變。
 */
const LEGACY_TAX_MULTIPLIER = 1.25;

export const ORG_USAGE_GROUP_BY = ["kind", "model", "day"] as const;
export type OrgUsageGroupBy = (typeof ORG_USAGE_GROUP_BY)[number];

export interface OrgUsageRow {
  key: string;
  events: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number; // 稅前（SUM est_cost_usd）
  costUsdPosttax: number; // 含稅（SUM est_cost_usd × 每列 cost_tax_multiplier，019）
}
/**
 * 月預算（W4）：**只有** env `ORG_MONTHLY_BUDGET_USD` 有設才會出現在回應裡；未設＝整個 `budget` 欄不存在，
 * 前端不渲染預算條（不發明資料）。全平台單一上限（無 per-org 設定表——不為此開 migration）。
 * `spent*` 為**當月至今**（UTC 月初 → now），與呼叫端傳入的 from/to 查詢窗**無關**——預算條問的永遠是「這個月燒了多少」。
 */
export interface OrgBudget {
  monthlyUsd: number;
  /** 當月起點（UTC 月初 00:00）epoch-ms；前端顯示「本月」區間用。 */
  monthStart: number;
  spentUsd: number; // 稅前
  spentUsdPosttax: number; // 含稅（預算條分子用這個——使用者實際看到的是含稅）
}

export interface OrgUsage {
  from: number;
  to: number;
  totalCostUsd: number; // 稅前
  totalCostUsdPosttax: number; // 含稅（019）
  totalInputTokens: number;
  totalOutputTokens: number;
  rows: OrgUsageRow[];
  /** 月預算＋當月至今花費；env 未設 → 不存在（見 OrgBudget）。 */
  budget?: OrgBudget;
}

/** 本 org [from,to] 窗內用量，依 kind/model/day 分組加總＋總計。 */
export async function orgUsage(
  db: DbPort,
  orgId: string,
  opts: { from: number; to: number; groupBy: OrgUsageGroupBy },
): Promise<OrgUsage> {
  const { from, to, groupBy } = opts;
  let rows: OrgUsageRow[];

  if (groupBy === "day") {
    // JS 依 UTC 分桶（方言無關）。窗內事件量有界（預設 30 天），逐列拉回即可。含稅＝est_cost_usd × 每列稅率。
    const raw = await db.all<{
      created_at: number;
      input_tokens: number | null;
      output_tokens: number | null;
      est_cost_usd: number;
      cost_tax_multiplier: number | null;
    }>(
      "SELECT created_at, input_tokens, output_tokens, est_cost_usd, cost_tax_multiplier FROM usage_events WHERE org_id = ? AND created_at >= ? AND created_at <= ?",
      [orgId, from, to],
    );
    const byDay = new Map<string, OrgUsageRow>();
    for (const r of raw) {
      const day = new Date(Number(r.created_at)).toISOString().slice(0, 10);
      const acc =
        byDay.get(day) ?? { key: day, events: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, costUsdPosttax: 0 };
      const pretax = Number(r.est_cost_usd ?? 0);
      acc.events += 1;
      acc.inputTokens += Number(r.input_tokens ?? 0);
      acc.outputTokens += Number(r.output_tokens ?? 0);
      acc.costUsd += pretax;
      acc.costUsdPosttax += pretax * Number(r.cost_tax_multiplier ?? LEGACY_TAX_MULTIPLIER);
      byDay.set(day, acc);
    }
    rows = [...byDay.values()].sort((a, b) => a.key.localeCompare(b.key));
  } else {
    // groupBy ∈ {kind, model}——欄名來自受控列舉，非使用者輸入（避免 SQL 注入）。含稅在 SQL 內以每列稅率加總。
    const groupCol = groupBy === "kind" ? "kind" : "model";
    const raw = await db.all<{
      key: string | null;
      events: number;
      in_tokens: number;
      out_tokens: number;
      cost_usd: number;
      cost_posttax: number;
    }>(
      `SELECT ${groupCol} AS key,
              COUNT(*) AS events,
              COALESCE(SUM(input_tokens), 0) AS in_tokens,
              COALESCE(SUM(output_tokens), 0) AS out_tokens,
              COALESCE(SUM(est_cost_usd), 0) AS cost_usd,
              COALESCE(SUM(est_cost_usd * cost_tax_multiplier), 0) AS cost_posttax
         FROM usage_events
        WHERE org_id = ? AND created_at >= ? AND created_at <= ?
        GROUP BY ${groupCol}
        ORDER BY cost_usd DESC`,
      [orgId, from, to],
    );
    rows = raw.map((r) => ({
      key: r.key ?? "(none)",
      events: Number(r.events),
      inputTokens: Number(r.in_tokens),
      outputTokens: Number(r.out_tokens),
      costUsd: Number(r.cost_usd),
      costUsdPosttax: Number(r.cost_posttax),
    }));
  }

  const totalCostUsd = rows.reduce((s, r) => s + r.costUsd, 0);
  const totalCostUsdPosttax = rows.reduce((s, r) => s + r.costUsdPosttax, 0);
  const totalInputTokens = rows.reduce((s, r) => s + r.inputTokens, 0);
  const totalOutputTokens = rows.reduce((s, r) => s + r.outputTokens, 0);
  return { from, to, totalCostUsd, totalCostUsdPosttax, totalInputTokens, totalOutputTokens, rows };
}

/**
 * env `ORG_MONTHLY_BUDGET_USD` → 月上限（USD）。未設／空／非數／≤0 → null（＝沒有預算，回應不帶 budget）。
 * **每次請求現讀**（不在模組載入期凍結）：Cloud Run 改 env 後重啟即生效，且測試可逐案設定。
 */
export function readMonthlyBudgetUsd(): number | null {
  const raw = (process.env.ORG_MONTHLY_BUDGET_USD ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** 當月（UTC）起點 epoch-ms。日分桶已是 UTC（見上方註解），此處沿用同一時鐘域，避免兩套月界。 */
export function utcMonthStart(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** 當月至今（UTC 月初 → now）本 org 花費；配合 readMonthlyBudgetUsd 組成 OrgBudget。 */
export async function orgMonthToDateSpend(
  db: DbPort,
  orgId: string,
  now: number,
): Promise<{ monthStart: number; spentUsd: number; spentUsdPosttax: number }> {
  const monthStart = utcMonthStart(now);
  const row = await db.get<{ pretax: number | null; posttax: number | null }>(
    `SELECT COALESCE(SUM(est_cost_usd), 0) AS pretax,
            COALESCE(SUM(est_cost_usd * COALESCE(cost_tax_multiplier, ${LEGACY_TAX_MULTIPLIER})), 0) AS posttax
       FROM usage_events
      WHERE org_id = ? AND created_at >= ? AND created_at <= ?`,
    [orgId, monthStart, now],
  );
  return {
    monthStart,
    spentUsd: Number(row?.pretax ?? 0),
    spentUsdPosttax: Number(row?.posttax ?? 0),
  };
}

/** 單場會議的成本列（GET /api/org/usage/by-meeting）。 */
export interface OrgMeetingCostRow {
  meetingId: string;
  /** 會議標題；usage_event 指向的會議已被刪除／標題為空 → undefined（前端顯示 meetingId 尾碼即可）。 */
  title?: string;
  events: number;
  costUsd: number; // 稅前
  costUsdPosttax: number; // 含稅
}

/**
 * 「最貴的 N 場會議」——依 usage_events.meeting_id 分組加總。
 *
 * **涵蓋範圍（不發明資料）**：只含**會中**產生的用量——meeting_id 由 realtime hub／metering-context 於會議脈絡下
 * 帶入（hub.ts、metering-context.ts）。會前的 deck 生成、研究爬蟲、persona 草擬等呼叫**沒有** meeting_id，
 * 因此不計入任何一場；`meeting_id IS NULL` 的列一律排除，不做任何歸屬臆測。
 * 租戶隔離：usage_events 與 meetings 兩邊都 `org_id = ?`（join 條件亦帶 org_id，跨 org 的會議標題永不外洩）。
 */
export async function orgUsageByMeeting(
  db: DbPort,
  orgId: string,
  opts: { from: number; to: number; limit: number },
): Promise<{ items: OrgMeetingCostRow[] }> {
  const raw = await db.all<{
    meeting_id: string;
    title: string | null;
    events: number;
    cost_usd: number;
    cost_posttax: number;
  }>(
    `SELECT u.meeting_id AS meeting_id,
            m.title AS title,
            COUNT(*) AS events,
            COALESCE(SUM(u.est_cost_usd), 0) AS cost_usd,
            COALESCE(SUM(u.est_cost_usd * COALESCE(u.cost_tax_multiplier, ${LEGACY_TAX_MULTIPLIER})), 0) AS cost_posttax
       FROM usage_events u
       LEFT JOIN meetings m ON m.id = u.meeting_id AND m.org_id = u.org_id
      WHERE u.org_id = ? AND u.created_at >= ? AND u.created_at <= ? AND u.meeting_id IS NOT NULL
      GROUP BY u.meeting_id, m.title
      ORDER BY cost_usd DESC
      LIMIT ?`,
    [orgId, opts.from, opts.to, opts.limit],
  );
  return {
    items: raw.map((r) => ({
      meetingId: r.meeting_id,
      ...(r.title && r.title.trim().length > 0 ? { title: r.title } : {}),
      events: Number(r.events),
      costUsd: Number(r.cost_usd),
      costUsdPosttax: Number(r.cost_posttax),
    })),
  };
}

export interface OrgUsageEvent {
  id: string;
  userId: string | null;
  userEmail?: string;
  kind: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null; // 019
  cachedInputTokens: number | null; // 019
  retryCount: number; // 019
  estCostUsd: number; // 稅前
  costTaxMultiplier: number; // 019（含稅＝estCostUsd × 此值）
  meetingId: string | null;
  createdAt: number;
}

/** 本 org 用量明細（分頁；可選 kind 篩選）。不回 orgName（就是自己）；userEmail 為同 org 成員，合法。 */
export async function orgUsageEvents(
  db: DbPort,
  orgId: string,
  opts: { from: number; to: number; kind?: string; limit: number; offset: number },
): Promise<{ total: number; items: OrgUsageEvent[] }> {
  const filters: string[] = ["u.org_id = ?", "u.created_at >= ?", "u.created_at <= ?"];
  const params: unknown[] = [orgId, opts.from, opts.to];
  if (opts.kind) {
    filters.push("u.kind = ?");
    params.push(opts.kind);
  }
  const where = filters.join(" AND ");

  const totalRow = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM usage_events u WHERE ${where}`, params);
  const rows = await db.all<{
    id: string;
    user_id: string | null;
    user_email: string | null;
    kind: string;
    model: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    reasoning_tokens: number | null;
    cached_input_tokens: number | null;
    retry_count: number | null;
    est_cost_usd: number;
    cost_tax_multiplier: number | null;
    meeting_id: string | null;
    created_at: number;
  }>(
    `SELECT u.id AS id, u.user_id AS user_id, us.email AS user_email,
            u.kind AS kind, u.model AS model, u.input_tokens AS input_tokens, u.output_tokens AS output_tokens,
            u.reasoning_tokens AS reasoning_tokens, u.cached_input_tokens AS cached_input_tokens,
            u.retry_count AS retry_count, u.est_cost_usd AS est_cost_usd,
            u.cost_tax_multiplier AS cost_tax_multiplier, u.meeting_id AS meeting_id, u.created_at AS created_at
       FROM usage_events u
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
      userId: r.user_id,
      userEmail: r.user_email ?? undefined,
      kind: r.kind,
      model: r.model,
      inputTokens: r.input_tokens != null ? Number(r.input_tokens) : null,
      outputTokens: r.output_tokens != null ? Number(r.output_tokens) : null,
      reasoningTokens: r.reasoning_tokens != null ? Number(r.reasoning_tokens) : null,
      cachedInputTokens: r.cached_input_tokens != null ? Number(r.cached_input_tokens) : null,
      retryCount: Number(r.retry_count ?? 0),
      estCostUsd: Number(r.est_cost_usd),
      costTaxMultiplier: Number(r.cost_tax_multiplier ?? LEGACY_TAX_MULTIPLIER),
      meetingId: r.meeting_id,
      createdAt: Number(r.created_at),
    })),
  };
}
