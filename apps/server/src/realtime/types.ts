/**
 * Shared realtime types (M3). Kept in one place so hub / ws-server / patch-service / orchestrator agree on
 * the broadcast targeting used to enforce I3 (HUD-only content never reaches /present).
 */
import type { AudioChannels, ServerMessage, WsRole } from "@meetcopilot/shared";

/**
 * Which connected roles a server→client message is delivered to.
 *  - 'hud'     : transcript / signals / info_card / suggestion / suggestion_result / research_status (I3)
 *  - 'present' : deck_update only (silent append; NEVER any HUD content — I3)
 *  - 'all'     : session_state (connect/reconnect sync across every role)
 */
export type BroadcastTarget = "all" | "hud" | "present" | "capture";

/**
 * WS close code 的**單一真相在 `@meetcopilot/shared` 的 protocol.ts**（server 送、web 的 `describeWsClose`
 * 判，兩端 import 同一組常數；語意與「為什麼兩個發送點共用 1000」寫在那裡）。本檔只轉出，讓既有
 * `import { WS_CLOSE_MEETING_ENDED } from "./types.js"` 的呼叫端（`hub.endMeeting`、握手閘、契約測試）
 * 不受影響——**不要**在本檔再寫一份數字。
 */
export { WS_CLOSE_MEETING_ENDED } from "@meetcopilot/shared";

/** Identity/role of an authenticated WS connection (derived from the wsToken, never from client payload). */
export interface ConnMeta {
  userId: string;
  orgId: string;
  meetingId: string;
  role: WsRole;
  /** userId === meeting.presenter_user_id — the load-bearing presenter check (I2). */
  isPresenter: boolean;
  /**
   * 音訊 binary frame 的聲道數（API_CONTRACT §6）：`1`＝mono 混音（現況）；`2`＝交錯 stereo，
   * **左＝麥克風＝報告者（presenter）／右＝分頁音訊＝對方（client）**。缺席＝`1`（見下方相容性）。
   *
   * ⚠️ **本欄的來源與本介面其餘欄位不同**：其餘欄位全部取自**已驗證的 wsToken**（身分／授權，I2 的地基），
   * 本欄取自**握手 query param `channels`，client 可任意竄改**。這是刻意接受的來源差異——
   * 音訊格式**不是安全敏感資訊**：謊報只會讓「自己這條連線送上來的音訊」被錯誤拆分成垃圾（純自傷），
   * 拆分永遠只發生在該連線自己那場 session runtime 內，既碰不到別的租戶／別場會議，
   * 也不參與 `isPresenter` 的 I2 身分閘。故不必（也無法）把它塞進 token。
   *
   * 解析必須 fail-safe，且**只有 shared 的 `parseAudioChannels` 一份**（web 組 URL、worklet 產 frame
   * 吃的是同一條規則）：任何非 `"2"` 的值——缺席、空字串、`"abc"`、`"3"`——一律落到 `1`（mono），
   * 且**永不因為這個 param 拒絕連線**。這是向後相容的關鍵：`/sim` 的 `mp3-capture.ts` 不會帶這個
   * param，必須繼續照舊運作。
   * 型別上刻意 optional：`undefined` 就是「沒帶＝mono」，與 wire 語意一一對應。
   */
  channels?: AudioChannels;
}

/** A hub is the sink patch-service / orchestrator push server messages through (role-filtered). */
export interface BroadcastSink {
  broadcast(meetingId: string, msg: ServerMessage, target: BroadcastTarget): void;
}
