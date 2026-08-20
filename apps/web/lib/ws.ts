/**
 * Thin typed WebSocket helper — the single realtime seam (API_CONTRACT §6).
 *
 * Connection: `/ws?token=<wsToken>&meetingId=&role=[&channels=1|2]` (role = capture | hud | present).
 * Transport: audio as **binary frames** (16-bit LE PCM 16kHz, ~250ms, raw ArrayBuffer); everything else JSON text.
 *
 * `channels` is the audio-format negotiation for the capture role only: 1 (or absent) = mono mix,
 * 2 = interleaved L/R where **L = microphone = presenter** and **R = tab audio = the other side**.
 * It is omitted entirely when mono so that the server's "absent ⇒ mono" fail-safe stays the default.
 *
 * This is a compile-ready primitive (connect/send/sendAudio/on/close). It is intentionally NOT used by the
 * M0 placeholder pages — reconnect/backoff, session_state resync, and consent gating are layered on by callers
 * in M2/M3 (see ARCHITECTURE §4 surfaces).
 */
import {
  WS_CHANNELS_STEREO,
  WS_CLOSE_ACCOUNT_BLOCKED,
  WS_CLOSE_BAD_HANDSHAKE,
  WS_CLOSE_MEETING_ENDED,
  WS_CLOSE_UNAUTHORIZED,
  WS_PARAM_CHANNELS,
  WS_PATH,
  type AudioChannels,
  type ClientMessage,
  type ServerMessage,
  type WsRole,
} from "@meetcopilot/shared";

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

/**
 * Why a close code is fatal — drives BOTH what we tell the user and which actions we may offer.
 *  - `"retryable"`：短暫斷線（1006／1012／1001…）＝退避重連有意義。
 *  - `"ended"`：會議已在 server 端結束（close 1000）＝再連一次只會被 server 的握手閘（`ws-handshake-gate.ts`）
 *    以同一個 1000 拒絕。**前端不是這件事的安全邊界**，這個 kind 只用來決定要給哪一組文案與出口。
 *  - `"auth"`：憑證／帳號問題（4000／4001／4003）＝同一組憑證再連幾次都不會成功。
 */
export type WsCloseKind = "retryable" | "ended" | "auth";

/**
 * 連線原因文案的 i18n key，**相對於 `ws` namespace**（消費端一律 `useTranslations("ws")` 後 `t(key)`）。
 *
 * 為什麼回 key 而不是回句子：`describeWsClose` 是純函式，且在 **React 之外**也會被呼叫
 *（`useRealtime` 的 `onClose` lifecycle callback、`PresentStage` 手搓重連的 `onClose`）——那裡沒有
 * hook 可用，在函式內呼叫 `useTranslations` 會直接違反 hook 規則。把「決定是哪一句」與「把那一句翻出來」
 * 拆開，判定表就能維持成不依賴 React 的單一真相，翻譯留在有 hook 的渲染層做。
 *
 * `close.unreachable` 不由本函式產生（那是 `useRealtime` 的重連預算耗盡），但刻意收在同一個 union：
 * 「WS 連線相關的文案 key」只有這一份清單，加一句時不會有人漏掉另一個檔。
 */
export type WsReasonKey =
  | "close.authToken"
  | "close.authHandshake"
  | "close.authAccount"
  | "close.ended"
  | "close.dropped"
  | "close.unreachable";

/**
 * **前端唯一的 close-code 判定表**：close code → 文案 key ＋ 是否重試無意義。
 * code 本身不是這裡的常數——**值的單一真相在 `@meetcopilot/shared`**，server 送出時 import 的是同一組
 * 具名常數，所以這張表與 server 不可能對不上（收斂前 server 只有 1000 被命名、4000/4001/4003 是裸數字，
 * 而這裡另有一份自己的字面量；兩份只靠註解互相指涉）。各 code 的語意寫在 shared 的常數上。
 *
 * 放在這個 primitive（而不是 `useRealtime`）是因為**兩個**消費端要用同一張表：`useRealtime`
 * （/copilot＋/hud）與 `PresentStage`（/present 自己拿 `connect` 手搓重連）。2026-08-19 之前
 * PresentStage 自帶一份 `code === 4001 || code === 4000` 的判定，1000 落在「可重連」分支，於是
 * 報告者結束會議後 /present 照樣自動重連（當時 server 握手也還沒查 meeting status，那條路因此能重建
 * runtime；今天由 `ws-handshake-gate.ts` 擋死）。抄第二份表正是那個 bug 的成因，故收斂到這裡；
 * `useRealtime` 只 re-export，不再自帶第二份。
 * （放 `lib/ws.ts` 還有一個硬理由：`PresentStage` 的 import 白名單＝I3 的機械保證，這裡加符號**零新增 import**。）
 *
 * `WS_CLOSE_ACCOUNT_BLOCKED` 涵蓋 server 的兩個分支（"account suspended" 與 fail-closed 的
 * "account check failed"）；客戶端分不出（同一個 code、reason 字串沒有外露），故一句文案涵蓋兩者。
 * 未具名的 code（1001 graceful shutdown、1006 unreachable、1012 restart…）一律走 default ＝退避重連。
 */
export function describeWsClose(code: number): { terminal: boolean; kind: WsCloseKind; reasonKey: WsReasonKey } {
  switch (code) {
    case WS_CLOSE_UNAUTHORIZED:
      return { terminal: true, kind: "auth", reasonKey: "close.authToken" };
    case WS_CLOSE_BAD_HANDSHAKE:
      return { terminal: true, kind: "auth", reasonKey: "close.authHandshake" };
    case WS_CLOSE_ACCOUNT_BLOCKED:
      return { terminal: true, kind: "auth", reasonKey: "close.authAccount" };
    case WS_CLOSE_MEETING_ENDED:
      return { terminal: true, kind: "ended", reasonKey: "close.ended" };
    default:
      return { terminal: false, kind: "retryable", reasonKey: "close.dropped" };
  }
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
 * Open a WS connection to `${apiBase}${WS_PATH}?token&meetingId&role[&channels]`.
 * `apiBase` is the REST base (e.g. NEXT_PUBLIC_API_BASE); scheme is auto-mapped http→ws / https→wss.
 *
 * `channels` is appended LAST and is optional so existing callers (PresentStage, and any mono capture)
 * are untouched; only the value 2 is written — 1 stays absent and lands on the server's mono default.
 * The param name and the "only the literal 2 is stereo" rule are shared wire constants, so this writer
 * and the server's `parseAudioChannels` reader can never drift apart.
 */
export function connect(
  apiBase: string,
  token: string,
  meetingId: string,
  role: WsRole,
  lifecycle?: WsLifecycle,
  channels?: AudioChannels,
): WsConnection {
  const url = new URL(toWsEndpoint(apiBase));
  url.searchParams.set("token", token);
  url.searchParams.set("meetingId", meetingId);
  url.searchParams.set("role", role);
  if (channels === 2) url.searchParams.set(WS_PARAM_CHANNELS, WS_CHANNELS_STEREO);

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
