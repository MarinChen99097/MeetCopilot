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
  /** Current socket readiness (mirrors WebSocket.readyState constants). */
  readyState(): number;
  /** Close the socket (no auto-reconnect at this layer). */
  close(): void;
}

/**
 * Optional socket-lifecycle callbacks. The base primitive does NOT reconnect; callers that need
 * reconnect/backoff (M3 /copilot, /hud) layer it on top by re-`connect`-ing on `onClose`.
 * All optional so existing type-only / M0 usage is unaffected.
 */
export interface WsLifecycle {
  onOpen?: () => void;
  onClose?: (ev: CloseEvent) => void;
  onError?: () => void;
}

/** Convert an http(s) API base into its ws(s) origin (scheme-mapped, no trailing slash). */
function toWsOrigin(apiBase: string): string {
  return apiBase.replace(/^http(s?):\/\//i, (_m, s: string) => `ws${s}://`).replace(/\/+$/, "");
}

/**
 * Build the WS endpoint URL, tolerating BOTH input shapes callers pass as `apiBase`:
 *  - a REST/ws *origin* (e.g. `http://host:8787` or `ws://host:8787`) → append WS_PATH, and
 *  - the *full* ws endpoint already carrying WS_PATH (POST /api/meetings returns
 *    `wsUrl = ${wsBase}${WS_PATH}`, i.e. `ws://host:8787/ws`) → use as-is.
 * Without this guard the latter double-appends to `…/ws/ws`, which the path-scoped
 * WebSocketServer rejects with a 400 handshake abort → the surface can never connect.
 */
function toWsEndpoint(apiBase: string): string {
  const origin = toWsOrigin(apiBase);
  return origin.endsWith(WS_PATH) ? origin : `${origin}${WS_PATH}`;
}

/**
 * Open a WS connection to `${apiBase}${WS_PATH}?token&meetingId&role`.
 * `apiBase` is the REST base (e.g. NEXT_PUBLIC_API_BASE); scheme is auto-mapped http→ws / https→wss.
 */
export function connect(
  apiBase: string,
  token: string,
  meetingId: string,
  role: WsRole,
  lifecycle?: WsLifecycle,
): WsConnection {
  const url = new URL(toWsEndpoint(apiBase));
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

  if (lifecycle?.onOpen) ws.addEventListener("open", () => lifecycle.onOpen?.());
  if (lifecycle?.onClose) ws.addEventListener("close", (ev) => lifecycle.onClose?.(ev as CloseEvent));
  if (lifecycle?.onError) ws.addEventListener("error", () => lifecycle.onError?.());

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
    readyState(): number {
      return ws.readyState;
    },
    close(): void {
      listeners.clear();
      ws.close();
    },
  };
}
