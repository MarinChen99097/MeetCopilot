/**
 * S1：筆記來源後綴降級（noteSourceSuffix，純函式化的 writeSingletonNotes/writeCompetitorsNote 來源渲染）。
 * 真實出處 → markdown 連結；grounding-redirect（vertexaisearch / googleusercontent / grounding-api-redirect）→
 * 純文字「（來源待解析）」不掛連結（避免中介 redirect 洩漏成可點假來源）；無 URL → 空字串。
 */
import { describe, it, expect } from "vitest";
import { noteSourceSuffix } from "./orchestrator.js";

describe("noteSourceSuffix — S1 redirect leak downgrade", () => {
  it("renders a markdown link for a real (resolved) source URL", () => {
    expect(noteSourceSuffix("https://news.example/award")).toBe("（[來源](https://news.example/award)）");
  });

  it("downgrades grounding-redirect URLs to plain text (no markdown link)", () => {
    const redirects = [
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abcdef",
      "https://abc123.googleusercontent.com/x",
      "https://example.com/grounding-api-redirect/zzz",
    ];
    for (const u of redirects) {
      expect(noteSourceSuffix(u)).toBe("（來源待解析）");
      expect(noteSourceSuffix(u)).not.toContain("["); // 未掛 markdown 連結
      expect(noteSourceSuffix(u)).not.toContain(u); // 未洩漏 redirect URL
    }
  });

  it("returns empty string when there is no source URL", () => {
    expect(noteSourceSuffix(undefined)).toBe("");
    expect(noteSourceSuffix("")).toBe("");
    expect(noteSourceSuffix("   ")).toBe("");
  });
});
