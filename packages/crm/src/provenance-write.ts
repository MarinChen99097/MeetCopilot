/**
 * field_provenance 寫入的共用低階函式（信任層；CRM_SCHEMA §8、M1_CONTRACT §3）。
 * update()（human 細填）與 upsertFromCrawl()（crawler 寫入）都在**自己的 tx 內**呼叫本函式，
 * 讓「值與 provenance 同一 tx，永不漂移」成立。ProvenanceRepository.record 亦包一層 tx 呼叫本函式。
 *
 * supersede 語意：對每個 (entity_type, entity_id, field_name) 寫新 row 前，
 * 先把該欄未被 supersede 的舊 row 標 `superseded_by = 新 id`——故 listForEntity（superseded_by IS NULL）
 * 永遠只回每欄最新一筆，且重寫不累積重複列。
 *
 * crm 刻意不 runtime 依賴 @meetcopilot/shared（見 ports.ts 分層註解）：isTrusted 於此以 2 行 inline，不 import。
 */
import type { DbPort } from "./ports.js";
import type { NewProvenance } from "@meetcopilot/shared";
import { uuidv7 } from "./uuid.js";

/** 信任判準（＝shared/trust.ts 的 isTrusted，inline 以維持 crm 零 runtime 依賴）：human 填或已人驗。 */
function isTrustedRow(filledBy: string, verified: number): boolean {
  return filledBy === "human" || verified === 1;
}

/**
 * 寫一批 provenance rows（各自 supersede 該欄舊 row）。**呼叫端須已在 tx 內**（本函式不自開 tx）。
 */
export async function recordProvenanceRows(
  db: DbPort,
  orgId: string,
  rows: NewProvenance[],
): Promise<void> {
  const now = Date.now();
  for (const r of rows) {
    const newId = uuidv7();
    await db.run(
      `UPDATE field_provenance SET superseded_by = ?
       WHERE org_id = ? AND entity_type = ? AND entity_id = ? AND field_name = ? AND superseded_by IS NULL`,
      [newId, orgId, r.entityType, r.entityId, r.fieldName],
    );
    await db.run(
      `INSERT INTO field_provenance
         (id, org_id, entity_type, entity_id, field_name, value_snapshot, filled_by,
          source_type, source_url, source_detail, confidence, model, verified,
          verified_by, verified_at, superseded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId,
        orgId,
        r.entityType,
        r.entityId,
        r.fieldName,
        r.valueSnapshot ?? null,
        r.filledBy,
        r.sourceType ?? null,
        r.sourceUrl ?? null,
        r.sourceDetail ?? null,
        r.confidence ?? null,
        r.model ?? null,
        r.verified ?? 0,
        r.verifiedBy ?? null,
        r.verifiedAt ?? null,
        null,
        now,
      ],
    );
  }
}

/**
 * 回某實體「已被信任」(human 或 verified=1) 的欄位名集合（取未 superseded 最新 row）。
 * upsertFromCrawl 用它擋掉爬蟲覆寫人已細填/驗證的欄位（信任規則：human value beats crawler）。
 */
export async function trustedFieldsOf(
  db: DbPort,
  orgId: string,
  entityType: string,
  entityId: string,
): Promise<Set<string>> {
  const rows = await db.all<{ field_name: string; filled_by: string; verified: number }>(
    `SELECT field_name, filled_by, verified FROM field_provenance
     WHERE org_id = ? AND entity_type = ? AND entity_id = ? AND superseded_by IS NULL`,
    [orgId, entityType, entityId],
  );
  const trusted = new Set<string>();
  for (const r of rows) {
    if (isTrustedRow(r.filled_by, r.verified)) trusted.add(r.field_name);
  }
  return trusted;
}
