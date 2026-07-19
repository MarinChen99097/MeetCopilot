/**
 * WP1 社群來源層：YouTube 缺 key 優雅 skip；帳號發現/正規化（discover）。
 */
import { describe, it, expect } from "vitest";
import { createYoutubeFetcher } from "./social/youtube.js";
import { discoverHandles, socialLinksJson, classifySocialUrl, parseSocialLinksColumn } from "./social/index.js";

describe("YouTube fetcher — missing key", () => {
  it("skips gracefully (returns [] + one warning) when YOUTUBE_API_KEY is empty", async () => {
    const yt = createYoutubeFetcher("");
    expect(yt.platform).toBe("youtube");
    const logs: string[] = [];
    const out = await yt.fetch(
      { companyName: "Acme", handles: {} },
      { signal: new AbortController().signal, budgetMs: 5000, log: (m) => logs.push(m) },
    );
    expect(out).toEqual({ sources: [], posts: [] });
    expect(logs.some((l) => l.includes("YOUTUBE_API_KEY not set"))).toBe(true);
  });
});

describe("social handle discovery", () => {
  it("classifies social URLs by platform", () => {
    expect(classifySocialUrl("https://www.youtube.com/@acme")).toBe("youtube");
    expect(classifySocialUrl("https://youtu.be/xyz")).toBe("youtube");
    expect(classifySocialUrl("https://www.facebook.com/acme")).toBe("facebook");
    expect(classifySocialUrl("https://instagram.com/acme")).toBe("instagram");
    expect(classifySocialUrl("https://www.threads.net/@acme")).toBe("threads");
    expect(classifySocialUrl("https://example.com/about")).toBeUndefined();
    expect(classifySocialUrl("not a url")).toBeUndefined();
  });

  it("merges candidate URLs into handles (first source wins per platform) and serializes to JSON", () => {
    const handles = discoverHandles(
      ["https://www.facebook.com/official"],
      ["https://www.facebook.com/other", "https://www.youtube.com/@acme", "https://www.threads.net/@acme"],
    );
    expect(handles.facebook).toBe("https://www.facebook.com/official"); // 先出現者勝
    expect(handles.youtube).toBe("https://www.youtube.com/@acme");
    expect(handles.threads).toBe("https://www.threads.net/@acme");

    const json = socialLinksJson(handles);
    expect(json).toBeDefined();
    const parsed = JSON.parse(json!) as Record<string, string>;
    expect(parsed.facebook).toBe("https://www.facebook.com/official");
    expect(parseSocialLinksColumn(json)).toContain("https://www.youtube.com/@acme");
  });

  it("returns undefined JSON when no social handles found", () => {
    expect(socialLinksJson({})).toBeUndefined();
    expect(discoverHandles(undefined, ["https://example.com"]).youtube).toBeUndefined();
    expect(parseSocialLinksColumn(null)).toEqual([]);
    expect(parseSocialLinksColumn("not json")).toEqual([]);
  });
});
