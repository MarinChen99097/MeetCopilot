/**
 * 對方子表（contacts/products/news/locations/funding/tech/departments）的爬蟲 upsert 共用邏輯。
 * 由 Company.upsertFromCrawl（payload 內的 children）與 CompanyChildRepository.bulkUpsert* 共用。
 * dedupe：以自然鍵在 (org_id, company_id) 內比對——存在則 UPDATE 提供的欄位、否則 INSERT；
 * 故重爬不產生重複，且**不刪除**既有列（保住人已補的 persona / head_contact_id 等）。
 */
import type { DbPort } from "./ports.js";
import { insertRow, patchToRecord, uuidv7, type FieldDef } from "./mappers.js";

export interface ChildUpsertSpec {
  table: string;
  defs: FieldDef[];
  /** 自然鍵欄（snake_case）；全部有值才比對，否則直接 INSERT（無法安全去重）。 */
  matchCols: string[];
  /** 該表是否有 updated_at 欄。 */
  hasUpdatedAt: boolean;
  /** INSERT 時要蓋的系統欄（如 source/verified_status）。 */
  sysOnInsert?: Record<string, unknown>;
}

/** 依 spec 對單筆 child 做 upsert，回傳 row id。呼叫端須在需要時自行包 tx。 */
export async function upsertChild(
  db: DbPort,
  spec: ChildUpsertSpec,
  orgId: string,
  companyId: string,
  input: Record<string, unknown>,
): Promise<string> {
  const now = Date.now();
  const rec = patchToRecord(input, spec.defs);

  // 自然鍵比對（所有 matchCols 都要有值）。
  let matchable = spec.matchCols.length > 0;
  const where = ["org_id = ?", "company_id = ?"];
  const whereVals: unknown[] = [orgId, companyId];
  for (const mc of spec.matchCols) {
    const v = rec[mc];
    if (v === undefined || v === null) {
      matchable = false;
      break;
    }
    where.push(`${mc} = ?`);
    whereVals.push(v);
  }

  if (matchable) {
    const existing = await db.get<{ id: string }>(
      `SELECT id FROM ${spec.table} WHERE ${where.join(" AND ")}`,
      whereVals,
    );
    if (existing) {
      if (spec.hasUpdatedAt) rec.updated_at = now;
      const cols = Object.keys(rec);
      if (cols.length > 0) {
        await db.run(
          `UPDATE ${spec.table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE org_id = ? AND id = ?`,
          [...cols.map((c) => rec[c] ?? null), orgId, existing.id],
        );
      }
      return existing.id;
    }
  }

  const id = uuidv7();
  rec.id = id;
  rec.org_id = orgId;
  rec.company_id = companyId;
  rec.created_at = now;
  if (spec.hasUpdatedAt) rec.updated_at = now;
  if (spec.sysOnInsert) Object.assign(rec, spec.sysOnInsert);
  await insertRow(db, spec.table, rec);
  return id;
}
