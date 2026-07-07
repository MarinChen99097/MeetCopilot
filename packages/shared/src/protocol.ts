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

/** WS 連線角色（query param `role`）。 */
export type WsRole = "capture" | "hud" | "present";

/** 逐字稿說話者：v2 雙帳號混音無乾淨分軌，speaker 由下游 LLM 依內容/語氣推斷（可能 unknown）。 */
export type TranscriptSpeaker = "presenter" | "client" | "unknown";

/** 逐字稿片段（server→client `transcript`）。 */
export interface TranscriptSegment {
  id: string;
  t: number; // ms
  speaker: TranscriptSpeaker;
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
  | { type: "ping" };

// ── Server → Client（JSON）── API_CONTRACT §6 ──────────────
export type ServerMessage =
  | { type: "transcript"; segment: TranscriptSegment }
  | { type: "signals"; items: SignalItem[] }
  | { type: "info_card"; card: InfoCard } // hud
  | {
      // hud（批准佇列）
      type: "suggestion";
      suggestion: { id: string; slide: SlideSpec; reason: string; expiresAt: number };
    }
  | { type: "suggestion_result"; suggestionId: string; status: "applied" | "discarded"; newSlideIndex?: number } // hud
  | { type: "deck_update"; op: { kind: "APPEND"; slide: SlideSpec }; index: number } // present（批准後 append 到尾端）
  | { type: "research_status"; jobId: string; status: ResearchJobStatus; remainingQuota: number } // hud
  | { type: "session_state"; consent: boolean; committedIndex: number; connectedRoles: string[] } // 全角色，連線/重連時同步
  | { type: "error"; code: string; message: string };

// ── 連線常數（契約事實：§6 path、§0 預設 port）──────────────
export const WS_PATH = "/ws";
export const SERVER_DEFAULT_PORT = 8787;
