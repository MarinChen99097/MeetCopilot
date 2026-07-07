/**
 * M5 生產強化 repository 實作（009_ops.sql；M5_CONTRACT §B）。
 * 目前只含成本記帳 UsageRepository（TASK COST 範圍）；invites/members 由 §D build agent 另實作。
 *
 * org-scoping 鐵律：每個方法收 orgId 並注入 WHERE org_id = ?（跨租戶結構上不可能外洩）。
 * 冪等鐵律：record 以 UNIQUE(org_id, idempotency_key) 去重（INSERT OR IGNORE）——同一計費呼叫重試不重複記帳。
 * row↔domain 映射（snake↔camel、epoch-ms、nullable→undefined）住在本檔；service/route 只見 domain 型別。
 */
import type { DbPort, UsageRepository } from "./ports.js";
import type { NewUsageEvent, UsageKind, UsageRollup, UsageRollupRow } from "@meetcopilot/shared";
import { USAGE_KINDS } from "@meetcopilot/shared";
import { uuidv7 } from "./uuid.js";

export class SqliteUsageRepository implements UsageRepository {
  constructor(private readonly db: DbPort) {}

  /**
   * 冪等記一筆用量。INSERT OR IGNORE → (org_id, idempotency_key) 已存在則靜默忽略（不拋錯、不重複計費）。
   * est_cost_usd 由呼叫端（Meter）依定價常數估算後帶入（欄位 NOT NULL DEFAULT 0，故一律給值）。
   */
  async record(orgId: string, event: NewUsageEvent): Promise<void> {
    await this.db.run(
      `INSERT OR IGNORE INTO usage_events
         (id, org_id, kind, model, input_tokens, output_tokens, est_cost_usd, meeting_id, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv7(),
        orgId,
        event.kind,
        event.model ?? null,
        event.inputTokens ?? null,
        event.outputTokens ?? null,
        event.estCostUsd,
        event.meetingId ?? null,
        event.idempotencyKey,
        Date.now(),
      ],
    );
  }

  /**
   * per-org rollup：[from, to] 窗內（含端點）依 kind 分組加總事件數／token／成本 + 總成本。
   * 走 idx_usage_events_org_created(org_id, created_at)。缺該 kind 的分組不出現在 byKind（呼叫端可自行補零）。
   */
  async rollup(orgId: string, from: number, to: number): Promise<UsageRollup> {
    const rows = await this.db.all<{
      kind: string;
      events: number;
      in_tokens: number;
      out_tokens: number;
      cost_usd: number;
    }>(
      `SELECT kind,
              COUNT(*)                       AS events,
              COALESCE(SUM(input_tokens), 0) AS in_tokens,
              COALESCE(SUM(output_tokens), 0) AS out_tokens,
              COALESCE(SUM(est_cost_usd), 0) AS cost_usd
         FROM usage_events
        WHERE org_id = ? AND created_at >= ? AND created_at <= ?
        GROUP BY kind`,
      [orgId, from, to],
    );

    const byKind: UsageRollupRow[] = rows
      // 防禦：只納入合法 kind（CHECK 已保證，但 domain 邊界仍窄化）。
      .filter((r): r is typeof r & { kind: UsageKind } => (USAGE_KINDS as readonly string[]).includes(r.kind))
      .map((r) => ({
        kind: r.kind,
        events: Number(r.events),
        inputTokens: Number(r.in_tokens),
        outputTokens: Number(r.out_tokens),
        costUsd: Number(r.cost_usd),
      }));

    const totalCostUsd = byKind.reduce((sum, r) => sum + r.costUsd, 0);
    return { from, to, totalCostUsd, byKind };
  }
}
