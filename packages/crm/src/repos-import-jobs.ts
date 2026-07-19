/**
 * ImportJobRepository 的實作（import_jobs；migration 018）。
 * pptx/pdf → PNG 轉檔背景 job 的執行簿記（複用 image_jobs 範式）。port-agnostic（兩驅動共用）。
 *
 * boot reaper（契約 §5，比照 research crawl_jobs reaper）：server 重啟後殘留 queued/running 的轉檔 job
 * 其背景流程已隨舊進程消失，永不會再收尾 → 開機一律標 failed，避免前端卡在「轉檔中」。
 *
 * org-scoping：enqueue 帶 org_id；setJobStatus 以 jobId 主鍵操作、不收 orgId（jobId 為全域唯一 uuid）。
 */
import type { DbPort } from "./ports.js";
import type { ImportJobRepository } from "./ports.js";
import type { ImportJobStatus } from "@meetcopilot/shared";
import { uuidv7 } from "./uuid.js";

/** boot reaper 寫入 import_jobs.error 的固定文案（前端逃生口據此顯示「已中斷」）。 */
export const IMPORT_REAPER_INTERRUPTED_ERROR = "伺服器重啟，簡報轉檔已中斷，可重新匯入";

export class SqliteImportJobRepository implements ImportJobRepository {
  constructor(private readonly db: DbPort) {}

  async enqueue(deckId: string, orgId: string): Promise<string> {
    const id = uuidv7();
    const now = Date.now();
    await this.db.run(
      `INSERT INTO import_jobs (id, deck_id, org_id, status, created_at, updated_at)
       VALUES (?, ?, ?, 'queued', ?, ?)`,
      [id, deckId, orgId, now, now],
    );
    return id;
  }

  async setJobStatus(jobId: string, status: ImportJobStatus, error?: string): Promise<void> {
    // error 只在 failed 時留存（截斷 2000 字）；其餘狀態轉換清空 error。
    await this.db.run(
      "UPDATE import_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?",
      [status, status === "failed" ? (error ?? "import failed").slice(0, 2000) : null, Date.now(), jobId],
    );
  }

  async failInterruptedJobs(): Promise<number> {
    const now = Date.now();
    // 先數殘留筆數（供 boot log），再一次 UPDATE 全部標 failed。跨 org：無 org_id 過濾（開機清系統級殘留）。
    const row = await this.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM import_jobs WHERE status IN ('queued','running')",
      [],
    );
    const n = row?.n ?? 0;
    if (n > 0) {
      await this.db.run(
        "UPDATE import_jobs SET status = 'failed', error = ?, updated_at = ? WHERE status IN ('queued','running')",
        [IMPORT_REAPER_INTERRUPTED_ERROR, now],
      );
    }
    return n;
  }
}
