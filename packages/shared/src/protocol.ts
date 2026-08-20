/**
 * WS 協定：三個 surface（capture／hud／present）與 server 的唯一即時通道。
 * **唯一真相來源＝API_CONTRACT §6**（前後端都以本檔實作；漂移＝bug）。
 *
 * 連線：`/ws?token=<wsToken>&meetingId=&role=[&channels=1|2]`（role＝capture｜hud｜present）。
 * 傳輸：音訊走 **binary frame**（16-bit LE PCM、16kHz、無標頭，~250ms/frame，直接丟 ArrayBuffer）；其餘 JSON text frame。
 *   聲道協商由握手 query param **`channels`** 決定，兩種格式：
 *   - `channels=1`（或**缺席／空值／任何無法解析成 `"2"` 的值**——向後相容，舊 client 不帶此參數）＝
 *     **mono 混音**：250ms＝4000 samples＝8000 bytes。說話者由下游 LLM 依內容/語氣推斷（可能 unknown）。
 *   - `channels=2` ＝ **交錯（interleaved）stereo、左聲道在前**：250ms＝4000 sample-pair＝8000 個 Int16＝
 *     **16000 bytes**。聲道語意固定：**左＝麥克風＝報告者（`presenter`）／右＝分頁音訊＝對方（`client`）**，
 *     說話者因此由聲道直接決定，不需 LLM 推斷。server 在 hub 就把兩聲道拆成兩條純 mono 串流。
 * 授權：`suggestion_action`、`page_commit` 只接受 presenter（present role）的連線；server 驗 wsToken 身分，攻擊者憑證必須被拒（I2）。
 */
import type { SlideSpec } from "./slide-spec.js";
import type { SignalItem } from "./signals.js";
import type { ChecklistItem } from "./checklist.js";

/** WS 連線角色（query param `role`）。 */
export type WsRole = "capture" | "hud" | "present";

/**
 * 逐字稿說話者（枚舉值不變）。來源依擷取格式而異：
 *  - `channels=2`（stereo）：由**聲道**直接決定（左＝麥克風＝`presenter`、右＝分頁音訊＝`client`），確定答案。
 *  - `channels=1`（mono 混音，含使用者拒絕麥克風授權而退回的情形）：無乾淨分軌，由下游 LLM 依內容/語氣推斷，
 *    可能 `unknown`。
 */
export type TranscriptSpeaker = "presenter" | "client" | "unknown";

/** 逐字稿片段（server→client `transcript`）。 */
export interface TranscriptSegment {
  id: string;
  t: number; // ms
  speaker: TranscriptSpeaker;
  /**
   * 選填說話者標籤（RESEARCH_UPGRADE_CONTRACT §4.2）：雙方可能各不只一位時的細分標註，
   * 由 speaker 推斷帶入該場公司 CRM contacts 名單後產生（例「客戶-A」「客戶-王經理」「報告者」）。
   * **向後相容**：wire 枚舉 `speaker` 不變；本欄選填，缺席時前端沿用 presenter/client（舊 client payload 不壞）。
   */
  speakerLabel?: string;
  text: string;
  final: boolean;
}

/** HUD 情報卡種類（server→client `info_card`）。 */
export type InfoCardKind = "company" | "contact" | "battlecard" | "objection_handler" | "research";

/** 情報卡信任標記：verified（人驗證）｜crawler（爬蟲值）｜live（會中即時 grounding）。 */
export type InfoCardTrust = "verified" | "crawler" | "live";

/** HUD 情報卡（server→client `info_card`）。 */
export interface InfoCard {
  id: string;
  kind: InfoCardKind;
  title: string;
  body: string;
  sourceUrl?: string;
  confidence?: number;
  trust: InfoCardTrust;
}

/** 研究 job 狀態（server→client `research_status`；對齊 API_CONTRACT §3 job 狀態）。 */
export type ResearchJobStatus = "queued" | "running" | "done" | "failed";

/**
 * 待批准的補充頁建議（server→client `suggestion` 的 payload；批准佇列）。
 * 具名型別供 HUD 元件、PatchService.suggest 回傳共用（結構＝§6 suggestion 內聯物件，單一真相）。
 * I2：只有 accept/edit 會 append 進 deck；reject 或逾時（expiresAt）＝discarded。
 */
export interface Suggestion {
  id: string;
  slide: SlideSpec;
  reason: string;
  expiresAt: number; // epoch ms；逾時自動 discard
}

// ── Client → Server（JSON）── API_CONTRACT §6 ──────────────
export type ClientMessage =
  | { type: "hello"; role: WsRole }
  | { type: "consent"; granted: boolean } // capture：未同意不啟動分析
  | {
      // hud：對批准佇列中的建議做決策
      type: "suggestion_action";
      suggestionId: string;
      action: "accept" | "edit" | "reject";
      editedSlide?: SlideSpec;
    }
  | { type: "deep_research"; query: string } // hud「深查」→ 觸發 §3 ground（受每場上限）
  | { type: "page_commit"; index: number } // present：已播到第 index 頁（committedIndex 單調遞增）
  | {
      // hud：報告者手動改待講清單項目狀態（**presenter-only**，同 suggestion_action 的身分閘；I2）
      // check→covered（covered_by='manual'）｜uncheck→pending（清空 covered_by/at/evidence）｜skip→skipped
      type: "checklist_action";
      itemId: string;
      action: "check" | "uncheck" | "skip";
    }
  | { type: "ping" };

// ── Server → Client（JSON）── API_CONTRACT §6 ──────────────
export type ServerMessage =
  | { type: "transcript"; segment: TranscriptSegment }
  | { type: "signals"; items: SignalItem[] }
  | { type: "info_card"; card: InfoCard } // hud
  | { type: "suggestion"; suggestion: Suggestion } // hud（批准佇列）
  | { type: "suggestion_result"; suggestionId: string; status: "applied" | "discarded"; newSlideIndex?: number } // hud
  | { type: "deck_update"; op: { kind: "APPEND"; slide: SlideSpec }; index: number } // present（批准後 append 到尾端）
  | { type: "research_status"; jobId: string; status: ResearchJobStatus; remainingQuota: number } // hud
  | {
      // hud **only**（I3：清單絕不外流到 present）。全量 snapshot、**replace 語意**（HUD 端整份換掉）——
      // 斷線重連自我修復，不需增量對帳。status='generating' 時 items 為空陣列。
      // currentSlideIdx＝server 已知的簡報高水位（runtime.committedIndex），供 HUD 高亮「正在講」。
      type: "checklist";
      status: "generating" | "ready" | "failed";
      items: ChecklistItem[];
      currentSlideIdx?: number;
    }
  | { type: "session_state"; consent: boolean; committedIndex: number; connectedRoles: string[] } // 全角色，連線/重連時同步
  | { type: "error"; code: string; message: string };

// ── 連線常數（契約事實：§6 path、§0 預設 port）──────────────
export const WS_PATH = "/ws";
export const SERVER_DEFAULT_PORT = 8787;

// ── 聲道協商（§6 握手 query param `channels`）──────────────
// 三個 runtime（server 握手／web 組 URL／worklet 產 frame）必須對同一條規則零分歧，所以規則本體
// 只寫在這裡。**漏改一處的失敗模式是靜音的**：client 送 16000 bytes 而 server 當 mono 處理，
// chunker 的取樣時鐘直接跑兩倍快、speaker 全錯，沒有任何一行會報錯、沒有任何一個測試會紅。

/** 握手 query param 名稱。server 讀它、web 寫它——這個字串在 TS 側只出現這一次。 */
export const WS_PARAM_CHANNELS = "channels";

/** stereo 的**唯一** wire 值。`?channels=2` 之外的任何寫法都不是 stereo（見 `parseAudioChannels`）。 */
export const WS_CHANNELS_STEREO = "2";

/**
 * 音訊 binary frame 的聲道數：`1`＝mono 混音（250ms＝4000 samples＝**8000 bytes**）；
 * `2`＝交錯 stereo、左聲道在前（250ms＝4000 sample-pair＝**16000 bytes**，
 * **左＝麥克風＝`presenter`／右＝分頁音訊＝`client`**）。
 *
 * 擷取端 worklet → WS URL → server 握手（`ConnMeta.channels`）→ chunker → `AsrSegment.channels`
 * 全鏈共用這**一個**型別；任一端自己宣告 `1 | 2` 都會讓上面那條靜音失敗模式重新長回來。
 */
export type AudioChannels = 1 | 2;

/**
 * `channels` param 的 **fail-safe 解析**：只有字面 `"2"` 是 stereo，其餘一切——缺席
 *（`null`／`undefined`）、空字串、`"1"`、`"abc"`、`"3"`、`"0"`、`"2.0"`、`"02"`、`" 2"`——一律落 `1`（mono）。
 *
 * 刻意**不驗證、不拋錯、不因此拒絕連線**：這個 param 只描述音訊格式、不是身分或授權
 *（信任分析見 apps/server 的 `ConnMeta.channels`：謊報純屬自傷）。為它 close 連線只會打壞
 * 不帶此參數的既有 client（`/sim` 的 `mp3-capture.ts`），而向後相容正是「缺席＝mono」的全部用意。
 *
 * **已知且唯一的例外**：`apps/web/public/pcm-worklet.js` 是靜態載入的純 JS（不經 Next bundle、
 * 不 typecheck），無法 import 本 package，故自帶同一條字面判定並在原地註明以本函式為準。
 */
export function parseAudioChannels(raw: string | null | undefined): AudioChannels {
  return raw === WS_CHANNELS_STEREO ? 2 : 1;
}

// ── WS close code（§6）──────────────
// server 送、web 的 `describeWsClose` 判——**兩端 import 同一組常數**。收進 shared 之前 server 只有
// 1000 被命名（其餘是裸數字）、web 另有一張自己的表，兩份靠註解互相指涉；註解能寫出「改這裡記得改那裡」
// 本身就是耦合沒被表達成程式碼的證據。現在改一個值，兩端一起變。

/**
 * 「這場會議已經結束」。**server 端唯一的 1000**，兩個發送點共用：
 *  1. `hub.endMeeting`：報告者按「結束這場會議」時，把還連著的 socket 關掉；
 *  2. `ws-server` 的握手閘（`ws-handshake-gate.ts`）：會議已 completed（或本 org 查不到）時**拒絕新連線**
 *     ——會議結束後在 `/hud`、`/present` 按 F5 走的就是這條路（憑證還在網址列，前端閘全都繞過了）。
 *
 * 兩者對 client 是**同一件事**（別重連、清掉本地憑證、顯示已結束），所以不替握手拒絕另開一個 4xxx。
 * web 端把它歸為 `kind:"ended"`（terminal、不重連）：WS 慣例上乾淨關閉＝刻意為之，不是該粉飾的掉線。
 * graceful shutdown 刻意用 1001（不具名、走 default）並維持可重連，不共用本常數。
 */
export const WS_CLOSE_MEETING_ENDED = 1000;

/** 握手參數不全（缺 token／meetingId／role）。web 端 `kind:"auth"`：同一組憑證再連幾次都不會成功。 */
export const WS_CLOSE_BAD_HANDSHAKE = 4000;

/** wsToken 無效／過期／與 meetingId 不符。web 端 `kind:"auth"`。 */
export const WS_CLOSE_UNAUTHORIZED = 4001;

/**
 * 帳號閘（ADMIN_CONTRACT §2）：停權，或閘本身跑不起來的 fail-closed。web 端 `kind:"auth"`。
 * client 分不出這兩個分支（同一個 code、reason 字串不外露），故一句文案涵蓋兩者——這是刻意的：
 * fail-closed 若誤報成 1000，前端會清掉憑證、把「狀態確認失敗」當成會議真的結束了。
 */
export const WS_CLOSE_ACCOUNT_BLOCKED = 4003;
