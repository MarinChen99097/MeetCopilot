/**
 * F1 regression — cross-tenant meeting teardown (endMeeting authz).
 *
 * The rooms/sessions maps are keyed by meetingId only; ownership is proven SOLELY by the org-scoped
 * store.end(orgId, meetingId). Before the fix, disposeSession + the socket-close loop ran unconditionally,
 * so an org-B caller passing org-A's meetingId would tear down org-A's live runtime and close its sockets
 * (then get a 404). This test asserts an attacker call returns false AND leaves org-A intact — and, as a
 * positive control, that the legitimate owner's endMeeting DOES tear the session down.
 */
import { describe, it, expect } from "vitest";
import type { WebSocket } from "ws";
import { createCrmCore } from "@meetcopilot/crm";
import type { CrmCore } from "@meetcopilot/crm";
import { RealtimeHub } from "./hub.js";
import { createGeminiClient } from "../gemini.js";
import type { AppConfig } from "../config.js";
import type { ConnMeta } from "./types.js";

function testConfig(): AppConfig {
  return {
    port: 0,
    jwtSecret: "test-secret-value-not-a-placeholder-1234567890",
    dbPath: ":memory:",
    researchAutoLimitPerMeeting: 5,
    supplementAutoLimitPerMeeting: 8,
    googleClientId: "",
    platformAdminEmails: [],
    adminOrigin: "",
    gemini: { apiKey: "", textModel: "t", extractModel: "e", embedModel: "m", liveModel: "l" },
    openai: { apiKey: "", imageModel: "i", imageSize: "1x1", imageQuality: "low" },
  };
}

/** Minimal WebSocket stand-in exercising only what the hub touches (readyState / OPEN / send / close). */
function fakeSocket() {
  const s = {
    OPEN: 1 as const,
    readyState: 1,
    closed: false,
    closeCode: undefined as number | undefined,
    send(_data: unknown): void {
      /* swallow session_state frames */
    },
    close(code?: number): void {
      s.closed = true;
      s.closeCode = code;
      s.readyState = 3;
    },
  };
  return s;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("RealtimeHub.endMeeting cross-tenant authz (F1)", () => {
  it("an org-B caller cannot end/tear down org-A's live meeting", async () => {
    const core: CrmCore = await createCrmCore(":memory:");
    try {
      await core.migrate();
      const orgA = await core.orgs.create({ name: "Org A" });
      const orgB = await core.orgs.create({ name: "Org B" });
      const hub = new RealtimeHub(core, testConfig(), createGeminiClient(testConfig().gemini));

      // Org A creates a meeting and materializes a live runtime + a connected socket.
      const meeting = await hub.store.create(orgA.id, { title: "A's meeting", presenterUserId: "presA" });
      hub.registerMeeting(meeting.id, { orgId: orgA.id, presenterUserId: "presA" });
      const sock = fakeSocket();
      const meta: ConnMeta = {
        userId: "presA",
        orgId: orgA.id,
        meetingId: meeting.id,
        role: "hud",
        isPresenter: true,
      };
      hub.attach(sock as unknown as WebSocket, meta);
      await flush(); // let ensureRuntime + broadcastState settle

      expect(hub.getRuntime(meeting.id)).toBeDefined();

      // Attacker: org B calls endMeeting with org A's meetingId.
      const attackerResult = await hub.endMeeting(orgB.id, meeting.id);

      expect(attackerResult).toBe(false); // store.end matched no row in org B → false
      expect(hub.getRuntime(meeting.id)).toBeDefined(); // org A's runtime NOT disposed
      expect(sock.closed).toBe(false); // org A's socket NOT closed

      // Positive control: the legitimate owner CAN end it — runtime disposed, socket closed.
      const ownerResult = await hub.endMeeting(orgA.id, meeting.id);
      expect(ownerResult).toBe(true);
      expect(hub.getRuntime(meeting.id)).toBeUndefined();
      expect(sock.closed).toBe(true);
    } finally {
      core.close();
    }
  });
});
