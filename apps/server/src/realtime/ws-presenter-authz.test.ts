/**
 * WS-layer presenter authorization (I2), exercised END-TO-END through attachRealtimeWs — not the unit-level
 * PatchService (realtime-authz.test.ts already covers that). These tests catch the "I2 role-slice" gap that the
 * unit tests missed: `suggestion_action`/`page_commit` are gated by `meta.isPresenter`, which is now a PURE
 * identity check (userId === presenterUserId). `role` is only a self-chosen push-target query param, so the
 * presenter must be able to approve from the `hud` connection (the cockpit's single-window flow), while ANY
 * non-presenter token is rejected under EVERY role.
 *
 * Harness: a fake hub records whether the presenter-only action reached it (patch.act / broadcastState), plus a
 * fake core whose account gate always passes — so the ONLY variable under test is the presenter identity gate.
 */
import { describe, it, expect, vi } from "vitest";
import { WebSocket } from "ws";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WS_PATH } from "@meetcopilot/shared";
import type { CrmCore } from "@meetcopilot/crm";
import { attachRealtimeWs } from "./ws-server.js";
import { mintWsToken } from "./ws-token.js";
import { TEST_JWT_SECRET as SECRET, passingHandshakeRow } from "./test-support.js";
import type { RealtimeHub } from "./hub.js";

// Handshake gate always passes (org & user active, meeting still live) — isolates the presenter-identity gate as
// the sole variable. The row shape lives in test-support.ts (`passingHandshakeRow`), typed against the gate's own
// `WsHandshakeRow`: when the gate reads one more column, that helper stops compiling instead of silently closing
// every socket here at handshake with 1000 — which would leave these I2 tests green while asserting nothing.
const activeCore = {
  db: { get: async () => passingHandshakeRow() },
} as unknown as CrmCore;

// Tokens (all validly signed; only the identity relationship varies).
const presenterToken = mintWsToken(SECRET, { meetingId: "m1", orgId: "org1", userId: "pres", presenterUserId: "pres" });
const nonPresenterToken = mintWsToken(SECRET, { meetingId: "m1", orgId: "org1", userId: "attacker", presenterUserId: "pres" });
const crossOrgToken = mintWsToken(SECRET, { meetingId: "m1", orgId: "org2", userId: "outsider", presenterUserId: "pres" });
const crossMeetingToken = mintWsToken(SECRET, { meetingId: "other", orgId: "org1", userId: "pres", presenterUserId: "pres" });

function makeFakeHub() {
  const patchAct = vi.fn();
  const broadcastState = vi.fn();
  const setDeckCommitted = vi.fn();
  // committedIndex=-1 so page_commit index=0 advances (0 > -1) and exercises the write path.
  const runtime = { orgId: "org1", deckId: "deck1", committedIndex: -1, deckLength: 0 };
  const hub = {
    attach: vi.fn(),
    detach: vi.fn(),
    patch: { act: patchAct },
    getRuntime: vi.fn(() => runtime),
    broadcastState,
    setDeckCommitted,
    onPageCommitted: vi.fn(), // page_commit 路徑的勾稽副作用（no-op 替身；本檔只驗 I2 身分閘）
  } as unknown as RealtimeHub;
  return { hub, patchAct, broadcastState, setDeckCommitted };
}

async function startServer(hub: RealtimeHub, core: CrmCore) {
  const http = createServer();
  const wss = attachRealtimeWs(http, hub, SECRET, core);
  await new Promise<void>((r) => http.listen(0, () => r()));
  const port = (http.address() as AddressInfo).port;
  return {
    url: (token: string, meetingId: string, role: string) =>
      `ws://127.0.0.1:${port}${WS_PATH}?token=${token}&meetingId=${meetingId}&role=${role}`,
    close: async () => {
      wss.close();
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}

interface Exchanged {
  msgs: Array<{ type?: string; code?: string; message?: string }>;
  closeCode?: number;
}

/** Open a WS, optionally send one message once the account gate has attached the handler, collect replies. */
function exchange(url: string, send?: object): Promise<Exchanged> {
  return new Promise((resolve) => {
    const msgs: Exchanged["msgs"] = [];
    let closeCode: number | undefined;
    let settled = false;
    const ws = new WebSocket(url);
    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve({ msgs, closeCode });
    };
    ws.on("message", (d) => {
      try {
        msgs.push(JSON.parse(d.toString()));
      } catch {
        /* ignore */
      }
    });
    ws.on("close", (code) => {
      closeCode = code;
      finish();
    });
    ws.on("error", () => {
      /* rejection paths surface via close/message, not error */
    });
    ws.on("open", () => {
      // Small delay so the async account gate has resolved and attached the 'message' listener before we send.
      setTimeout(() => {
        if (send && ws.readyState === ws.OPEN) ws.send(JSON.stringify(send));
        setTimeout(finish, 60);
      }, 20);
    });
    setTimeout(finish, 800); // absolute safety net
  });
}

describe("WS presenter authz — I2 identity gate (role-agnostic)", () => {
  it("ACCEPTS suggestion_action from the presenter identity under role=hud AND role=present", async () => {
    for (const role of ["hud", "present"]) {
      const { hub, patchAct } = makeFakeHub();
      const srv = await startServer(hub, activeCore);
      try {
        const { msgs } = await exchange(srv.url(presenterToken, "m1", role), {
          type: "suggestion_action",
          suggestionId: "sug1",
          action: "accept",
        });
        expect(msgs.find((m) => m.code === "forbidden_not_presenter"), `role=${role}`).toBeUndefined();
        expect(patchAct, `role=${role}`).toHaveBeenCalledWith("m1", "sug1", "accept", true, undefined);
      } finally {
        await srv.close();
      }
    }
  });

  it("ACCEPTS page_commit from the presenter identity under role=hud (cockpit single-window flow)", async () => {
    const { hub, broadcastState, setDeckCommitted } = makeFakeHub();
    const srv = await startServer(hub, activeCore);
    try {
      const { msgs } = await exchange(srv.url(presenterToken, "m1", "hud"), { type: "page_commit", index: 0 });
      expect(msgs.find((m) => m.code === "forbidden_not_presenter")).toBeUndefined();
      expect(broadcastState).toHaveBeenCalledWith("m1");
      expect(setDeckCommitted).toHaveBeenCalledWith("org1", "deck1", 0);
    } finally {
      await srv.close();
    }
  });

  it("REJECTS suggestion_action from a non-presenter userId under EVERY role (attacker rejected)", async () => {
    for (const role of ["hud", "present", "capture"]) {
      const { hub, patchAct } = makeFakeHub();
      const srv = await startServer(hub, activeCore);
      try {
        const { msgs } = await exchange(srv.url(nonPresenterToken, "m1", role), {
          type: "suggestion_action",
          suggestionId: "s",
          action: "accept",
        });
        expect(
          msgs.find((m) => m.type === "error" && m.code === "forbidden_not_presenter"),
          `role=${role}`,
        ).toBeDefined();
        expect(patchAct, `role=${role}`).not.toHaveBeenCalled();
      } finally {
        await srv.close();
      }
    }
  });

  it("REJECTS page_commit from a non-presenter userId (role=present, the old escape hatch)", async () => {
    const { hub, broadcastState } = makeFakeHub();
    const srv = await startServer(hub, activeCore);
    try {
      const { msgs } = await exchange(srv.url(nonPresenterToken, "m1", "present"), { type: "page_commit", index: 0 });
      expect(msgs.find((m) => m.type === "error" && m.code === "forbidden_not_presenter")).toBeDefined();
      expect(broadcastState).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it("REJECTS a cross-org non-presenter token even under role=present", async () => {
    const { hub, patchAct } = makeFakeHub();
    const srv = await startServer(hub, activeCore);
    try {
      const { msgs } = await exchange(srv.url(crossOrgToken, "m1", "present"), {
        type: "suggestion_action",
        suggestionId: "s",
        action: "accept",
      });
      expect(msgs.find((m) => m.type === "error" && m.code === "forbidden_not_presenter")).toBeDefined();
      expect(patchAct).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it("REJECTS a cross-meeting token at the handshake (4001), never reaching the message gate", async () => {
    const { hub, patchAct } = makeFakeHub();
    const srv = await startServer(hub, activeCore);
    try {
      const { msgs, closeCode } = await exchange(srv.url(crossMeetingToken, "m1", "hud"), {
        type: "suggestion_action",
        suggestionId: "s",
        action: "accept",
      });
      expect(closeCode).toBe(4001);
      expect(msgs.find((m) => m.type === "error" && m.code === "unauthorized")).toBeDefined();
      expect(patchAct).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });
});
