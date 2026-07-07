/**
 * Shared realtime types (M3). Kept in one place so hub / ws-server / patch-service / orchestrator agree on
 * the broadcast targeting used to enforce I3 (HUD-only content never reaches /present).
 */
import type { ServerMessage, WsRole } from "@meetcopilot/shared";

/**
 * Which connected roles a server→client message is delivered to.
 *  - 'hud'     : transcript / signals / info_card / suggestion / suggestion_result / research_status (I3)
 *  - 'present' : deck_update only (silent append; NEVER any HUD content — I3)
 *  - 'all'     : session_state (connect/reconnect sync across every role)
 */
export type BroadcastTarget = "all" | "hud" | "present" | "capture";

/** Identity/role of an authenticated WS connection (derived from the wsToken, never from client payload). */
export interface ConnMeta {
  userId: string;
  orgId: string;
  meetingId: string;
  role: WsRole;
  /** userId === meeting.presenter_user_id — the load-bearing presenter check (I2). */
  isPresenter: boolean;
}

/** A hub is the sink patch-service / orchestrator push server messages through (role-filtered). */
export interface BroadcastSink {
  broadcast(meetingId: string, msg: ServerMessage, target: BroadcastTarget): void;
}
