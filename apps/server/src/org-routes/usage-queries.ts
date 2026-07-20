/**
 * org-scoped 用量查詢（GET /api/org/usage、/api/org/usage/events）——每個 org 看**自己**的 AI 花費明細。
 * 與 admin-routes/admin-queries 的跨 org 版同構，但**一律 `WHERE org_id = ?`**（租戶隔離；orgId 由 JWT 推導，前端不傳）。
 *
 * 慣例（同 admin-queries）：佔位符一律 `?`（PgDbPort 於邊界轉 `$n`）；日期分組用 JS 依 UTC 分桶（strftime/to_char
 * 兩方言語法不同，故不用）。成本＝寫入時凍結的 est_cost_usd 估算值（非帳單金額；稅率/markup 由前端顯示層套）。
 */
import type { DbPort } from "@meetcopilot/crm";

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
export interface OrgUsage {
  from: number;
  to: number;
  totalCostUsd: number; // 稅前
  totalCostUsdPosttax: number; // 含稅（019）
  totalInputTokens: number;
  totalOutputTokens: number;
  rows: OrgUsageRow[];
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
      acc.costUsdPosttax += pretax * Number(r.cost_tax_multiplier ?? 1.25);
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
      costTaxMultiplier: Number(r.cost_tax_multiplier ?? 1.25),
      meetingId: r.meeting_id,
      createdAt: Number(r.created_at),
    })),
  };
}
