/**
 * WP2 社群升級（S2/S3）純函式單測：
 *  - YouTube 無金鑰 fallback：ytInitialData 解析（新 lockupViewModel ＋舊 videoRenderer）、/videos URL 推導。
 *  - 觀看數／相對日期在地化字串解析（zh/en）。
 *  - Threads handle 推導（discoverHandles：threads 缺且 instagram 存在 → 推導 threads.net/@ig）。
 */
import { describe, it, expect } from "vitest";
import {
  extractYtInitialData,
  parseYtInitialData,
  parseViewCount,
  parseRelativeDate,
  youtubeVideosUrl,
} from "./social/youtube.js";
import { discoverHandles, instagramUsername } from "./social/index.js";
import { createDeepExtractor } from "./deep-extractor.js";
import type { DeepResearchBundle } from "./deep-research.js";
import type { GeminiClient } from "../gemini.js";

// ── 迷你 fixture：richGridRenderer.contents[] 內含新 lockupViewModel ＋舊 videoRenderer 各一 ──
function buildYtHtml(): string {
  const ytInitialData = {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                richGridRenderer: {
                  contents: [
                    {
                      richItemRenderer: {
                        content: {
                          lockupViewModel: {
                            contentId: "NEWvid00001",
                            metadata: {
                              lockupMetadataViewModel: {
                                title: { content: "新版影片標題" },
                                metadata: {
                                  contentMetadataViewModel: {
                                    metadataRows: [
                                      {
                                        metadataParts: [
                                          { text: { content: "觀看次數：2,859次" } },
                                          { text: { content: "2 天前" } },
                                        ],
                                      },
                                    ],
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                    {
                      richItemRenderer: {
                        content: {
                          videoRenderer: {
                            videoId: "OLDvid00002",
                            title: { runs: [{ text: "舊版影片標題" }] },
                            viewCountText: { simpleText: "1,234 views" },
                            publishedTimeText: { simpleText: "3 weeks ago" },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  };
  return `<!doctype html><html><head></head><body><script nonce="x">var ytInitialData = ${JSON.stringify(
    ytInitialData,
  )};</script></body></html>`;
}

describe("YouTube no-key parse — ytInitialData (lockupViewModel + legacy videoRenderer)", () => {
  it("extracts the ytInitialData JSON object from page HTML", () => {
    const data = extractYtInitialData(buildYtHtml());
    expect(data).toBeDefined();
    expect(typeof data).toBe("object");
  });

  it("returns undefined when no ytInitialData present / invalid JSON", () => {
    expect(extractYtInitialData("<html><body>no data here</body></html>")).toBeUndefined();
    expect(extractYtInitialData("var ytInitialData = {not:valid json;")).toBeUndefined();
    expect(extractYtInitialData("")).toBeUndefined();
  });

  it("parses both new lockupViewModel and legacy videoRenderer videos, in order", () => {
    const data = extractYtInitialData(buildYtHtml());
    const vids = parseYtInitialData(data, 15);
    expect(vids).toHaveLength(2);

    // 新版 lockupViewModel
    expect(vids[0]!.videoId).toBe("NEWvid00001");
    expect(vids[0]!.title).toBe("新版影片標題");
    expect(vids[0]!.viewsText).toBe("觀看次數：2,859次");
    expect(vids[0]!.publishedText).toBe("2 天前");

    // 舊版 videoRenderer
    expect(vids[1]!.videoId).toBe("OLDvid00002");
    expect(vids[1]!.title).toBe("舊版影片標題");
    expect(vids[1]!.viewsText).toBe("1,234 views");
    expect(vids[1]!.publishedText).toBe("3 weeks ago");
  });

  it("caps the number of videos to the given max", () => {
    const data = extractYtInitialData(buildYtHtml());
    expect(parseYtInitialData(data, 1)).toHaveLength(1);
  });

  it("tolerates non-object / empty input", () => {
    expect(parseYtInitialData(undefined)).toEqual([]);
    expect(parseYtInitialData(null)).toEqual([]);
    expect(parseYtInitialData({})).toEqual([]);
  });
});

describe("parseViewCount — localized view strings (zh/en)", () => {
  it("parses zh strings with 千分位 and 中文萬/億後綴", () => {
    expect(parseViewCount("觀看次數：2,859次")).toBe(2859);
    expect(parseViewCount("2,859 次觀看")).toBe(2859);
    expect(parseViewCount("1.2萬次觀看")).toBe(12000);
    expect(parseViewCount("3億次觀看")).toBe(300000000);
  });
  it("parses en strings with K/M/B suffixes", () => {
    expect(parseViewCount("2.8K views")).toBe(2800);
    expect(parseViewCount("1,234 views")).toBe(1234);
    expect(parseViewCount("3.4M views")).toBe(3400000);
    expect(parseViewCount("5B views")).toBe(5000000000);
  });
  it("returns undefined when no digits / invalid", () => {
    expect(parseViewCount("no views yet")).toBeUndefined();
    expect(parseViewCount(undefined)).toBeUndefined();
    expect(parseViewCount("")).toBeUndefined();
  });
});

describe("parseRelativeDate — relative time strings (zh/en)", () => {
  const NOW = 1_700_000_000_000;
  const DAY = 86_400_000;
  it("parses zh relative dates", () => {
    expect(parseRelativeDate("5 分鐘前", NOW)).toBe(NOW - 5 * 60_000);
    expect(parseRelativeDate("2 小時前", NOW)).toBe(NOW - 2 * 3_600_000);
    expect(parseRelativeDate("3 天前", NOW)).toBe(NOW - 3 * DAY);
    expect(parseRelativeDate("1 週前", NOW)).toBe(NOW - 7 * DAY);
    expect(parseRelativeDate("2 個月前", NOW)).toBe(NOW - 2 * 30 * DAY);
    expect(parseRelativeDate("1 年前", NOW)).toBe(NOW - 365 * DAY);
  });
  it("parses en relative dates", () => {
    expect(parseRelativeDate("5 minutes ago", NOW)).toBe(NOW - 5 * 60_000);
    expect(parseRelativeDate("2 hours ago", NOW)).toBe(NOW - 2 * 3_600_000);
    expect(parseRelativeDate("3 days ago", NOW)).toBe(NOW - 3 * DAY);
    expect(parseRelativeDate("3 weeks ago", NOW)).toBe(NOW - 3 * 7 * DAY);
    expect(parseRelativeDate("2 months ago", NOW)).toBe(NOW - 2 * 30 * DAY);
    expect(parseRelativeDate("1 year ago", NOW)).toBe(NOW - 365 * DAY);
  });
  it("returns null when unparseable", () => {
    expect(parseRelativeDate("streamed live", NOW)).toBeNull();
    expect(parseRelativeDate(undefined, NOW)).toBeNull();
    expect(parseRelativeDate("premieres tomorrow", NOW)).toBeNull();
  });
});

describe("youtubeVideosUrl — derive channel /videos URL", () => {
  it("derives from bare handle, channelId, and full channel URLs", () => {
    expect(youtubeVideosUrl("@acme")).toBe("https://www.youtube.com/@acme/videos");
    expect(youtubeVideosUrl("acme")).toBe("https://www.youtube.com/@acme/videos");
    expect(youtubeVideosUrl("https://www.youtube.com/channel/UCabcdef")).toBe(
      "https://www.youtube.com/channel/UCabcdef/videos",
    );
    expect(youtubeVideosUrl("https://www.youtube.com/@acme")).toBe("https://www.youtube.com/@acme/videos");
    expect(youtubeVideosUrl("https://www.youtube.com/c/AcmeCorp")).toBe("https://www.youtube.com/c/AcmeCorp/videos");
  });
  it("does not double-append /videos and returns undefined for empty", () => {
    expect(youtubeVideosUrl("https://www.youtube.com/@acme/videos")).toBe("https://www.youtube.com/@acme/videos");
    expect(youtubeVideosUrl(undefined)).toBeUndefined();
  });
});

describe("Threads handle derivation (S3) — discoverHandles", () => {
  it("derives threads from instagram username when threads missing", () => {
    const handles = discoverHandles(["https://www.instagram.com/acmecorp/"]);
    expect(handles.instagram).toBe("https://www.instagram.com/acmecorp");
    expect(handles.threads).toBe("https://www.threads.net/@acmecorp");
  });

  it("does NOT override an explicit threads handle", () => {
    const handles = discoverHandles([
      "https://www.instagram.com/acmecorp/",
      "https://www.threads.net/@official",
    ]);
    expect(handles.threads).toBe("https://www.threads.net/@official");
  });

  it("does not derive from instagram reserved paths (posts/reels)", () => {
    const handles = discoverHandles(["https://www.instagram.com/p/abcd1234/"]);
    expect(handles.threads).toBeUndefined();
  });

  it("instagramUsername extracts the username segment", () => {
    expect(instagramUsername("https://www.instagram.com/acme.corp/")).toBe("acme.corp");
    expect(instagramUsername("https://www.instagram.com/reel/xyz")).toBeUndefined();
    expect(instagramUsername("not a url")).toBeUndefined();
  });
});

// ── S4：deep-extractor socialSummaries 映射（platform 白名單、每平台至多一筆、sourceUrl 取真實 citation）──
function fakeGemini(extracted: Record<string, unknown>): GeminiClient {
  return {
    isConfigured: () => true,
    async generateJson<T>() {
      return extracted as unknown as T;
    },
    async generateJsonMetered<T>() {
      return { value: extracted as unknown as T, usage: { model: "fake" } };
    },
    async generateGrounded() {
      return { answer: "", citations: [] };
    },
    async embed() {
      return [];
    },
    async embedMetered() {
      return { value: [], usage: { model: "fake" } };
    },
  } as unknown as GeminiClient;
}

const oneSourceBundle: DeepResearchBundle = {
  groundedFindings: [],
  sourceTexts: [{ url: "https://news.example/social", title: "T", text: "source body text long enough" }],
  citationUrls: ["https://news.example/social"],
};

describe("deep-extractor toDeep — socialSummaries (S4)", () => {
  it("maps facebook/instagram summaries with the real citation URL", async () => {
    const extractor = createDeepExtractor(
      fakeGemini({
        company: {},
        socialSummaries: [
          { platform: "facebook", summaryZh: "臉書近期發布多則產品公告與活動花絮。", sourceIndex: 1 },
          { platform: "instagram", summaryZh: "IG 以短影音呈現團隊日常。", sourceIndex: 1 },
        ],
      }),
    );
    const out = await extractor.toDeep({ companyName: "Acme", bundle: oneSourceBundle });
    expect(out.socialSummaries).toHaveLength(2);
    expect(out.socialSummaries![0]).toEqual({
      platform: "facebook",
      summaryZh: "臉書近期發布多則產品公告與活動花絮。",
      sourceUrl: "https://news.example/social",
    });
    expect(out.socialSummaries![1]!.platform).toBe("instagram");
  });

  it("drops non-whitelisted platforms, empty summaries, and dedups per platform", async () => {
    const extractor = createDeepExtractor(
      fakeGemini({
        company: {},
        socialSummaries: [
          { platform: "facebook", summaryZh: "第一則臉書摘要。", sourceIndex: 1 },
          { platform: "facebook", summaryZh: "第二則臉書摘要（應被去重）。", sourceIndex: 1 },
          { platform: "linkedin", summaryZh: "非白名單平台。", sourceIndex: 1 }, // 丟
          { platform: "instagram", summaryZh: "   ", sourceIndex: 1 }, // 空 → 丟
        ],
      }),
    );
    const out = await extractor.toDeep({ companyName: "Acme", bundle: oneSourceBundle });
    expect(out.socialSummaries).toHaveLength(1);
    expect(out.socialSummaries![0]!.platform).toBe("facebook");
    expect(out.socialSummaries![0]!.summaryZh).toBe("第一則臉書摘要。");
  });

  it("returns [] when the model omits socialSummaries", async () => {
    const extractor = createDeepExtractor(fakeGemini({ company: {} }));
    const out = await extractor.toDeep({ companyName: "Acme", bundle: oneSourceBundle });
    expect(out.socialSummaries).toEqual([]);
  });
});
