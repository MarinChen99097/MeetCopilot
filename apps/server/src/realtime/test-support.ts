/**
 * realtime 測試支援模組——**測試替身的單一擁有者**（`packages/crm/src/test-helpers.ts` 的同款先例）。
 *
 * 為什麼要有這個檔：`testConfig()`／`fakeSocket()`／`tick()`／握手閘的假 row 在 realtime 的測試檔裡
 * 各自抄了一份（最多時 7 份），而它們的失效模式**不對稱地惡劣**：
 *
 *  - `AppConfig` 每加一個必填欄位就要改 7 個測試檔；若新欄位是選配，就變成 7 份**行為分歧**的測試設定。
 *  - 握手閘（`ws-handshake-gate.ts`）的假 row 更糟：漏補一欄，該檔案裡**每一條 socket 都會在握手被關掉**，
 *    於是整組 I2 身分閘測試變成 vacuous——**測不到任何東西卻仍然全綠**。本輪真的發生過
 *    （`ws-async-gate.test.ts` 的 `slowCore` 回 `{status:"active"}` → `hub.attach` 從未被呼叫）。
 *
 * **本檔的紀律**：這裡的東西是從各測試檔**逐字**搬過來的，不是「順手改進」過的版本——任何行為差異都會讓
 * 某個測試靜默改變意義。要加新能力請用新增欄位／參數，不要改既有欄位的語意。
 *
 * 不 import vitest（保持與 `packages/crm/src/test-helpers.ts` 一致：本檔位於 `src/`，會被 tsc 一起看過）。
 */
import type { AppConfig } from "../config.js";
import type { WsHandshakeRow } from "./ws-handshake-gate.js";

/**
 * 測試用 jwt secret。原本在 5 個測試檔各寫一次同一個字面值（3 個用區域 `SECRET` const、2 個直接內聯）。
 * 值逐字未變——`mintWsToken` 簽的 token 與 `attachRealtimeWs` 驗的 secret 必須是同一個字串。
 */
export const TEST_JWT_SECRET = "test-secret-value-not-a-placeholder-1234567890";

/**
 * realtime 測試的標準 `AppConfig`。欄位值**逐字**取自原本那幾份複本（gemini.apiKey 空＝`isConfigured()`
 * false，所以 `maybeAnalyze` 之類的路徑不會打任何 LLM——多支測試的前提就建立在這上面）。
 *
 * `overrides` 是**淺層**覆寫：需要換 gemini／openai 的檔案（計費測試要 `apiKey:"k"` 讓 `isConfigured()`
 * 為 true）請整包傳進來，語意與它原本自己寫一份完全相同。刻意不做深層合併——深層合併會讓
 * 「這個測試到底吃到哪組 model 名稱」變成要跨檔推理才知道的事。
 */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    jwtSecret: TEST_JWT_SECRET,
    dbPath: ":memory:",
    researchAutoLimitPerMeeting: 5,
    supplementAutoLimitPerMeeting: 8,
    googleClientId: "",
    platformAdminEmails: [],
    adminOrigin: "",
    gemini: { apiKey: "", textModel: "t", extractModel: "e", embedModel: "m", liveModel: "l" },
    openai: { apiKey: "", imageModel: "i", imageSize: "1x1", imageQuality: "low" },
    ...overrides,
  };
}

/**
 * 最小 WebSocket 替身——只實作 hub 真的會碰到的四樣：`OPEN`／`readyState`／`send`／`close`。
 *
 * 這是原本三種版本的**聯集**（不是任何一版的削減）：
 *  - `sent`：每一則送出的 JSON（`checklist.test.ts` 用它驗 I3 的投遞面；非 JSON 靜默略過）；
 *  - `closed` / `closeCode`：`close()` 的觀察點（`hub-endmeeting-authz.test.ts` 驗 1000 有沒有送出）；
 *  - `readyState` 轉換（1→3）三版逐字相同，測試會直接寫入它來模擬「已經關掉的 socket」。
 * 不讀那些欄位的測試完全不受影響（純記錄，沒有分支）。
 */
export function fakeSocket() {
  const sent: Array<Record<string, unknown>> = [];
  const s = {
    OPEN: 1 as const,
    readyState: 1,
    /** 送出過的每一則 JSON（解析後）。非 JSON 的 payload 略過不記。 */
    sent,
    closed: false,
    closeCode: undefined as number | undefined,
    send(data: unknown): void {
      try {
        sent.push(JSON.parse(String(data)) as Record<string, unknown>);
      } catch {
        /* ignore non-JSON */
      }
    },
    close(code?: number): void {
      s.closed = true;
      s.closeCode = code;
      s.readyState = 3;
    },
  };
  return s;
}

/**
 * 讓出一個 macrotask（預設 0ms）——等 `ensureRuntime`／`broadcastState` 之類的非同步副作用落定。
 * 原本在各檔叫 `tick`／`sleep`／`flush`，實作是同一行；各檔以 import alias 保留自己的用詞。
 */
export const tick = (ms = 0): Promise<unknown> => new Promise((r) => setTimeout(r, ms));

/**
 * 握手閘（`ws-handshake-gate.ts`）會**放行**的那一份 row：org active ＋ user active ＋ meeting 仍是
 * `'scheduled'`。假 core（`{ db: { get: async () => passingHandshakeRow() } }`）用它把握手閘固定成
 * 「一定通過」，好讓待測的那個閘（I2 身分閘、async gate…）成為**唯一的變因**。
 *
 * **回傳型別刻意標成 `WsHandshakeRow`**：閘的 SELECT 之後若多讀一欄，這個函式會直接**編譯失敗**——
 * 把原本「漏補一欄 → 每條 socket 在握手被關掉 → 整組測試靜默變 vacuous 卻仍然全綠」的失效模式，
 * 換成 typecheck 當場報錯。這正是本輪把它收成單一份的理由。
 */
export function passingHandshakeRow(): WsHandshakeRow {
  return { org_status: "active", user_status: "active", meeting_status: "scheduled" };
}
