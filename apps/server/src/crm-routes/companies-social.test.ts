/**
 * GET /companies/:id/social 的 URL 白名單（XSS 縱深，契約三）：buildSocialLinks / sanitizeSocialPosts 純函式測。
 * javascript:/data:/vbscript:/相對路徑值一律過濾（links 不收、posts.url 剝除），合法絕對 http(s) 照常保留。
 */
import { describe, it, expect } from "vitest";
import type { SocialPost } from "@meetcopilot/shared";
import { buildSocialLinks, sanitizeSocialPosts } from "./companies.js";

describe("buildSocialLinks — 帳號連結 scheme 白名單", () => {
  it("只收絕對 http(s)；javascript:/data:/相對路徑一律略過", () => {
    const links = buildSocialLinks({
      socialLinks: {
        // eslint-disable-next-line no-script-url
        instagram: "javascript:alert(1)",
        threads: "data:text/html,<script>alert(1)</script>",
        weibo: "/relative/path",
        tiktok: "https://www.tiktok.com/@acme",
      },
      socialLinkedin: "https://linkedin.com/company/acme",
      // eslint-disable-next-line no-script-url
      socialTwitter: "javascript:void(0)",
      socialFacebook: "  https://facebook.com/acme  ", // 前後空白 → trim 後合法
      socialYoutube: "vbscript:msgbox(1)",
      socialGithub: "not a url",
    });
    // 合法者保留。
    expect(links.tiktok).toBe("https://www.tiktok.com/@acme");
    expect(links.linkedin).toBe("https://linkedin.com/company/acme");
    expect(links.facebook).toBe("https://facebook.com/acme");
    // 非法 scheme / 相對 / 非 URL 一律不進 links。
    expect(links.instagram).toBeUndefined();
    expect(links.threads).toBeUndefined();
    expect(links.weibo).toBeUndefined();
    expect(links.twitter).toBeUndefined();
    expect(links.youtube).toBeUndefined();
    expect(links.github).toBeUndefined();
  });

  it("curated 單欄勝：social_* 覆蓋同鍵的 social_links JSON 值", () => {
    const links = buildSocialLinks({
      socialLinks: { linkedin: "https://old.example.com/li" },
      socialLinkedin: "https://linkedin.com/company/new",
    });
    expect(links.linkedin).toBe("https://linkedin.com/company/new");
  });

  it("空/缺欄 → 空物件", () => {
    expect(buildSocialLinks({})).toEqual({});
    expect(buildSocialLinks({ socialLinks: null })).toEqual({});
  });
});

describe("sanitizeSocialPosts — 貼文 url scheme 白名單", () => {
  function post(url: string | undefined): SocialPost {
    return { id: "p1", orgId: "o", companyId: "c", url, title: "t", createdAt: 1 };
  }

  it("非絕對 http(s) 的 url → 剝除為 undefined，其餘欄不動", () => {
    const out = sanitizeSocialPosts([
      // eslint-disable-next-line no-script-url
      post("javascript:alert(document.cookie)"),
      post("data:text/html,x"),
      post("/relative"),
      post("https://youtube.com/watch?v=abc"),
    ]);
    expect(out[0]!.url).toBeUndefined();
    expect(out[0]!.title).toBe("t"); // 其餘欄保留
    expect(out[1]!.url).toBeUndefined();
    expect(out[2]!.url).toBeUndefined();
    expect(out[3]!.url).toBe("https://youtube.com/watch?v=abc"); // 合法保留
  });

  it("url 缺省（undefined）→ 保持 undefined", () => {
    const out = sanitizeSocialPosts([post(undefined)]);
    expect(out[0]!.url).toBeUndefined();
  });
});
