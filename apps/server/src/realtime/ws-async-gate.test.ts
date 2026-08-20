/**
 * WS async account-gate regression (admin/suspension batch). Two independent failure modes introduced when the
 * whole connection setup was moved inside `isAccountActive(...).then(...)`:
 *
 *  1. hub.attach must REFUSE a socket that closed during the async check. Otherwise its 'close' (fired before
 *     attach) already ran as a no-op, no future close detaches it, and the ghost entry pins the room Set above 0
 *     forever → scheduleReclaim/dispose never fire → LiveSessionRuntime + Gemini ASR leak. (hub.ts guard)
 *  2. attachRealtimeWs must bind 'error'/'close' SYNCHRONOUSLY (before the await): an 'error' with no listener
 *     re-throws as an uncaught exception (index.ts has no uncaughtException handler) → whole-process crash; a
 *     'close' during the window must still detach. (ws-server.ts)
 */
import { describe, it, expect } from "vitest";
import { WebSocket, type WebSocket as ServerWs } from "ws";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WS_PATH } from "@meetcopilot/shared";
import { createCrmCore } from "@meetcopilot/crm";
import type { CrmCore } from "@meetcopilot/crm";
import { RealtimeHub } from "./hub.js";
import { attachRealtimeWs } from "./ws-server.js";
import { createGeminiClient } from "../gemini.js";
import { mintWsToken } from "./ws-token.js";
import {
  TEST_JWT_SECRET as SECRET,
  fakeSocket,
  passingHandshakeRow,
  testConfig,
  tick,
} from "./test-support.js";
import type { ConnMeta } from "./types.js";

describe("RealtimeHub.attach guards a closed socket (WS async-gate leak)", () => {
  it("does NOT enroll a socket that already closed; still enrolls an open one", async () => {
    const core: CrmCore = await createCrmCore(":memory:");
    const hub = new RealtimeHub(core, testConfig(), createGeminiClient(testConfig().gemini));
    try {
      await core.migrate();
      const org = await core.orgs.create({ name: "Org" });
      const meeting = await hub.store.create(org.id, { title: "M", presenterUserId: "pres" });
      hub.registerMeeting(meeting.id, { orgId: org.id, presenterUserId: "pres" });
      const meta: ConnMeta = { userId: "pres", orgId: org.id, meetingId: meeting.id, role: "hud", isPresenter: true };

      // A socket that closed during the pre-attach account check (readyState CLOSED).
      const dead = fakeSocket();
      dead.readyState = 3;
      hub.attach(dead as unknown as ServerWs, meta);
      await tick();
      expect(hub.rolesOf(meeting.id)).toEqual([]); // no ghost entry
      expect(hub.getRuntime(meeting.id)).toBeUndefined(); // guard bailed before materializing a runtime → no leak

      // Positive control: an OPEN socket IS enrolled and materializes the runtime.
      const live = fakeSocket();
      hub.attach(live as unknown as ServerWs, meta);
      await tick();
      expect(hub.rolesOf(meeting.id)).toEqual(["hud"]);
      expect(hub.getRuntime(meeting.id)).toBeDefined();
    } finally {
      hub.disposeAll(); // clear the live runtime's timers so nothing leaks between tests
      core.close();
    }
  });
});

describe("attachRealtimeWs binds error/close synchronously before the account check", () => {
  it("error during the check does not throw (crash fix); a close during it detaches + hands a dead socket to attach", async () => {
    // Fake hub: record what attach/detach receive (readyState at attach time, and that detach fired).
    const attachStates: number[] = [];
    const detached: unknown[] = [];
    const fakeHub = {
      attach: (ws: ServerWs) => attachStates.push(ws.readyState),
      detach: (ws: ServerWs) => detached.push(ws),
    } as unknown as RealtimeHub;

    // Slow fake core: checkWsHandshake awaits this gate, keeping the handshake check open until we release it.
    // The row must satisfy BOTH halves of the gate (account active + meeting live) — otherwise the .then()
    // rejects the socket and hub.attach is never reached, which would make this test vacuous. That is not a
    // hypothetical: this file shipped a `{status:"active"}` row earlier in this batch and did exactly that.
    // `passingHandshakeRow()` is the single owner of the shape (typed against the gate's own row type).
    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => {
      releaseGate = r;
    });
    const slowCore = {
      db: {
        get: async () => {
          await gate;
          return passingHandshakeRow();
        },
      },
    } as unknown as CrmCore;

    const http = createServer();
    const wss = attachRealtimeWs(http, fakeHub, SECRET, slowCore);
    await new Promise<void>((r) => http.listen(0, () => r()));
    const port = (http.address() as AddressInfo).port;

    // Capture the server-side socket (2nd connection listener; attachRealtimeWs's own handler ran first).
    let serverWs: ServerWs | undefined;
    let markServerClosed!: () => void;
    const serverClosed = new Promise<void>((r) => {
      markServerClosed = r;
    });
    wss.on("connection", (ws) => {
      serverWs = ws;
      ws.on("close", () => markServerClosed());
    });

    const token = mintWsToken(SECRET, { meetingId: "m1", orgId: "o1", userId: "u1", presenterUserId: "u1" });
    const client = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}?token=${token}&meetingId=m1&role=hud`);
    await new Promise<void>((r) => client.on("open", () => r()));
    await tick(); // absorb any connection/open ordering jitter so serverWs is set

    // Gate still pending (account check in-flight). Emitting 'error' now must NOT throw — proving the synchronous
    // 'error' listener is present. Without it ws@8 re-throws → uncaught exception → process crash.
    expect(serverWs).toBeDefined();
    expect(() => serverWs!.emit("error", new Error("boom"))).not.toThrow();

    // Close from the client DURING the window; wait until the server observes the close (leaves OPEN).
    client.close();
    await serverClosed;

    // Let the account check resolve → the .then runs hub.attach with the now-closed socket.
    releaseGate();
    await tick(20);

    // The synchronous 'close' listener fired during the window → hub.detach was invoked (no ghost left behind).
    expect(detached.length).toBeGreaterThanOrEqual(1);
    // hub.attach received a non-OPEN socket (readyState !== 1) — exactly what the real hub guard (test above)
    // rejects. If attach ran at all here, it was handed a dead socket, never an open one.
    expect(attachStates.every((s) => s !== 1)).toBe(true);

    client.terminate();
    wss.close();
    await new Promise<void>((r) => http.close(() => r()));
  });
});
