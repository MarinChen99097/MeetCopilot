/**
 * ChecklistRepository 的實作（meeting_checklist_items；migration 023）。
 * 會中「待講清單」的持久層（契約 docs/MEETING_CHECKLIST_CONTRACT.md §3）。port-agnostic（兩驅動共用，
 * 一律發 SQLite 風格 `?`，PgDbPort 於邊界轉 `$n`）。
 *
 * 兩條鐵律：
 *  1. **org-scoping**：每個方法第一參數恆為 orgId 且必進 WHERE；跨 org 一律回空陣列/null，**不 throw**
 *     （攻擊者拿不到「存在與否」的訊息差；比照 DeckRepository.findById 的行為）。
 *  2. **markCovered 只動 pending**：已 covered/skipped 的列不被自動路徑覆寫（手動＝報告者最終權威），
 *     故天然冪等；回傳「這次真的被改動」的項目，空陣列＝沒有新變化 → 呼叫端不必廣播（契約 §7.4）。
 *
 * keywords_json 防爛資料：parse 失敗、非陣列、含非字串元素一律降級（回 []／過濾掉），**絕不 crash**
 * （LLM 生成端寫入、DB 可能被手動改壞；HUD 少幾個關鍵詞不致命，整份清單掛掉才致命）。
 */
import type { DbPort, ChecklistRepository } from "./ports.js";
import type {
  ChecklistCategory,
  ChecklistCoverSource,
  ChecklistItem,
  ChecklistStatus,
  NewChecklistItem,
} from "@meetcopilot/shared";
import { uuidv7 } from "./uuid.js";

/** evidence 欄位長度上限（契約 §2.3：逐字稿片段 ≤120 字）。超出於落庫前截斷。 */
export const CHECKLIST_EVIDENCE_MAX_CHARS = 120;

interface ChecklistRow {
  id: string;
  org_id: string;
  meeting_id: string;
  idx: number;
  category: string;
  title: string;
  detail: string | null;
  slide_idx: number | null;
  keywords_json: string | null;
  priority: string;
  status: string;
  covered_by: string | null;
  covered_at: number | null;
  evidence: string | null;
  created_at: number;
  updated_at: number;
}

/** keywords_json → string[]。爛資料（非 JSON／非陣列）回 []；陣列內非字串元素丟棄。 */
function parseKeywords(raw: string | null): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((k): k is string => typeof k === "string");
}

function rowToItem(r: ChecklistRow): ChecklistItem {
  return {
    id: r.id,
    idx: r.idx,
    category: r.category as ChecklistCategory,
    title: r.title,
    detail: r.detail ?? undefined,
    slideIdx: r.slide_idx ?? undefined,
    keywords: parseKeywords(r.keywords_json),
    priority: r.priority === "nice" ? "nice" : "must",
    status: r.status as ChecklistStatus,
    coveredBy: (r.covered_by as ChecklistCoverSource | null) ?? undefined,
    coveredAt: r.covered_at ?? undefined,
    evidence: r.evidence ?? undefined,
  };
}

/** `?, ?, ?`（n 個）——IN (...) 用；n 必 >0（呼叫端已守空陣列 early return）。 */
function placeholders(n: number): string {
  return new Array(n).fill("?").join(", ");
}

const SELECT_COLS =
  "id, org_id, meeting_id, idx, category, title, detail, slide_idx, keywords_json, priority, status, covered_by, covered_at, evidence, created_at, updated_at";

export class SqliteChecklistRepository implements ChecklistRepository {
  constructor(private readonly db: DbPort) {}

  /**
   * 整份取代（生成端唯一寫入口）：先刪該場舊清單再插入新的，同一 tx。
   * 每場只生成一次（契約 §6.3），故不需 upsert 對帳；重生成＝整份換掉。
   * idx 沿用輸入值（生成端負責 0 起連號）；回傳依 idx 排序的落庫結果。
   */
  async replaceAll(orgId: string, meetingId: string, items: NewChecklistItem[]): Promise<ChecklistItem[]> {
    const now = Date.now();
    await this.db.tx(async () => {
      await this.db.run("DELETE FROM meeting_checklist_items WHERE org_id = ? AND meeting_id = ?", [
        orgId,
        meetingId,
      ]);
      for (const item of items) {
        await this.db.run(
          `INSERT INTO meeting_checklist_items
             (id, org_id, meeting_id, idx, category, title, detail, slide_idx, keywords_json,
              priority, status, covered_by, covered_at, evidence, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, ?, ?)`,
          [
            uuidv7(),
            orgId,
            meetingId,
            item.idx,
            item.category,
            item.title,
            item.detail ?? null,
            item.slideIdx ?? null,
            JSON.stringify(item.keywords ?? []),
            item.priority,
            now,
            now,
          ],
        );
      }
    });
    return this.list(orgId, meetingId);
  }

  /** 該場全部項目（依 idx 升冪；跨 org 回空陣列）。 */
  async list(orgId: string, meetingId: string): Promise<ChecklistItem[]> {
    const rows = await this.db.all<ChecklistRow>(
      `SELECT ${SELECT_COLS} FROM meeting_checklist_items
        WHERE org_id = ? AND meeting_id = ? ORDER BY idx ASC`,
      [orgId, meetingId],
    );
    return rows.map(rowToItem);
  }

  /**
   * 自動勾稽路徑（transcript／slide）與手動 check 共用的批次劃掉。
   * **只更新 status='pending' 的列**——已 covered/skipped 者不覆寫、不改 covered_by（手動為最終權威）。
   * 回傳「這次真的被改動」的項目（依 idx 排序）；沒有任何 pending 命中 → 回空陣列（呼叫端據此不廣播）。
   */
  async markCovered(
    orgId: string,
    meetingId: string,
    itemIds: string[],
    by: ChecklistCoverSource,
    evidence?: string,
  ): Promise<ChecklistItem[]> {
    if (itemIds.length === 0) return [];
    const now = Date.now();
    const ev = evidence ? evidence.slice(0, CHECKLIST_EVIDENCE_MAX_CHARS) : null;

    return this.db.tx(async () => {
      // 先鎖定「本次真的會被改」的 id 集合（pending 且屬本 org/本場），再據此 UPDATE ＋ 回讀。
      const pending = await this.db.all<{ id: string }>(
        `SELECT id FROM meeting_checklist_items
          WHERE org_id = ? AND meeting_id = ? AND status = 'pending' AND id IN (${placeholders(itemIds.length)})`,
        [orgId, meetingId, ...itemIds],
      );
      if (pending.length === 0) return [];
      const changedIds = pending.map((r) => r.id);

      await this.db.run(
        `UPDATE meeting_checklist_items
            SET status = 'covered', covered_by = ?, covered_at = ?, evidence = ?, updated_at = ?
          WHERE org_id = ? AND meeting_id = ? AND id IN (${placeholders(changedIds.length)})`,
        [by, now, ev, now, orgId, meetingId, ...changedIds],
      );

      const rows = await this.db.all<ChecklistRow>(
        `SELECT ${SELECT_COLS} FROM meeting_checklist_items
          WHERE org_id = ? AND meeting_id = ? AND id IN (${placeholders(changedIds.length)})
          ORDER BY idx ASC`,
        [orgId, meetingId, ...changedIds],
      );
      return rows.map(rowToItem);
    });
  }

  /**
   * 單項狀態設定（手動路徑／報告者最終權威；契約 §5 checklist_action）——**不限當前狀態**，可反覆改。
   *  - 'covered'：covered_by = by ?? 'manual'；**covered_by 真的換人時**才更新 covered_at 並清 evidence。
   *  - 'pending'（uncheck）：清空 covered_by / covered_at / evidence。
   *  - 'skipped'：同樣清空 cover 三欄——「略過」不是「被涵蓋」，留著 covered_by 會誤導 HUD 與日後回寫。
   * 找不到（含跨 org / 不同場）→ 回 null，零副作用、不 throw。
   *
   * 為什麼 'covered' 也要清 evidence（隱私洞，對抗式復驗抓到）：evidence 是「憑什麼判定 covered」的證據，
   * 來源換人了舊證據就不成立——而 `covered_by='transcript'` 的 evidence **是逐字稿位元組**。真實時序：
   * 對話勾稽先 `markCovered(...,'transcript',<逐字片段>)`，但 HUD snapshot 有 300ms debounce＋RTT，
   * 這段時間報告者看到的仍是 pending → 點 checkbox 送 `action:'check'` → 這裡把 covered_by 改成 'manual'。
   * 舊實作 evidence 不動 → 該列從此不符 TTL purge 的來源條件 → **逐字內容永久留存**（繞過 M5 §A retention）。
   * 故此處以 `CASE WHEN covered_by = ?`（SET 運算式讀的是**舊列值**，SQLite/pg 皆然）判斷來源是否變動：
   * 同來源重複勾選（'manual'→'manual'）保留 evidence，跨來源（'transcript'/'slide'/NULL → 新來源）一律清。
   * 純手動勾選的 evidence 本來就是 NULL，清它是 no-op。
   *
   * 為什麼 covered_at 也要吃同一個 CASE（TTL 時鐘不得被重勾歸零）：retention purge 的年齡判準是
   * `COALESCE(covered_at, created_at)`（`apps/server/src/realtime/transcript-retention.ts:75`）。若同來源重勾
   * 也把 covered_at 刷成 now，一列「已過期、帶著逐字殘留」的 manual 列只要在 purge 跑之前被再點一次，
   * TTL 時鐘就歸零、該輪 purge 碰不到它。同來源重勾語意上「什麼都沒變」，本來就不該動時間戳；
   * 換來源才是新的判定事件，此時 covered_at 更新、evidence 清空。
   * SQLite／PG 皆合法（刻意用 `CASE WHEN col = ?` 而非 `IS DISTINCT FROM`——舊 SQLite 不支援）。
   * 注意：舊值為 NULL 時 `NULL = ?` 為 NULL（非真）→ 走 ELSE ＝視為換來源，正是想要的行為。
   */
  async setStatus(
    orgId: string,
    meetingId: string,
    itemId: string,
    status: ChecklistStatus,
    by?: ChecklistCoverSource,
  ): Promise<ChecklistItem | null> {
    const now = Date.now();
    // 僅 status==='covered' 分支使用（非 covered 分支的 SQL 直接寫死 NULL，JS 端不必再算一份 null）。
    const coveredBy = by ?? "manual";

    return this.db.tx(async () => {
      const res =
        status === "covered"
          ? await this.db.run(
              `UPDATE meeting_checklist_items
                  SET status = ?, covered_by = ?,
                      covered_at = CASE WHEN covered_by = ? THEN covered_at ELSE ? END,
                      evidence = CASE WHEN covered_by = ? THEN evidence ELSE NULL END,
                      updated_at = ?
                WHERE org_id = ? AND meeting_id = ? AND id = ?`,
              [status, coveredBy, coveredBy, now, coveredBy, now, orgId, meetingId, itemId],
            )
          : await this.db.run(
              `UPDATE meeting_checklist_items
                  SET status = ?, covered_by = NULL, covered_at = NULL, evidence = NULL, updated_at = ?
                WHERE org_id = ? AND meeting_id = ? AND id = ?`,
              [status, now, orgId, meetingId, itemId],
            );
      if (res.changes === 0) return null; // 不存在／跨 org／不同場——零副作用
      const row = await this.db.get<ChecklistRow>(
        `SELECT ${SELECT_COLS} FROM meeting_checklist_items
          WHERE org_id = ? AND meeting_id = ? AND id = ?`,
        [orgId, meetingId, itemId],
      );
      return row ? rowToItem(row) : null;
    });
  }
}
