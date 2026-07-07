"use client";

import { useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, WsRole } from "@meetcopilot/shared";
import { connect, type WsConnection } from "@/lib/ws";

/**
 * Reconnecting WS layer over the `lib/ws` primitive (which deliberately does NOT reconnect).
 * Owns: hello-on-open, exponential backoff reconnect, and connection status — the resync of
 * app state on reconnect is left to the surface, which just re-reads the server's `session_state`
 * (sent by the server on every (re)connect) from `onMessage`.
 *
 * Usage: keep `onMessage`/`onOpen` stable-ish (they are read via a ref, so identity changes do NOT
 * tear down the socket). The socket is (re)built only when connection identity or `enabled` changes.
 */
export type WsStatus = "idle" | "connecting" | "open" | "reconnecting";

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
  send: (msg: ClientMessage) => void;
  sendAudio: (frame: ArrayBuffer) => void;
}

const MAX_BACKOFF_MS = 15000;

export function useRealtime(opts: RealtimeOptions): RealtimeHandle {
  const { apiBase, wsToken, meetingId, role, enabled = true } = opts;
  const [status, setStatus] = useState<WsStatus>("idle");

  // Latest callbacks via refs so the effect below does not re-run (and reconnect) on every render.
  const onMessageRef = useRef(opts.onMessage);
  const onOpenRef = useRef(opts.onOpen);
  onMessageRef.current = opts.onMessage;
  onOpenRef.current = opts.onOpen;

  const connRef = useRef<WsConnection | null>(null);

  useEffect(() => {
    if (!enabled || !wsToken || !meetingId) {
      setStatus("idle");
      return;
    }

    let disposed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let conn: WsConnection | null = null;

    const open = () => {
      if (disposed) return;
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      conn = connect(apiBase, wsToken, meetingId, role, {
        onOpen: () => {
          if (disposed) return;
          attempt = 0;
          setStatus("open");
          conn?.send({ type: "hello", role });
          onOpenRef.current?.();
        },
        onClose: () => {
          if (disposed) return;
          setStatus("reconnecting");
          scheduleRetry();
        },
        onError: () => {
          // `close` fires after `error`; retry is scheduled there. Nothing to do here.
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
    // Reconnect only when connection identity / gating changes — NOT on callback identity.
  }, [apiBase, wsToken, meetingId, role, enabled]);

  const send = (msg: ClientMessage) => connRef.current?.send(msg);
  const sendAudio = (frame: ArrayBuffer) => connRef.current?.sendAudio(frame);

  return { status, send, sendAudio };
}
