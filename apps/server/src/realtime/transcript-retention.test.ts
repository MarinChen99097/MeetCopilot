/**
 * TTL purge（M5 §A）涵蓋兩個逐字稿落地面：
 *   1. `meeting_transcript_segments`（既有）——過期列被 DELETE。
 *   2. `meeting_checklist_items.evidence`（023 新增）——`covered_by='transcript'` 時存的是**逐字稿位元組前綴**
 *      （hub 寫入 `route.persist?.text`，與寫進 segments 的是同一個字串值），所以同一個 TTL 也必須清它。
 *
 * 本檔鎖住 evidence purge 的精確邊界：**只清 evidence 欄不刪列**、**只排除 'slide' 來源**（「第 N 頁」不是
 * 逐字內容；'transcript' 與 'manual' 都清）、**未過期的場次不受影響**（含 retention_days NULL → 30 天預設）。
 *
 * ⚠️ 為什麼 'manual' 也必須清（對抗式復驗抓到的隱私洞，本檔曾把這個洞寫成回歸鎖定）：
 * `covered_by='manual'` 的 evidence **並非恆 NULL**。真實時序是對話勾稽先
 * `markCovered(...,'transcript',<逐字片段>)` 寫入 evidence，但 HUD snapshot 廣播有 300ms debounce＋RTT，
 * 這段時間報告者看到的仍是 pending → 點 checkbox → `setStatus(...,'covered','manual')` 把來源改成 manual。
 * 舊 purge 條件 `covered_by='transcript'` 從此永遠碰不到那一列 → 逐字內容永久留存。
 * 現在有兩道防線：repo 的 setStatus 在來源變動時當下就清 evidence（見 checklist-repo.test.ts），
 * 以及本檔驗的 purge 條件 `covered_by IS NULL OR covered_by <> 'slide'`（縱深防禦，擋手改/舊資料殘留）。
 *
 * 測試寫法注意：`startTranscriptRetention` 會**立刻跑一次開機 purge**（fire-and-forget），故本檔一律
 * 「先建 handle（此時 DB 還沒有 checklist／segment 列 → 開機 purge 必然 0 變更）→ flush 一個 macrotask →
 * 才塞資料 → 再 runOnce」，讓 runOnce 的回傳筆數可被確定性斷言。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createCrmCore } from "@meetcopilot/crm";
import type { CrmCore } from "@meetcopilot/crm";
import type { NewChecklistItem } from "@meetcopilot/shared";
import { startTranscriptRetention, type RetentionHandle } from "./transcript-retention.js";

const DAY = 86_400_000;
const ORG = "org-retention";
const OLD_MEETING = "m-expired"; // retention_days = 7
const NEW_MEETING = "m-fresh"; // retention_days = NULL → 服務層預設 30

let core: CrmCore;
const now = Date.now();

function item(idx: number, over: Partial<NewChecklistItem> = {}): NewChecklistItem {
  return { idx, category: "talk", title: `項目 ${idx}`, keywords: [`kw${idx}`], priority: "must", ...over };
}

async function insertMeeting(id: string, retentionDays: number | null): Promise<void> {
  await core.db.run(
    `INSERT INTO meetings (id, org_id, company_id, title, persist_transcript, retention_days, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
    [id, ORG, "co-1", "t", retentionDays, now - 60 * DAY, now - 60 * DAY],
  );
}

async function insertSegment(id: string, meetingId: string, createdAt: number): Promise<void> {
  await core.db.run(
    `INSERT INTO meeting_transcript_segments (id, org_id, meeting_id, text, created_at) VALUES (?, ?, ?, ?, ?)`,
    [id, ORG, meetingId, "逐字稿內容", createdAt],
  );
}

/** 把某列 checklist 的時間往回撥（模擬「這筆 evidence 是 N 天前寫的」）。 */
async function backdate(itemId: string, ageDays: number): Promise<void> {
  await core.db.run(
    "UPDATE meeting_checklist_items SET created_at = ?, covered_at = ?, updated_at = ? WHERE id = ?",
    [now - ageDays * DAY, now - ageDays * DAY, now - ageDays * DAY, itemId],
  );
}

/** 建 handle 並等開機 purge 跑完（此時 DB 還沒有目標列，故必然 0 變更）。 */
async function startAfterBootPurge(): Promise<RetentionHandle> {
  const handle = startTranscriptRetention(core.db, { intervalMs: 10 * 60 * 1000 });
  await new Promise((r) => setTimeout(r, 0));
  return handle;
}

beforeEach(async () => {
  core = await createCrmCore(":memory:");
  await core.migrate();
  await insertMeeting(OLD_MEETING, 7);
  await insertMeeting(NEW_MEETING, null);
});
afterEach(() => core.close());

describe("startTranscriptRetention", () => {
  it("清掉過期場次的 transcript／manual evidence，但不刪列、不動 slide 的「第 N 頁」、不動未過期場次", async () => {
    const handle = await startAfterBootPurge();
    try {
      // ── 過期場次（retention 7 天）：四種列各一 ──
      const rows = await core.checklist.replaceAll(ORG, OLD_MEETING, [item(0), item(1), item(2), item(3)]);
      const [byTranscript, bySlide, byManual, stillPending] = [rows[0]!, rows[1]!, rows[2]!, rows[3]!];

      await core.checklist.markCovered(ORG, OLD_MEETING, [byTranscript.id], "transcript", "對方說預算大概三百萬");
      await core.checklist.markCovered(ORG, OLD_MEETING, [bySlide.id], "slide", "第 3 頁");
      await core.checklist.setStatus(ORG, OLD_MEETING, byManual.id, "covered"); // covered_by='manual'
      // manual 的 evidence **不保證** NULL（見檔頭：debounce 期間手動勾選會把帶逐字 evidence 的列改成 manual）。
      // 這裡直接把殘留狀態硬塞回去（等於「舊資料 / 繞過源頭修法」），證明 purge 這道防線會清掉它。
      await core.db.run("UPDATE meeting_checklist_items SET evidence = ? WHERE id = ?", [
        "對方說我們現在用的是競品 X", // ← 逐字稿位元組殘留在 manual 列上
        byManual.id,
      ]);
      for (const r of [byTranscript, bySlide, byManual, stillPending]) await backdate(r.id, 30);

      // ── 未過期場次（retention NULL → 30 天）：10 天前的 transcript evidence 必須留著 ──
      const freshRows = await core.checklist.replaceAll(ORG, NEW_MEETING, [item(0)]);
      const fresh = freshRows[0]!;
      await core.checklist.markCovered(ORG, NEW_MEETING, [fresh.id], "transcript", "這場還沒到期");
      await backdate(fresh.id, 10);

      // ── segments：過期一筆、未過期一筆 ──
      await insertSegment("seg-old", OLD_MEETING, now - 30 * DAY);
      await insertSegment("seg-fresh", NEW_MEETING, now - 10 * DAY);

      const deleted = await handle.runOnce();
      expect(deleted).toBe(1); // 只有過期場次那筆 segment 被刪

      const after = await core.checklist.list(ORG, OLD_MEETING);
      expect(after).toHaveLength(4); // **列本身沒被刪**（清單是會議產物，會後檢視要看）
      const at = (idx: number) => after.find((i) => i.idx === idx)!;
      expect(at(0).evidence).toBeUndefined(); // transcript evidence → NULL
      expect(at(0).status).toBe("covered"); // 只清 evidence，狀態／來源不動
      expect(at(0).coveredBy).toBe("transcript");
      expect(at(1).evidence).toBe("第 3 頁"); // slide 來源＝「第 N 頁」，唯一不是逐字稿位元組者 → 不動
      expect(at(1).coveredBy).toBe("slide");
      // manual 的 evidence **可能是殘留的逐字片段** → 必須被清成 NULL（本輪修的隱私洞）
      expect(at(2).evidence).toBeUndefined();
      expect(at(2).status).toBe("covered"); // 只清 evidence，狀態／來源不動
      expect(at(2).coveredBy).toBe("manual");
      expect(at(3).status).toBe("pending");
      // 全表掃一次：任何逐字內容都不得存活（攻擊者視角的最終斷言）
      const survivors = await core.db.all<{ id: string }>(
        "SELECT id FROM meeting_checklist_items WHERE meeting_id = ? AND evidence IS NOT NULL",
        [OLD_MEETING],
      );
      expect(survivors.map((s) => s.id)).toEqual([bySlide.id]);

      // 未過期場次完全不受影響
      const freshAfter = await core.checklist.list(ORG, NEW_MEETING);
      expect(freshAfter[0]!.evidence).toBe("這場還沒到期");
      const segs = await core.db.all<{ id: string }>("SELECT id FROM meeting_transcript_segments", []);
      expect(segs.map((s) => s.id)).toEqual(["seg-fresh"]);
    } finally {
      handle.stop();
    }
  });

  it("原始攻擊時序（debounce 競態）：transcript 勾稽 → 手動 check 改成 manual → 逐字內容當下即消失，不需等 TTL", async () => {
    const handle = await startAfterBootPurge();
    try {
      const QUOTE = "對方說預算大概三百萬，Q4 要簽";
      const rows = await core.checklist.replaceAll(ORG, OLD_MEETING, [item(0)]);
      const target = rows[0]!;

      // t0：對話自動勾稽寫入 evidence（＝逐字稿位元組，與 segments 同一個字串值）
      await core.checklist.markCovered(ORG, OLD_MEETING, [target.id], "transcript", QUOTE);
      const atT0 = await core.db.get<{ evidence: string | null }>(
        "SELECT evidence FROM meeting_checklist_items WHERE id = ?",
        [target.id],
      );
      expect(atT0!.evidence).toBe(QUOTE); // 前提成立：DB 裡確實有逐字內容

      // t0+ε：snapshot 廣播還在 300ms debounce 裡，HUD 仍顯示 pending → 報告者點 checkbox
      // （ws-server checklist_action:'check' → hub.checklistAction → setStatus(...,'covered','manual')）
      const updated = await core.checklist.setStatus(ORG, OLD_MEETING, target.id, "covered", "manual");
      expect(updated!.status).toBe("covered");
      expect(updated!.coveredBy).toBe("manual"); // 來源真的被換成 manual（洞的成因）
      expect(updated!.evidence).toBeUndefined(); // ← 源頭修法：來源換人 → 舊證據當下清掉

      // 不靠 purge：此刻整表已無那段逐字內容
      const raw = await core.db.get<{ evidence: string | null }>(
        "SELECT evidence FROM meeting_checklist_items WHERE id = ?",
        [target.id],
      );
      expect(raw!.evidence).toBeNull();
      expect(
        await core.db.all<{ id: string }>("SELECT id FROM meeting_checklist_items WHERE evidence = ?", [QUOTE]),
      ).toEqual([]);

      // 再走一遍 TTL（第二道防線）：過期後仍為 NULL、列仍在、狀態不變
      await backdate(target.id, 30);
      await handle.runOnce();
      const after = await core.checklist.list(ORG, OLD_MEETING);
      expect(after).toHaveLength(1);
      expect(after[0]!.evidence).toBeUndefined();
      expect(after[0]!.status).toBe("covered");
    } finally {
      handle.stop();
    }
  });

  it("冪等：第二次跑沒有東西可清，且不再動任何列", async () => {
    const handle = await startAfterBootPurge();
    try {
      const rows = await core.checklist.replaceAll(ORG, OLD_MEETING, [item(0)]);
      await core.checklist.markCovered(ORG, OLD_MEETING, [rows[0]!.id], "transcript", "會被清掉的引文");
      await backdate(rows[0]!.id, 30);

      await handle.runOnce();
      const first = await core.checklist.list(ORG, OLD_MEETING);
      expect(first[0]!.evidence).toBeUndefined();
      const updatedAfterPurge = await core.db.get<{ updated_at: number }>(
        "SELECT updated_at FROM meeting_checklist_items WHERE id = ?",
        [rows[0]!.id],
      );

      await handle.runOnce(); // 不得拋錯、不得再動任何列（evidence 已 NULL → WHERE 不再命中）
      const after = await core.checklist.list(ORG, OLD_MEETING);
      expect(after).toHaveLength(1);
      expect(after[0]!.evidence).toBeUndefined();
      expect(after[0]!.status).toBe("covered");
      const updatedAgain = await core.db.get<{ updated_at: number }>(
        "SELECT updated_at FROM meeting_checklist_items WHERE id = ?",
        [rows[0]!.id],
      );
      expect(updatedAgain!.updated_at).toBe(updatedAfterPurge!.updated_at);
    } finally {
      handle.stop();
    }
  });
});
