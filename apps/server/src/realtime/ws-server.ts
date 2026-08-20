/**
 * M3 realtime WebSocket server (API_CONTRACT §6). One ws.Server per process at WS_PATH; connections are
 * `/ws?token=<wsToken>&meetingId=&role=[&channels=1|2]` (role = capture|hud|present).
 *
 * `channels` is the audio-format negotiation only (1 = mono mix, 2 = interleaved L/R = presenter/client);
 * it is NOT part of the trust boundary below — see `ConnMeta.channels` / shared's `parseAudioChannels`
 * (absent ⇒ mono). Close codes and the `channels` rule are shared wire constants (@meetcopilot/shared),
 * so the web client's `describeWsClose` / URL builder read the exact same values.
 *
 * Auth & trust boundary (I2):
 *  - The wsToken is verified server-side (signature/exp/typ + meetingId match). Identity (userId/orgId) and the
 *    meeting's presenter id come ONLY from the verified token — never from a client message payload.
 *  - `suggestion_action` and `page_commit` are presenter-only: enforced by `meta.isPresenter`, a PURE identity
 *    check (= userId === presenter_user_id). `role` is a self-chosen push-target query param, NOT a security
 *    boundary, so it is not part of the gate — the cockpit presenter approves from the `hud` connection. A
 *    valid-but-non-presenter token, or a normal app JWT replayed as a wsToken, or any forged token, is rejected
 *    — an attacker cannot commit pages or approve slides. The per-message gate here plus patch-service's
 *    presenterAuth re-check apply defense in depth.
 *  - Handshake gate (`ws-handshake-gate.ts`, ONE db.get): account suspension **and** meeting liveness. A meeting
 *    that is already `completed` — or that this token's org cannot see at all — is refused before hub.attach, so
 *    an F5 on a `/hud` / `/present` tab (creds live in the URL) can never resurrect a finished meeting's runtime.
 *
 * I3: audio frames are only meaningful from 'capture'; all HUD-bound content is routed by the hub to 'hud' only.
 */
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { Server } from "node:http";
import type { ClientMessage, SlideSpec } from "@meetcopilot/shared";
import {
  WS_CLOSE_ACCOUNT_BLOCKED,
  WS_CLOSE_BAD_HANDSHAKE,
  WS_CLOSE_MEETING_ENDED,
  WS_CLOSE_UNAUTHORIZED,
  WS_PARAM_CHANNELS,
  WS_PATH,
  parseAudioChannels,
} from "@meetcopilot/shared";
import type { CrmCore } from "@meetcopilot/crm";
import { verifyWsToken } from "./ws-token.js";
import { checkWsHandshake } from "./ws-handshake-gate.js";
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
    // 音訊格式協商（非安全邊界，故與 token 驗證分開、也不參與下面的 bad_handshake 判定）。
    // param 名與 fail-safe 判定都在 shared，與 web 組 URL 處吃同一份（見 `parseAudioChannels`）。
    const channels = parseAudioChannels(query.get(WS_PARAM_CHANNELS));

    if (!token || !meetingId || !role) {
      ws.send(JSON.stringify({ type: "error", code: "bad_handshake", message: "token, meetingId, role required" }));
      ws.close(WS_CLOSE_BAD_HANDSHAKE, "bad handshake");
      return;
    }

    let claims;
    try {
      claims = verifyWsToken(jwtSecret, token);
    } catch {
      ws.send(JSON.stringify({ type: "error", code: "unauthorized", message: "invalid ws token" }));
      ws.close(WS_CLOSE_UNAUTHORIZED, "unauthorized");
      return;
    }
    if (claims.meetingId !== meetingId) {
      ws.send(JSON.stringify({ type: "error", code: "unauthorized", message: "token/meeting mismatch" }));
      ws.close(WS_CLOSE_UNAUTHORIZED, "unauthorized");
      return;
    }

    const meta: ConnMeta = {
      userId: claims.userId,
      orgId: claims.orgId,
      meetingId,
      role,
      // Presenter authority is a PURE identity check: the wsToken (minted by the presenter at meeting creation,
      // carrying presenterUserId) proves who you are. `role` is only a self-chosen push-target query param — any
      // token holder can already claim role='present', so it is not a security boundary; gating on it merely
      // rejected the legitimate cockpit flow where the presenter approves from the `hud` connection (the I2
      // role-slice). Identity is still doubly enforced (token possession + userId===presenterUserId; the
      // patch-service presenterAuth check re-verifies before any deck mutation).
      isPresenter: claims.userId === claims.presenterUserId,
      // 唯一一個**不是**來自已驗證 token 的欄位（`ConnMeta.channels` 有完整信任分析）：只描述 client
      // 送上來的 PCM frame 是 mono 還是交錯 stereo，謊報純自傷。
      channels,
    };

    // 單一握手閘（`ws-handshake-gate.ts`）：**一次 db.get** 同時判帳號停權（ADMIN_CONTRACT §2，與 HTTP 的
    // activeAccountRequired 同語意）與**這場會議還在不在**（org-scoped）。後者是殭屍會議的根因修補——
    // 前端那些 close-code 終態判定只擋得住重連，`/hud`、`/present` 的憑證就在網址列，會議結束後按一次 F5
    // 就是全新連線、全部繞過；沒有這一關，`hub.ensureRuntime` 會替 completed meeting 重建 runtime＋ASR。
    // 全程 async；fail-closed on error。hub 與 message/close listener **只在通過後才掛**，被拒的 socket
    // 永遠不會進房。沿用本檔既有的「先送 error 再 close」拒絕風格。
    checkWsHandshake(core, meta.orgId, meta.userId, meta.meetingId)
      .then((denial) => {
        if (denial === "account") {
          ws.send(JSON.stringify({ type: "error", code: "account_suspended", message: "帳號已停權，無法連線" }));
          ws.close(WS_CLOSE_ACCOUNT_BLOCKED, "account suspended");
          return;
        }
        if (denial === "meeting") {
          // 已 completed、或本 org 查不到這場（含跨 org 探測）——**兩者送出逐位元相同的回應**，
          // 攻擊者無法從這裡分辨「別的 org 有沒有這場會議」（gate 的 org-scoped 說明見該檔）。
          // close code 1000＝前端 `describeWsClose` 的 `kind:"ended"`（terminal、不重連、顯示「會議已結束」）。
          ws.send(JSON.stringify({ type: "error", code: "meeting_ended", message: "這場會議已結束，無法連線" }));
          ws.close(WS_CLOSE_MEETING_ENDED, "meeting ended");
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
        // fail-closed：閘跑不起來（DB 掛掉）一律拒，且沿用**修補前既有的 4003**——對 client 而言這是
        // 「狀態確認失敗」而不是「會議已結束」，不可誤報成 1000（那會讓前端清掉憑證、當成會議真的結束了）。
        console.error("[realtime] handshake gate failed:", err);
        sendError(ws, "account_suspended", "帳號狀態檢查失敗");
        if (ws.readyState === ws.OPEN) ws.close(WS_CLOSE_ACCOUNT_BLOCKED, "account check failed");
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
        // 023 翻頁勾稽（契約 §7.2）：committedIndex 前進**之前**結算「前一頁」的停留時間；
        // ≥SLIDE_DWELL_COVER_MS 才把綁前一頁的 pending 項目劃掉（hub 內做，含 lastCommitAt 推進）。
        hub.onPageCommitted(runtime, runtime.committedIndex);
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

    case "checklist_action": {
      // I2 presenter-only（契約 §1/§5）：與 suggestion_action 同一個純身分閘（meta.isPresenter＝
      // userId === presenterUserId，來自已驗證的 wsToken，永不取自 payload）。報告者是清單的最終權威。
      if (!meta.isPresenter) {
        sendError(ws, "forbidden_not_presenter", "checklist_action is presenter-only");
        return;
      }
      if (typeof msg.itemId !== "string" || !msg.itemId) {
        sendError(ws, "bad_message", "itemId is required");
        return;
      }
      if (msg.action !== "check" && msg.action !== "uncheck" && msg.action !== "skip") {
        sendError(ws, "bad_message", "action must be check|uncheck|skip");
        return;
      }
      // orgId 取自 token（meta），非 payload；處理後 hub 重播全量 snapshot 給 hud（I3）。
      hub.checklistAction(meta.orgId, meta.meetingId, msg.itemId, msg.action);
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
