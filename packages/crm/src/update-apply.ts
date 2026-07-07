/**
 * 細填（human 覆寫）的共用實作（M1_CONTRACT §3）：PATCH 一實體時，於**單一 tx** 內
 *  (1) 更新被改的實體欄位 + bump updated_at（可選 bump verified_status='partial'）
 *  (2) 對每個被改欄位插一列 provenance `filled_by='human', verified=1`（隱含權威），舊列 superseded。
 * Company/Contact/CompanyProduct/Deal 的 update() 共用本函式（entityType 各異）。
 */
import type { DbPort, ByUser } from "./ports.js";
import type { NewProvenance } from "@meetcopilot/shared";
import { patchToRecord, updateRow, type FieldDef } from "./mappers.js";
import { recordProvenanceRows } from "./provenance-write.js";

export interface HumanUpdateOpts {
  bumpVerified?: boolean; // true → SET verified_status='partial'（company/contact/product）
}

/** 值快照：json 欄序列化、scalar 轉字串、null/undefined→undefined（provenance value_snapshot 允許 NULL）。 */
function snapshot(def: FieldDef, v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (def.kind === "json") return JSON.stringify(v);
  return String(v);
}

export async function applyHumanUpdate(
  db: DbPort,
  table: string,
  entityType: string,
  orgId: string,
  id: string,
  patch: Record<string, unknown>,
  defs: FieldDef[],
  by: ByUser,
  opts: HumanUpdateOpts = {},
): Promise<void> {
  await db.tx(async () => {
    const now = Date.now();
    const rec = patchToRecord(patch, defs);
    rec.updated_at = now;
    if (opts.bumpVerified) rec.verified_status = "partial";
    await updateRow(db, table, orgId, id, rec);

    const provRows: NewProvenance[] = [];
    for (const d of defs) {
      if (d.sys) continue;
      if (!(d.key in patch)) continue;
      provRows.push({
        entityType,
        entityId: id,
        fieldName: d.key,
        valueSnapshot: snapshot(d, patch[d.key]),
        filledBy: "human",
        // 預設 UI 細填＝'manual'；批准回寫時呼叫端覆寫為 'meeting' + sourceDetail=meetingId（CRM_SCHEMA §7）。
        sourceType: by.sourceType ?? "manual",
        sourceDetail: by.sourceDetail,
        verified: 1,
        verifiedBy: by.userId,
        verifiedAt: now,
      });
    }
    await recordProvenanceRows(db, orgId, provRows);
  });
}
