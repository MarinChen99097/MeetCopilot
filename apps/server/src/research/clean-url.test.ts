/**
 * extract-shared.cleanUrl：清尾端污染後只接受絕對 http(s)，其餘 undefined（記債）。
 */
import { describe, it, expect } from "vitest";
import { cleanUrl } from "./extract-shared.js";

describe("cleanUrl — 只接受絕對 http(s)", () => {
  it("絕對 http(s) 原樣回（不加尾斜線）", () => {
    expect(cleanUrl("http://example.com/path")).toBe("http://example.com/path");
    expect(cleanUrl("https://x.com/a?b=1")).toBe("https://x.com/a?b=1");
    expect(cleanUrl("https://y.com")).toBe("https://y.com");
  });

  it("清尾端污染（逗號/引號/括號/空白）後仍為 http(s)", () => {
    expect(cleanUrl("https://ghost.org/,")).toBe("https://ghost.org/");
    expect(cleanUrl("  https://y.com  ")).toBe("https://y.com");
    expect(cleanUrl('https://z.com/a")')).toBe("https://z.com/a");
  });

  it("非 http(s)（mailto/data/javascript/ftp）→ undefined", () => {
    expect(cleanUrl("mailto:foo@bar.com")).toBeUndefined();
    expect(cleanUrl("data:image/png;base64,AAAA")).toBeUndefined();
    expect(cleanUrl("javascript:alert(1)")).toBeUndefined();
    expect(cleanUrl("ftp://x.com/f")).toBeUndefined();
  });

  it("相對/非法/非字串 → undefined", () => {
    expect(cleanUrl("/relative/path")).toBeUndefined();
    expect(cleanUrl("not a url")).toBeUndefined();
    expect(cleanUrl("")).toBeUndefined();
    expect(cleanUrl(undefined)).toBeUndefined();
    expect(cleanUrl(123)).toBeUndefined();
  });
});
