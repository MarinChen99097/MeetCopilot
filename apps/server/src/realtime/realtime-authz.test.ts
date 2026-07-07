/**
 * M3 authz + invariant tests (behavioral, not self-report):
 *  - wsToken round-trip; a normal app JWT can NOT be replayed as a wsToken (typ guard).
 *  - I2: PatchService.act with presenterAuth=false never touches the deck (attacker rejected).
 *  - reject/accept flows broadcast the correct HUD/present-targeted results (I3 targeting).
 */
import { describe, it, expect, vi } from "vitest";
import type { SlideSpec } from "@meetcopilot/shared";
import { mintWsToken, verifyWsToken } from "./ws-token.js";
import { issueToken } from "../auth/jwt.js";
import { LiveSessionRuntime } from "./session-runtime.js";
import { LivePatchService } from "./patch-service.js";
import type { BroadcastTarget } from "./types.js";
import type { ServerMessage } from "@meetcopilot/shared";
import type { AsrProvider } from "../asr/asr-provider.js";
import type { AnalysisEngine } from "../analysis/analysis-engine.js";

const SECRET = "test-secret-value-not-a-placeholder-1234567890";

const slide: SlideSpec = { id: "s1", template: "content", blocks: [], source: "ai" };

function fakeAsr(): AsrProvider {
  return { pushAudio: () => {}, onFinal: () => {} };
}
function fakeEngine(): AnalysisEngine {
  return { ingest: () => {}, onSignals: () => {} };
}

function makeRuntime(deckId?: string): LiveSessionRuntime {
  return new LiveSessionRuntime({
    meetingId: "m1",
    orgId: "org1",
    presenterUserId: "presenter",
    deckId,
    initialCommittedIndex: -1,
    researchQuota: 5,
    asr: fakeAsr(),
    engine: fakeEngine(),
    rolesProvider: () => [],
    onSuggestionExpire: () => {},
  });
}

describe("wsToken", () => {
  it("round-trips claims", () => {
    const t = mintWsToken(SECRET, { meetingId: "m1", orgId: "org1", userId: "u1", presenterUserId: "u1" });
    const claims = verifyWsToken(SECRET, t);
    expect(claims).toEqual({ meetingId: "m1", orgId: "org1", userId: "u1", presenterUserId: "u1" });
  });

  it("rejects a normal app JWT replayed as a wsToken (typ guard)", () => {
    const appJwt = issueToken(SECRET, { userId: "u1", orgId: "org1", role: "owner" });
    expect(() => verifyWsToken(SECRET, appJwt)).toThrow();
  });

  it("rejects a token signed with a different secret", () => {
    const t = mintWsToken("other-secret-000000000000000000000000", {
      meetingId: "m1",
      orgId: "org1",
      userId: "u1",
      presenterUserId: "u1",
    });
    expect(() => verifyWsToken(SECRET, t)).toThrow();
  });
});

describe("PatchService I2 (presenter-only append)", () => {
  it("does NOT append when presenterAuth is false (attacker rejected)", () => {
    const runtime = makeRuntime("deck1");
    const appendSlide = vi.fn(async () => ({ idx: 0 }));
    const sent: { msg: ServerMessage; target: BroadcastTarget }[] = [];
    const patch = new LivePatchService({
      getRuntime: () => runtime,
      sink: { broadcast: (_m, msg, target) => sent.push({ msg, target }) },
      appendSlide,
    });
    const s = patch.suggest("m1", slide, "reason");
    patch.act("m1", s.id, "accept", false); // attacker: presenterAuth=false
    expect(appendSlide).not.toHaveBeenCalled();
    // suggestion stays open (still 'suggested'); no applied/discarded result emitted for the attacker action.
    expect(sent.filter((x) => x.msg.type === "suggestion_result")).toHaveLength(0);
  });

  it("appends on presenter accept and targets present (deck_update) + hud (result)", async () => {
    const runtime = makeRuntime("deck1");
    const appendSlide = vi.fn(async () => ({ idx: 0 }));
    const sent: { msg: ServerMessage; target: BroadcastTarget }[] = [];
    const patch = new LivePatchService({
      getRuntime: () => runtime,
      sink: { broadcast: (_m, msg, target) => sent.push({ msg, target }) },
      appendSlide,
    });
    const s = patch.suggest("m1", slide, "reason");
    patch.act("m1", s.id, "accept", true);
    await new Promise((r) => setTimeout(r, 0)); // let the append microtask settle
    expect(appendSlide).toHaveBeenCalledOnce();
    const deckUpdate = sent.find((x) => x.msg.type === "deck_update");
    const result = sent.find((x) => x.msg.type === "suggestion_result");
    expect(deckUpdate?.target).toBe("present"); // I3: deck_update → present only
    expect(result?.target).toBe("hud"); // I3: suggestion_result → hud only
    expect(result?.msg).toMatchObject({ status: "applied", newSlideIndex: 0 });
  });

  it("reject discards and reports to hud", () => {
    const runtime = makeRuntime("deck1");
    const sent: { msg: ServerMessage; target: BroadcastTarget }[] = [];
    const patch = new LivePatchService({
      getRuntime: () => runtime,
      sink: { broadcast: (_m, msg, target) => sent.push({ msg, target }) },
      appendSlide: async () => ({ idx: 0 }),
    });
    const s = patch.suggest("m1", slide, "reason");
    patch.act("m1", s.id, "reject", true);
    const result = sent.find((x) => x.msg.type === "suggestion_result");
    expect(result?.target).toBe("hud");
    expect(result?.msg).toMatchObject({ status: "discarded" });
  });
});
