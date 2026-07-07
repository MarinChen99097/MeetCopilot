/**
 * M5 §A privacy tests (behavioral, not self-report):
 *  - Consent gate: a finalized segment BEFORE consent is fully dropped (no HUD, no persist, no LLM egress);
 *    the same segment AFTER consent flows to the HUD + analysis + context.
 *  - Ephemeral-by-default: persistTranscript=false → nothing to persist; =true → a redacted segment persists.
 *  - PII redaction: email / phone / credit-card patterns are masked on every non-HUD egress (analysis, DB,
 *    context), while the presenter's private HUD keeps the raw text.
 */
import { describe, it, expect } from "vitest";
import { redactPii, type TranscriptSegment } from "@meetcopilot/shared";
import { routeTranscriptSegment } from "./transcript-privacy.js";

const RAW =
  "客戶 email 是 john.doe@acme.com，手機 0912345678，卡號 4111 1111 1111 1111，很高興認識你";

function seg(text: string): TranscriptSegment {
  return { id: "seg1", t: 1000, speaker: "client", text, final: true };
}

describe("routeTranscriptSegment — consent gate (M5 §A)", () => {
  it("drops everything before consent (no analysis, no persist, no HUD)", () => {
    const r = routeTranscriptSegment({ consent: false, persistTranscript: true, segment: seg(RAW) });
    expect(r.hud).toBeNull();
    expect(r.persist).toBeNull();
    expect(r.analysisText).toBeNull();
    expect(r.contextSegment).toBeNull();
  });

  it("after consent, the segment flows to HUD + analysis + context", () => {
    const r = routeTranscriptSegment({ consent: true, persistTranscript: false, segment: seg(RAW) });
    expect(r.hud).not.toBeNull();
    expect(r.analysisText).not.toBeNull();
    expect(r.contextSegment).not.toBeNull();
  });
});

describe("routeTranscriptSegment — ephemeral-by-default (M5 §A)", () => {
  it("does NOT persist when persistTranscript=false", () => {
    const r = routeTranscriptSegment({ consent: true, persistTranscript: false, segment: seg(RAW) });
    expect(r.persist).toBeNull();
  });

  it("persists a REDACTED segment when persistTranscript=true", () => {
    const r = routeTranscriptSegment({ consent: true, persistTranscript: true, segment: seg(RAW) });
    expect(r.persist).not.toBeNull();
    expect(r.persist!.text).not.toContain("john.doe@acme.com");
    expect(r.persist!.text).not.toContain("4111");
  });
});

describe("routeTranscriptSegment — PII redaction on egress (M5 §A)", () => {
  it("masks PII on analysis + context + persist, keeps raw on HUD only", () => {
    const r = routeTranscriptSegment({ consent: true, persistTranscript: true, segment: seg(RAW) });
    // HUD = presenter's private aid → raw preserved.
    expect(r.hud!.text).toContain("john.doe@acme.com");
    // Every other egress → redacted (no email / card / long phone digits).
    for (const text of [r.analysisText!, r.contextSegment!.text, r.persist!.text]) {
      expect(text).not.toContain("john.doe@acme.com");
      expect(text).not.toContain("4111 1111 1111 1111");
      expect(text).not.toContain("0912345678");
      expect(text).toContain("很高興認識你"); // non-PII text survives
    }
  });
});

describe("redactPii — email / phone / credit-card (M5 §A)", () => {
  it("masks an email address", () => {
    expect(redactPii("寄到 jane.smith@example.co.uk 謝謝")).toBe("寄到 *** 謝謝");
  });

  it("masks a credit-card number (grouped and continuous)", () => {
    expect(redactPii("卡 4111 1111 1111 1111")).toBe("卡 ***");
    expect(redactPii("卡 4111111111111111")).toBe("卡 ***");
  });

  it("masks an 8+ digit phone / long number sequence", () => {
    expect(redactPii("手機 0912345678")).toBe("手機 ***");
  });

  it("leaves short numbers and plain text untouched", () => {
    expect(redactPii("第 3 頁，共 12 頁")).toBe("第 3 頁，共 12 頁");
  });

  it("returns falsy input unchanged", () => {
    expect(redactPii("")).toBe("");
  });
});
