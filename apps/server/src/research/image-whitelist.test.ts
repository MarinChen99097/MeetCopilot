/**
 * 圖片白名單驗證（防幻覺，契約三）：擷取器把模型回傳的 products[].imageUrls / people[].photoUrl
 * 過「確實爬到的圖片清單」白名單——清單裡沒有的（模型憑空捏造）一律濾掉。
 * 另驗 crawler.sanitizeCrawledImages/sanitizeOgImage 的頁內圖片過濾（http(s)、去 svg/ico、去追蹤像素、cap）。
 */
import { describe, it, expect } from "vitest";
import { filterToImageWhitelist, validatePhotoUrl } from "./extract-shared.js";
import { sanitizeCrawledImages, sanitizeOgImage } from "./crawler.js";

describe("image whitelist validation (anti-hallucination)", () => {
  const whitelist = new Set<string>(["https://x.com/a.jpg", "https://x.com/b.png"]);

  it("keeps only URLs present in the crawled whitelist (drops hallucinated)", () => {
    const out = filterToImageWhitelist(
      ["https://x.com/a.jpg", "https://evil.com/hallucinated.jpg", "https://x.com/b.png"],
      whitelist,
    );
    expect(out).toEqual(["https://x.com/a.jpg", "https://x.com/b.png"]);
  });

  it("drops a fully hallucinated list to empty", () => {
    expect(filterToImageWhitelist(["https://nope.com/x.jpg", "https://also.com/y.png"], whitelist)).toEqual([]);
  });

  it("dedups, trims, ignores non-strings and non-arrays", () => {
    expect(
      filterToImageWhitelist(["https://x.com/a.jpg", " https://x.com/a.jpg ", 5 as unknown as string, null], whitelist),
    ).toEqual(["https://x.com/a.jpg"]);
    expect(filterToImageWhitelist("not-an-array" as unknown, whitelist)).toEqual([]);
    expect(filterToImageWhitelist(undefined, whitelist)).toEqual([]);
  });

  it("validatePhotoUrl returns url only when whitelisted", () => {
    expect(validatePhotoUrl("https://x.com/a.jpg", whitelist)).toBe("https://x.com/a.jpg");
    expect(validatePhotoUrl("https://evil.com/face.jpg", whitelist)).toBeUndefined();
    expect(validatePhotoUrl(123 as unknown, whitelist)).toBeUndefined();
    expect(validatePhotoUrl("", whitelist)).toBeUndefined();
  });
});

describe("crawler image sanitize (contract §4 filtering)", () => {
  it("keeps absolute http(s) imgs, drops data:/svg/ico and tracking pixels, dedups, caps", () => {
    const raw = [
      { src: "https://x.com/a.jpg", alt: "  hero  photo ", w: 800, h: 600 },
      { src: "https://x.com/a.jpg", alt: "dup", w: 800, h: 600 }, // dup src
      { src: "data:image/png;base64,AAAA", alt: "data uri", w: 10, h: 10 }, // data: excluded
      { src: "https://x.com/logo.svg", alt: "svg", w: 100, h: 100 }, // svg excluded
      { src: "https://x.com/favicon.ico", alt: "ico", w: 16, h: 16 }, // ico excluded
      { src: "https://track.com/px.gif?id=1", alt: "", w: 1, h: 1 }, // 1x1 tracking pixel excluded (gif ext not filtered per contract §4)
      { src: "https://x.com/pixel.png", alt: "", w: 1, h: 1 }, // 1x1 tracking pixel excluded
      { src: "/relative.png", alt: "relative", w: 300, h: 300 }, // relative (not absolute) excluded
      { src: "https://x.com/b.png", alt: "second", w: 400, h: 300 },
    ];
    const out = sanitizeCrawledImages(raw, 15);
    expect(out.map((i) => i.src)).toEqual(["https://x.com/a.jpg", "https://x.com/b.png"]);
    expect(out[0]?.alt).toBe("hero photo"); // collapsed whitespace + trimmed
  });

  it("respects the per-page cap", () => {
    const raw = Array.from({ length: 20 }, (_, i) => ({ src: `https://x.com/${i}.jpg`, alt: "", w: 100, h: 100 }));
    expect(sanitizeCrawledImages(raw, 15)).toHaveLength(15);
  });

  it("sanitizeOgImage only accepts absolute http(s)", () => {
    expect(sanitizeOgImage("https://x.com/og.jpg")).toBe("https://x.com/og.jpg");
    expect(sanitizeOgImage("/og.jpg")).toBeNull();
    expect(sanitizeOgImage("data:image/png;base64,AAAA")).toBeNull();
    expect(sanitizeOgImage(null)).toBeNull();
  });
});
