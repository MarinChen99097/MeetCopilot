/**
 * WS 協定：三個 surface（capture／hud／present）與 server 的唯一即時通道。
 * **唯一真相來源＝API_CONTRACT §6**（前後端都以本檔實作；漂移＝bug）。
 *
 * 連線：`/ws?token=<wsToken>&meetingId=&role=`（role＝capture｜hud｜present）。
 * 傳輸：音訊走 **binary frame**（16-bit PCM 16kHz mono，~250ms/frame，直接丟 ArrayBuffer）；其餘 JSON text frame。
 * 授權：`suggestion_action`、`page_commit` 只接受 presenter（present role）的連線；server 驗 wsToken 身分，攻擊者憑證必須被拒（I2）。
 */
import type { SlideSpec } from "./slide-spec.js";
import type { SignalItem } from "./signals.js";
import type { ChecklistItem } from "./checklist.js";

/** WS 連線角色（query param `role`）。 */
export type WsRole = "capture" | "hud" | "present";

/** 逐字稿說話者：v2 雙帳號混音無乾淨分軌，speaker 由下游 LLM 依內容/語氣推斷（可能 unknown）。 */
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
