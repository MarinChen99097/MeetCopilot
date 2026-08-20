/**
 * WS 握手閘（API_CONTRACT §6）——**一次 DB round-trip 決定這條連線准不准進房**。
 *
 * 為什麼需要 meeting status 這一關（2026-08-19 根因修補）：
 * 殭屍會議的所有前端防護（close code 1000/4003 判終態、`retry()` 封鎖、UI 不渲染重試鈕）都只擋得住
 * **重連**。但 `/hud`、`/present` 的憑證就在網址列（`readMeetingCreds()` 先讀 URL query），會議結束後
 * 在那個分頁**按一次 F5** 就是一條全新連線——前端所有閘全部繞過。此前握手只驗 token（簽章／exp／
 * meetingId 相符）＋帳號未停權，**完全不查 meeting.status**，於是 `hub.attach` → `hub.ensureRuntime`
 * 會替一場 `completed` 的會議重建 `LiveSessionRuntime` ＋ `GeminiAsrProvider` ＋分析引擎，
 * 且 `runtime.consent` 重置為 false（＝一場沒人在的會議在燒 API 額度）。閘必須在 server。
 *
 * ── 授權（硬規則 7：用攻擊者憑證想一遍）──────────────────────────
 * meeting 子查詢**一律 org-scoped**（`WHERE id = ? AND org_id = ?`，orgId 取自**已驗證的 wsToken**，
 * 絕不取自 query param）。這是刻意的：只用 meetingId 查會變成跨租戶的存在性探測側信道
 * （「別的 org 有沒有這場會議、還在不在進行」）。
 *
 * 而且「跨 org」與「會議根本不存在」**回傳同一個結果**（`"meeting"`）：兩者在 org-scoped 查詢下都是
 * NULL，呼叫端因此送出**逐位元相同**的 error payload ＋ 同一個 close code。攻擊者拿另一個 org 的
 * meetingId 來握手，得到的回應與亂打一個不存在的 id 完全無法區分——沒有新開任何側信道。
 *
 * ── 查詢成本 ────────────────────────────────────────────────
 * 握手是每條連線都會跑的路徑，故 meeting status **併進帳號閘既有的那一次 `db.get`**（三個相關子查詢，
 * 全走主鍵／既有索引），相對修補前**不多打一次 DB**。帳號那兩欄的 SQL 與 fail-closed 判定直接
 * import 自 `auth/active-account.ts`（單一來源，不抄第二份）。
 */
import type { CrmCore } from "@meetcopilot/crm";
import { ACCOUNT_STATUS_COLUMNS, accountActiveFromRow, type AccountStatusRow } from "../auth/active-account.js";

/**
 * 為什麼拒絕。呼叫端（`ws-server.ts`）據此挑 close code：
 *  - `"account"`：org 或 user 已停權／不存在（ADMIN_CONTRACT §2）→ 4003（前端 kind `"auth"`）。
 *  - `"meeting"`：這場會議在**本 org**已 completed、或查不到（含跨 org）→ 1000（前端 kind `"ended"`）。
 */
export type WsHandshakeDenial = "account" | "meeting";

/**
 * 這個閘**唯一那次 `db.get`** 讀回來的 row 形狀（帳號兩欄＋org-scoped 的 meeting status）。
 *
 * 具名而不是內聯，是為了讓**測試替身能被編譯器綁住**：`realtime/test-support.ts` 的
 * `passingHandshakeRow(): WsHandshakeRow` 以本型別為回傳型別，所以這裡多加一欄（必填）時，那個替身
 * 會**編譯失敗**。這正是要換掉的失效模式——此前每個假 core 各自寫一份 row literal，漏補一欄時
 * 該檔案裡**每一條 socket 都在握手被關掉**，於是整組身分閘測試變成 vacuous：測不到任何東西卻仍然全綠
 *（本輪 `ws-async-gate.test.ts` 真的發生過：`slowCore` 只回 `{status:"active"}` → `hub.attach` 從未被呼叫）。
 */
export interface WsHandshakeRow extends AccountStatusRow {
  meeting_status: string | null;
}

/**
 * `meetings.status` 的終態值（`MeetingStore.end` 寫入的字串；migration 005 的 status 欄）。
 * 建會時是 `'scheduled'`——**白名單反過來寫（只擋 completed）是刻意的**：未來新增 `'live'` 之類的
 * 中間狀態不必同步改這裡，才不會有「新狀態被閘意外擋掉、整個會中功能靜默壞掉」的踩坑。
 */
const MEETING_STATUS_COMPLETED = "completed";

/**
 * WS 升級前的單一閘門。回 `null`＝放行；回 `WsHandshakeDenial`＝拒絕（原因見型別註解）。
 *
 * **不會誤擋正常重連**：`DISCONNECT_GRACE_MS` 是 5 分鐘，斷線重連期間 meeting 仍是 `'scheduled'`，
 * 這裡只在 status 已經是 `'completed'`（或本 org 查不到這場）時才拒。
 *
 * 順序：帳號閘先判（與修補前完全一致的行為與 close code），通過後才看 meeting——這樣停權帳號拿到的
 * 回應與會議狀態無關，不會反過來變成「用停權帳號探測會議是否存在」的另一條路。
 *
 * 拋錯（DB 掛掉）**不在此處吞掉**：呼叫端統一 fail-closed（比照修補前的 `.catch` → 4003）。
 */
export async function checkWsHandshake(
  core: CrmCore,
  orgId: string,
  userId: string,
  meetingId: string,
): Promise<WsHandshakeDenial | null> {
  // `?` 依序＝orgId, userId（ACCOUNT_STATUS_COLUMNS）→ meetingId, orgId（meeting 子查詢，org-scoped）。
  // SqliteDbPort 直接吃 `?`；PgDbPort 在邊界把 `?` 依序轉成 `$1..$4`（pg-db.ts 接縫 1）。
  const row = await core.db.get<WsHandshakeRow>(
    `SELECT ${ACCOUNT_STATUS_COLUMNS}, (SELECT status FROM meetings WHERE id = ? AND org_id = ?) AS meeting_status`,
    [orgId, userId, meetingId, orgId],
  );
  if (!accountActiveFromRow(row)) return "account";
  // `?? null` 把「欄位不存在」（測試替身回的精簡 row）與「SQL NULL」收斂成同一件事：查不到 → 拒。
  const status = row?.meeting_status ?? null;
  if (status == null || status === MEETING_STATUS_COMPLETED) return "meeting";
  return null;
}
