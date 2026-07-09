/**
 * M3 realtime WebSocket server (API_CONTRACT §6). One ws.Server per process at WS_PATH; connections are
 * `/ws?token=<wsToken>&meetingId=&role=` (role = capture|hud|present).
 *
 * Auth & trust boundary (I2):
 *  - The wsToken is verified server-side (signature/exp/typ + meetingId match). Identity (userId/orgId) and the
 *    meeting's presenter id come ONLY from the verified token — never from a client message payload.
 *  - `suggestion_action` and `page_commit` are presenter-only: enforced by `meta.isPresenter`
 *    (= userId === presenter_user_id) AND role === 'present'. A valid-but-non-presenter token, or a normal app
 *    JWT replayed as a wsToken, or any forged token, is rejected — an attacker cannot commit pages or approve
 *    slides. Both a handshake gate and a per-message gate are applied (defense in depth).
 *
 * I3: audio frames are only meaningful from 'capture'; all HUD-bound content is routed by the hub to 'hud' only.
 */
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { Server } from "node:http";
import type { ClientMessage, SlideSpec } from "@meetcopilot/shared";
import { WS_PATH } from "@meetcopilot/shared";
import type { CrmCore } from "@meetcopilot/crm";
import { verifyWsToken } from "./ws-token.js";
import { isAccountActive } from "../auth/active-account.js";
import type { RealtimeHub } from "./hub.js";
import type { ConnMeta } from "./types.js";

function parseQuery(url: string | undefined): URLSearchParams {
  if (!url) return new URLSearchParams();
  const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  return new URLSearchParams(q);
}

function parseRole(v: string | null): "capture" | "hud" | "present" | null {
  return v === "capture" || v === "hud" || v === "present" ? v : null;
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data as ArrayBuffer);
}

/** Minimal runtime validation of an edited slide from an untrusted client (structure only; blocks are opaque). */
function asEditedSlide(v: unknown): SlideSpec | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.template !== "string" || !Array.isArray(o.blocks)) return undefined;
  return v as SlideSpec;
}

export function attachRealtimeWs(server: Server, hub: RealtimeHub, jwtSecret: string, core: CrmCore): WebSocketServer {
  const wss = new WebSocketServer({ server, path: WS_PATH });

  wss.on("connection", (ws: WebSocket, req) => {
    // Uptime + no-leak: attach 'error' (and 'close') listeners SYNCHRONOUSLY, before the first await below.
    //  - 'error': ws@8's EventEmitter re-throws a socket error as an UNCAUGHT exception when no 'error' listener
    //    is registered. index.ts installs no uncaughtException handler, so an error emitted during the async
    //    account check would crash the whole process and drop every live meeting. One permanent logger covers
    //    the pre-attach window AND the rest of the connection's life.
    //  - 'close': if the socket drops DURING the account check, its 'close' fires before hub.attach runs; the
    //    listener must already be live so the socket is detached (hub.detach is a safe no-op until attach) and
    //    never lingers as a ghost room entry that pins the runtime/ASR open. Registered once here (not re-added
    //    after the check) to avoid double-detach.
    ws.on("error", (err) => console.error("[realtime] ws error:", err));
    ws.on("close", () => hub.detach(ws));

    const query = parseQuery(req.url);
    const token = query.get("token");
    const meetingId = query.get("meetingId");
    const role = parseRole(query.get("role"));

    if (!token || !meetingId || !role) {
      ws.send(JSON.stringify({ type: "error", code: "bad_handshake", message: "token, meetingId, role required" }));
      ws.close(4000, "bad handshake");
      return;
    }

    let claims;
    try {
      claims = verifyWsToken(jwtSecret, token);
    } catch {
      ws.send(JSON.stringify({ type: "error", code: "unauthorized", message: "invalid ws token" }));
      ws.close(4001, "unauthorized");
      return;
    }
    if (claims.meetingId !== meetingId) {
      ws.send(JSON.stringify({ type: "error", code: "unauthorized", message: "token/meeting mismatch" }));
      ws.close(4001, "unauthorized");
      return;
    }

    const meta: ConnMeta = {
      userId: claims.userId,
      orgId: claims.orgId,
      meetingId,
      role,
      // Presenter authority requires BOTH the identity match AND a present-role connection (I2, defense in depth).
      isPresenter: claims.userId === claims.presenterUserId && role === "present",
    };

    // Account-suspension gate (ADMIN_CONTRACT §2): a suspended org/user is denied at the WS upgrade too, the
    // same as the HTTP activeAccountRequired middleware. Async (two tiny indexed lookups); fail-closed on error.
    // Attach the hub + message/close listeners ONLY after the check passes, so a suspended socket never joins a
    // room. Mirrors this file's send-error-then-close rejection style.
    isAccountActive(core, meta.orgId, meta.userId)
      .then((active) => {
        if (!active) {
          ws.send(JSON.stringify({ type: "error", code: "account_suspended", message: "帳號已停權，無法連線" }));
          ws.close(4003, "account suspended");
          return;
        }

        // hub.attach guards against a socket that closed during the check above (readyState !== OPEN → no-op),
        // so a dead socket never becomes a ghost room member. 'error'/'close' were bound synchronously above.
        hub.attach(ws, meta);

        ws.on("message", (data: RawData, isBinary: boolean) => {
          const buf = toBuffer(data);
          if (isBinary) {
            // Audio: only from capture; hub applies the consent gate.
            if (meta.role === "capture") hub.pushAudio(meta, buf);
            return;
          }
          let msg: ClientMessage;
          try {
            msg = JSON.parse(buf.toString("utf8")) as ClientMessage;
          } catch {
            sendError(ws, "bad_message", "malformed JSON");
            return;
          }
          handleMessage(ws, hub, meta, msg);
        });
      })
      .catch((err) => {
        console.error("[realtime] active-account check failed:", err);
        sendError(ws, "account_suspended", "帳號狀態檢查失敗");
        if (ws.readyState === ws.OPEN) ws.close(4003, "account check failed");
      });
  });

  return wss;
}

function sendError(ws: WebSocket, code: string, message: string): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "error", code, message }));
}

function handleMessage(ws: WebSocket, hub: RealtimeHub, meta: ConnMeta, msg: ClientMessage): void {
  switch (msg.type) {
    case "hello":
    case "ping":
      // Contract: ping/hello reply = session_state (no pong frame).
      hub.broadcastState(meta.meetingId);
      return;

    case "consent": {
      // Consent gate is driven by the capture surface.
      if (meta.role !== "capture") {
        sendError(ws, "forbidden", "consent is set by the capture surface");
        return;
      }
      const runtime = hub.getRuntime(meta.meetingId);
      if (runtime) runtime.consent = Boolean(msg.granted);
      hub.broadcastState(meta.meetingId);
      return;
    }

    case "page_commit": {
      // I2 presenter-only.
      if (!meta.isPresenter) {
        sendError(ws, "forbidden_not_presenter", "page_commit is presenter-only");
        return;
      }
      const runtime = hub.getRuntime(meta.meetingId);
      if (!runtime) return;
      // Monotonic advance only (never rewind a committed head).
      if (typeof msg.index === "number" && msg.index > runtime.committedIndex) {
        runtime.committedIndex = msg.index;
        runtime.deckLength = Math.max(runtime.deckLength, msg.index + 1);
        // deck committed_index is persisted by the M2 DeckRepository (best-effort).
        if (runtime.deckId) void hub.setDeckCommitted(runtime.orgId, runtime.deckId, msg.index);
        hub.broadcastState(meta.meetingId);
      }
      return;
    }

    case "suggestion_action": {
      // I2 presenter-only; identity/authority is server-verified (meta.isPresenter), never from payload.
      if (!meta.isPresenter) {
        sendError(ws, "forbidden_not_presenter", "suggestion_action is presenter-only");
        return;
      }
      hub.patch.act(meta.meetingId, msg.suggestionId, msg.action, true, asEditedSlide(msg.editedSlide));
      return;
    }

    case "deep_research": {
      // HUD-initiated manual research (bounded by the per-meeting quota).
      if (meta.role !== "hud" && !meta.isPresenter) {
        sendError(ws, "forbidden", "deep_research is a HUD action");
        return;
      }
      hub.triggerResearch(meta.meetingId, msg.query);
      return;
    }

    default:
      sendError(ws, "unknown_message", "unsupported message type");
  }
}
