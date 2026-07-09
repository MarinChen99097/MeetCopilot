"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, WsRole } from "@meetcopilot/shared";
import { connect, type WsConnection } from "@/lib/ws";

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

/** Human-readable (zh-TW) connection label shared by every realtime surface. */
export function wsStatusLabel(status: WsStatus): string {
  switch (status) {
    case "open":
      return "已連線";
    case "connecting":
      return "連線中…";
    case "reconnecting":
      return "重新連線中…";
    case "failed":
      return "連線失敗";
    default:
      return "未連線";
  }
}

/**
 * Map a WS close code to a human (zh-TW) reason + whether retrying is pointless.
 * The server closes 4000 on a bad handshake and 4001 on an invalid/mismatched token (ws-server.ts);
 * both are terminal (retrying the same bad creds can't succeed). Everything else (1006 unreachable,
 * 1001/1012 restart, …) is a transient drop we retry with backoff.
 */
export function describeWsClose(code: number): { terminal: boolean; reason: string } {
  switch (code) {
    case 4001:
      return { terminal: true, reason: "連線憑證無效或已過期，請重新從會議取得連結。" };
    case 4000:
      return { terminal: true, reason: "連線參數不正確，請重新從會議取得連結。" };
    default:
      return { terminal: false, reason: "與伺服器的連線中斷。" };
  }
}

const UNREACHABLE_REASON = "無法連上即時伺服器，請確認網路或稍後再試。";

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
}

export interface RealtimeHandle {
  status: WsStatus;
  /** Human-readable reason set when `status === "failed"` (else null). */
  failureReason: string | null;
  /** Re-arm the connection after a terminal `failed` state (user-driven; resets the retry budget). */
  retry: () => void;
  send: (msg: ClientMessage) => void;
  sendAudio: (frame: ArrayBuffer) => void;
}

const MAX_BACKOFF_MS = 15000;
/** Bounded auto-reconnect: after this many failed attempts we STOP and surface a terminal `failed`
 * state with a [重試] action — never an infinite silent "reconnecting…" loop. */
const MAX_ATTEMPTS = 6;

export function useRealtime(opts: RealtimeOptions): RealtimeHandle {
  const { apiBase, wsToken, meetingId, role, enabled = true } = opts;
  const [status, setStatus] = useState<WsStatus>("idle");
  const [failureReason, setFailureReason] = useState<string | null>(null);
  // Bumping this re-runs the effect (fresh socket + reset retry budget) — the retry() escape hatch.
  const [retryNonce, setRetryNonce] = useState(0);

  // Latest callbacks via refs so the effect below does not re-run (and reconnect) on every render.
  const onMessageRef = useRef(opts.onMessage);
  const onOpenRef = useRef(opts.onOpen);
  onMessageRef.current = opts.onMessage;
  onOpenRef.current = opts.onOpen;

  const connRef = useRef<WsConnection | null>(null);

  useEffect(() => {
    if (!enabled || !wsToken || !meetingId) {
      setStatus("idle");
      setFailureReason(null);
      return;
    }

    let disposed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let conn: WsConnection | null = null;

    const fail = (reason: string) => {
      if (disposed) return;
      setFailureReason(reason);
      setStatus("failed");
    };

    const open = () => {
      if (disposed) return;
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      conn = connect(apiBase, wsToken, meetingId, role, {
        onOpen: () => {
          if (disposed) return;
          attempt = 0;
          setFailureReason(null);
          setStatus("open");
          conn?.send({ type: "hello", role });
          onOpenRef.current?.();
        },
        onClose: (ev) => {
          if (disposed) return;
          const { terminal, reason } = describeWsClose(ev?.code ?? 1006);
          // Terminal (bad creds) → don't burn retries on something that can't succeed.
          if (terminal) {
            fail(reason);
            return;
          }
          // Transient drop: retry with backoff up to the cap, then surface a terminal failed+retry.
          if (attempt + 1 >= MAX_ATTEMPTS) {
            fail(UNREACHABLE_REASON);
            return;
          }
          setStatus("reconnecting");
          scheduleRetry();
        },
        onError: () => {
          // `close` fires after `error`; retry/terminal decision is made there. Nothing to do here.
        },
      });
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
  }, [apiBase, wsToken, meetingId, role, enabled, retryNonce]);

  const retry = useCallback(() => {
    setFailureReason(null);
    setRetryNonce((n) => n + 1);
  }, []);

  const send = (msg: ClientMessage) => connRef.current?.send(msg);
  const sendAudio = (frame: ArrayBuffer) => connRef.current?.sendAudio(frame);

  return { status, failureReason, retry, send, sendAudio };
}
