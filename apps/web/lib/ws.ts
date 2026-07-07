/**
 * Thin typed WebSocket helper — the single realtime seam (API_CONTRACT §6).
 *
 * Connection: `/ws?token=<wsToken>&meetingId=&role=` (role = capture | hud | present).
 * Transport: audio as **binary frames** (16-bit PCM 16kHz mono, ~250ms, raw ArrayBuffer); everything else JSON text.
 *
 * This is a compile-ready primitive (connect/send/sendAudio/on/close). It is intentionally NOT used by the
 * M0 placeholder pages — reconnect/backoff, session_state resync, and consent gating are layered on by callers
 * in M2/M3 (see ARCHITECTURE §4 surfaces).
 */
import { WS_PATH, type ClientMessage, type ServerMessage, type WsRole } from "@meetcopilot/shared";

/** Handle returned by `connect`: typed send + subscribe + teardown. */
export interface WsConnection {
  /** Send a JSON control message (typed to the §6 client→server union). */
  send(message: ClientMessage): void;
  /** Send a raw binary audio frame (capture role). */
  sendAudio(frame: ArrayBuffer): void;
  /** Subscribe to typed server→client messages; returns an unsubscribe fn. */
  on(listener: (message: ServerMessage) => void): () => void;
  /** Close the socket (no auto-reconnect at this layer). */
  close(): void;
}

/** Convert an http(s) API base into its ws(s) origin. */
function toWsOrigin(apiBase: string): string {
  return apiBase.replace(/^http(s?):\/\//i, (_m, s: string) => `ws${s}://`).replace(/\/+$/, "");
}

/**
 * Open a WS connection to `${apiBase}${WS_PATH}?token&meetingId&role`.
 * `apiBase` is the REST base (e.g. NEXT_PUBLIC_API_BASE); scheme is auto-mapped http→ws / https→wss.
 */
export function connect(apiBase: string, token: string, meetingId: string, role: WsRole): WsConnection {
  const url = new URL(`${toWsOrigin(apiBase)}${WS_PATH}`);
  url.searchParams.set("token", token);
  url.searchParams.set("meetingId", meetingId);
  url.searchParams.set("role", role);

  const ws = new WebSocket(url.toString());
  ws.binaryType = "arraybuffer";
  const listeners = new Set<(message: ServerMessage) => void>();

  ws.addEventListener("message", (ev: MessageEvent) => {
    if (typeof ev.data !== "string") return; // binary is server-inbound audio only in capture flows; ignore here
    let parsed: ServerMessage;
    try {
      parsed = JSON.parse(ev.data) as ServerMessage;
    } catch {
      return;
    }
    for (const l of listeners) l(parsed);
  });

  return {
    send(message: ClientMessage): void {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    },
    sendAudio(frame: ArrayBuffer): void {
      if (ws.readyState === WebSocket.OPEN) ws.send(frame);
    },
    on(listener: (message: ServerMessage) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close(): void {
      listeners.clear();
      ws.close();
    },
  };
}
