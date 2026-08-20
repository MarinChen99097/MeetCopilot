"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioChannels, ClientMessage, ServerMessage, WsRole } from "@meetcopilot/shared";
import { connect, describeWsClose, type WsCloseKind, type WsConnection, type WsReasonKey } from "@/lib/ws";

// close-code 判定的**單一真相**在 `lib/ws.ts`（/present 也吃同一張表）；這裡只轉出，讓既有
// `import { describeWsClose } from "@/lib/useRealtime"` 的呼叫端不受影響。**不要**在本檔再寫一份。
export { describeWsClose, type WsCloseKind, type WsReasonKey } from "@/lib/ws";

/**
 * Reconnecting WS layer over the `lib/ws` primitive (which deliberately does NOT reconnect).
 * Owns: hello-on-open, exponential backoff reconnect (bounded), a terminal `failed` state, and
 * connection status — the resync of app state on reconnect is left to the surface, which just
 * re-reads the server's `session_state` (sent on every (re)connect) from `onMessage`.
 *
 * State machine (drives the unified connection UI across /copilot + /hud):
 *   idle → connecting → open                     (happy path)
 *   open → reconnecting → open                   (transient drop recovers)
 *   connecting/reconnecting → failed             (auth-terminal close, or retry budget spent)
 *   failed → (retry()) → connecting …            (user-driven recovery — NEVER an infinite silent loop)
 *
 * Usage: keep `onMessage`/`onOpen` stable-ish (they are read via a ref, so identity changes do NOT
 * tear down the socket). The socket is (re)built only when connection identity or `enabled` changes.
 */
export type WsStatus = "idle" | "connecting" | "open" | "reconnecting" | "failed";

/** 連線狀態標籤的 i18n key，**相對於 `ws` namespace**。 */
export type WsStatusKey = "status.idle" | "status.connecting" | "status.open" | "status.reconnecting" | "status.failed";

/**
 * 連線狀態 → 文案 key（每個 realtime surface 共用同一張表）。
 *
 * 回 key 而不是句子的理由與 `describeWsClose` 相同：這是純函式、消費端遍及 /copilot、/hud、/sim，
 * 硬編繁中會讓 en locale 看到中文。消費端一律 `useTranslations("ws")` 後 `t(wsStatusKey(status))`。
 */
export function wsStatusKey(status: WsStatus): WsStatusKey {
  switch (status) {
    case "open":
      return "status.open";
    case "connecting":
      return "status.connecting";
    case "reconnecting":
      return "status.reconnecting";
    case "failed":
      return "status.failed";
    default:
      return "status.idle";
  }
}

export interface RealtimeOptions {
  apiBase: string;
  wsToken: string | null;
  meetingId: string | null;
  role: WsRole;
  /** Called for every server→client message. Read via ref (stable identity not required). */
  onMessage: (msg: ServerMessage) => void;
  /** Called after `hello` is sent on each (re)open — surfaces re-send role state (e.g. consent). */
  onOpen?: () => void;
  /** Gate the connection (e.g. capture only connects once listening starts). Default true. */
  enabled?: boolean;
  /**
   * Audio-format negotiation for the `capture` role: the number of channels the PCM frames carry
   * (1 = mono mix, 2 = interleaved L=mic/presenter + R=tab/other side). Sent as the `channels` query
   * param; **omitted when 1/absent**, which the server reads as mono. `/sim` (mono mp3 frames) simply
   * does not pass it. It is part of the connection identity, so changing it rebuilds the socket —
   * a socket must never outlive the frame layout it was opened for.
   */
  channels?: AudioChannels;
}

export interface RealtimeHandle {
  status: WsStatus;
  /**
   * 失敗原因的 **i18n key**（相對於 `ws` namespace），只在 `status === "failed"` 時有值。
   * 消費端：`useTranslations("ws")` 後 `t(failureReasonKey)`。回 key 而非句子的理由見 `lib/ws.ts`
   * 的 `WsReasonKey`——判定發生在 React 之外的 socket callback 裡，那裡沒有 hook 可用。
   */
  failureReasonKey: WsReasonKey | null;
  /**
   * Why we failed (null unless `status === "failed"`). `"retryable"`＝重連預算耗盡，重試有意義；
   * `"ended"`／`"auth"`＝終態。UI 用它決定**要不要渲染重試鈕**（見 `canRetry`）。
   */
  failureKind: WsCloseKind | null;
  /**
   * 這個 failed 狀態重試是否有意義。false＝終態（會議已結束／憑證或帳號問題）——此時 `retry()` 是
   * no-op，UI **不得**渲染重試鈕：按下去只會再被 server 用同一個 close code 關一次。
   * **這是 UX 判斷，不是安全邊界**——「已結束的會議不得被復活」由 server 的握手閘保證
   * （`apps/server/src/realtime/ws-handshake-gate.ts`：completed 會議直接拒絕握手）。
   */
  canRetry: boolean;
  /**
   * Re-arm the connection after a `failed` state (user-driven; resets the retry budget).
   * **終態（`canRetry === false`）時刻意 no-op**：UI 不該有那顆按鈕，就算被程式呼叫也不能真的重連。
   */
  retry: () => void;
  send: (msg: ClientMessage) => void;
  sendAudio: (frame: ArrayBuffer) => void;
}

const MAX_BACKOFF_MS = 15000;
/** Bounded auto-reconnect: after this many failed attempts we STOP and surface a terminal `failed`
 * state with a [重試] action — never an infinite silent "reconnecting…" loop. */
const MAX_ATTEMPTS = 6;

export function useRealtime(opts: RealtimeOptions): RealtimeHandle {
  const { apiBase, wsToken, meetingId, role, enabled = true, channels } = opts;
  const [status, setStatus] = useState<WsStatus>("idle");
  // 失敗原因＋種類綁在同一個 state：兩者永遠同時設定，拆兩個 state 只會多出「文案是新的、kind 還是舊的」的窗口。
  const [failure, setFailure] = useState<{ reasonKey: WsReasonKey; kind: WsCloseKind } | null>(null);
  // Bumping this re-runs the effect (fresh socket + reset retry budget) — the retry() escape hatch.
  const [retryNonce, setRetryNonce] = useState(0);
  /** 終態閘門的**權威**副本：`retry()` 是 useCallback，不能只靠 render 期的 state 判斷（stale closure）。 */
  const terminalRef = useRef(false);

  // Latest callbacks via refs so the effect below does not re-run (and reconnect) on every render.
  const onMessageRef = useRef(opts.onMessage);
  const onOpenRef = useRef(opts.onOpen);
  onMessageRef.current = opts.onMessage;
  onOpenRef.current = opts.onOpen;

  const connRef = useRef<WsConnection | null>(null);

  useEffect(() => {
    if (!enabled || !wsToken || !meetingId) {
      setStatus("idle");
      setFailure(null);
      terminalRef.current = false;
      return;
    }

    let disposed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let conn: WsConnection | null = null;
    terminalRef.current = false;

    const fail = (reasonKey: WsReasonKey, kind: WsCloseKind) => {
      if (disposed) return;
      // 終態閘門：先立旗標再設 state——`retry()` 讀的是 ref，晚一步就會放行一次注定被拒的重連。
      terminalRef.current = kind !== "retryable";
      setFailure({ reasonKey, kind });
      setStatus("failed");
    };

    const open = () => {
      if (disposed) return;
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      const lifecycle = {
        onOpen: () => {
          if (disposed) return;
          attempt = 0;
          terminalRef.current = false;
          setFailure(null);
          setStatus("open");
          conn?.send({ type: "hello", role });
          onOpenRef.current?.();
        },
        onClose: (ev: CloseEvent) => {
          if (disposed) return;
          const { terminal, kind, reasonKey } = describeWsClose(ev?.code ?? 1006);
          // Terminal (meeting ended / bad creds) → don't burn retries on something that can't succeed,
          // and lock `retry()` out (see `fail`).
          if (terminal) {
            fail(reasonKey, kind);
            return;
          }
          // Transient drop: retry with backoff up to the cap, then surface a failed state WITH retry.
          if (attempt + 1 >= MAX_ATTEMPTS) {
            fail("close.unreachable", "retryable");
            return;
          }
          setStatus("reconnecting");
          scheduleRetry();
        },
        onError: () => {
          // `close` fires after `error`; retry/terminal decision is made there. Nothing to do here.
        },
      };
      // `channels` is appended by `connect` only when it is 2 — mono keeps the historical URL shape.
      conn = connect(apiBase, wsToken, meetingId, role, lifecycle, channels);
      conn.on((msg) => {
        if (!disposed) onMessageRef.current(msg);
      });
      connRef.current = conn;
    };

    const scheduleRetry = () => {
      if (disposed || retryTimer) return;
      const backoff = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt);
      const jitter = Math.random() * 300;
      attempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        open();
      }, backoff + jitter);
    };

    open();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      connRef.current = null;
      try {
        conn?.close();
      } catch {
        /* ignore */
      }
      setStatus("idle");
    };
    // Reconnect only when connection identity / gating / retry-nonce changes — NOT on callback identity.
    // `channels` is part of that identity: the frame layout is negotiated at handshake time, so a
    // socket opened as mono must never start carrying stereo frames (or vice versa).
  }, [apiBase, wsToken, meetingId, role, enabled, channels, retryNonce]);

  const retry = useCallback(() => {
    // 終態＝重連不可能成功：auth 拿同一組憑證再連幾次都一樣；ended 會被 server 的握手閘
    // （`ws-handshake-gate.ts`）以同一個 1000 再拒一次。**安全性由那道閘保證**，這裡只是不送出
    // 注定失敗的連線、也不讓 UI 出現無效動作（UI 本來就不該渲染那顆鈕，這是最後一道 UX 閘）。
    if (terminalRef.current) return;
    setFailure(null);
    setRetryNonce((n) => n + 1);
  }, []);

  const send = (msg: ClientMessage) => connRef.current?.send(msg);
  const sendAudio = (frame: ArrayBuffer) => connRef.current?.sendAudio(frame);

  return {
    status,
    failureReasonKey: failure?.reasonKey ?? null,
    failureKind: failure?.kind ?? null,
    canRetry: failure ? failure.kind === "retryable" : true,
    retry,
    send,
    sendAudio,
  };
}
