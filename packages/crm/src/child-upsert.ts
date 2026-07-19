/**
 * 對方子表（contacts/products/news/locations/funding/tech/departments/social_posts）的爬蟲 upsert 共用邏輯。
 * 由 Company.upsertFromCrawl（payload 內的 children）與 CompanyChildRepository.bulkUpsert* 共用。
 * dedupe：以自然鍵在 (org_id, company_id) 內比對——存在則 UPDATE 提供的欄位、否則 INSERT；
 * 故重爬不產生重複，且**不刪除**既有列（保住人已補的 persona / head_contact_id 等）。
 *
 * contacts 專屬（透過 spec.fallbackMatchCols / accumulateCols）：
 *  - fallbackMatchCols：primary（full_name）落空時，以次鍵（full_name_zh）再配一次；命中視為同一人 → fill-empty。
 *  - accumulateCols：title/title_zh 各自 mergeTitle 累加，而非覆寫（重爬補新頭銜段）。
 */
import type { DbPort } from "./ports.js";
import { insertRow, patchToRecord, uuidv7, type FieldDef } from "./mappers.js";
import { accumulateAndFillEmpty } from "./contact-merge.js";

export interface ChildUpsertSpec {
  table: string;
  defs: FieldDef[];
  /** 自然鍵欄（snake_case）；全部有值才比對，否則直接 INSERT（無法安全去重）。 */
  matchCols: string[];
  /** 該表是否有 updated_at 欄。 */
  hasUpdatedAt: boolean;
  /** INSERT 時要蓋的系統欄（如 source/verified_status）。 */
  sysOnInsert?: Record<string, unknown>;
  /**
   * 次要自然鍵（snake_case）：primary matchCols 落空時再配一次（全部非空才用）。
   * 命中視為「同一列」但採 fill-empty 合併（不覆寫既有非空欄）。contacts 用 full_name_zh。
   */
  fallbackMatchCols?: string[];
  /** 累加欄（snake_case）：新舊值以 mergeTitle 串接而非覆寫。contacts 用 [title, title_zh]。 */
  accumulateCols?: string[];
}

/** 依 matchCols 在 (org_id, company_id) 內取整列；任一鍵欄空或 matchCols 空 → undefined（無法安全去重）。 */
async function matchRow(
  db: DbPort,
  spec: ChildUpsertSpec,
  cols: string[],
  orgId: string,
  companyId: string,
  rec: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  if (cols.length === 0) return undefined;
  const where = ["org_id = ?", "company_id = ?"];
  const vals: unknown[] = [orgId, companyId];
  for (const mc of cols) {
    const v = rec[mc];
    if (v === undefined || v === null) return undefined;
    where.push(`${mc} = ?`);
    vals.push(v);
  }
  return db.get<Record<string, unknown>>(`SELECT * FROM ${spec.table} WHERE ${where.join(" AND ")}`, vals);
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

  // primary 自然鍵比對；落空且有 fallbackMatchCols → 次鍵再配一次（fill-empty 合併）。
  let matched = await matchRow(db, spec, spec.matchCols, orgId, companyId, rec);
  let matchedByFallback = false;
  if (!matched && spec.fallbackMatchCols && spec.fallbackMatchCols.length > 0) {
    matched = await matchRow(db, spec, spec.fallbackMatchCols, orgId, companyId, rec);
    if (matched) matchedByFallback = true;
  }

  if (matched) {
    // 累加欄合併 ＋（fallback 命中時）fill-empty；就地調整 rec。
    if (matchedByFallback || (spec.accumulateCols && spec.accumulateCols.length > 0)) {
      accumulateAndFillEmpty(rec, matched, {
        accumulateCols: spec.accumulateCols ?? [],
        fillEmpty: matchedByFallback,
      });
    }
    if (spec.hasUpdatedAt) rec.updated_at = now;
    const cols = Object.keys(rec);
    if (cols.length > 0) {
      await db.run(
        `UPDATE ${spec.table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE org_id = ? AND id = ?`,
        [...cols.map((c) => rec[c] ?? null), orgId, matched.id],
      );
    }
    return matched.id as string;
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
