/**
 * WebSocket endpoint at /ws — M0 scaffold only. Full realtime protocol (audio ingest, ASR, signals,
 * approval FSM, presenter authz) lands in M3. We wire the FROZEN protocol types now (shared/protocol.ts)
 * so the contract is already in place:
 *  - 'hello' → reply session_state (liveness + connected role echo)
 *  - 'ping'  → reply session_state (M0 keepalive; protocol has no 'pong' — we answer with a contract-valid
 *              message rather than inventing an off-contract frame)
 *  - anything else / malformed → send `error` then close politely
 *  - binary (audio) frames → ignored in M0 (audio pipeline is M3)
 * NOTE: WS auth (wsToken/role verification, presenter authz for suggestion_action/page_commit) is M3/M5;
 * M0 accepts every connection.
 */
import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "node:http";
import type { ClientMessage, ServerMessage, WsRole } from "@meetcopilot/shared";
import { WS_PATH } from "@meetcopilot/shared";

function send(ws: WebSocket, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg));
}

function parseRole(url: string | undefined): WsRole | "unknown" {
  if (!url) return "unknown";
  const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  const role = new URLSearchParams(q).get("role");
  return role === "capture" || role === "hud" || role === "present" ? role : "unknown";
}

export function attachWs(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: WS_PATH });

  wss.on("connection", (ws: WebSocket, req) => {
    const role = parseRole(req.url);

    ws.on("message", (data: unknown, isBinary: boolean) => {
      if (isBinary) return; // M0: audio frames not handled yet (M3)

      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(data)) as ClientMessage;
      } catch {
        send(ws, { type: "error", code: "bad_message", message: "malformed JSON" });
        ws.close(1003, "bad message");
        return;
      }

      switch (msg.type) {
        case "hello":
        case "ping":
          send(ws, {
            type: "session_state",
            consent: false,
            committedIndex: 0,
            connectedRoles: [role],
          });
          return;
        default:
          send(ws, {
            type: "error",
            code: "not_implemented",
            message: "full realtime protocol lands in M3",
          });
          ws.close(1000, "not implemented in M0");
          return;
      }
    });
  });

  return wss;
}
