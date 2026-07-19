/**
 * photo-hunt.findPersonPhotoInHtml：alt/og:image 含人名 token 的照片解析（絕對 http(s)＋副檔名/追蹤像素過濾）。
 */
import { describe, it, expect } from "vitest";
import { findPersonPhotoInHtml } from "./photo-hunt.js";

describe("findPersonPhotoInHtml", () => {
  it("取 alt 含人名 token 的 <img> src（跳過不相關圖）", () => {
    const html =
      '<img src="/img/track.gif" alt="logo">' +
      '<img src="https://cdn.example.com/people/jane.jpg" alt="Jane Doe, CEO">';
    expect(findPersonPhotoInHtml(html, { fullName: "Jane Doe", pageUrl: "https://example.com/team" })).toBe(
      "https://cdn.example.com/people/jane.jpg",
    );
  });

  it("相對 src 以 pageUrl 絕對化；CJK 姓名整串比對", () => {
    const html = '<img alt="陳明宏 執行長" src="/photos/chen.png">';
    expect(findPersonPhotoInHtml(html, { fullNameZh: "陳明宏", pageUrl: "https://acme.com/about/" })).toBe(
      "https://acme.com/photos/chen.png",
    );
  });

  it("og:image 僅在 <title> 含人名時才收", () => {
    const withName =
      "<head><title>Jane Doe — Acme</title>" +
      '<meta property="og:image" content="https://acme.com/og/jane.jpg"></head>' +
      '<img src="https://x.com/other.jpg" alt="unrelated">';
    expect(findPersonPhotoInHtml(withName, { fullName: "Jane Doe", pageUrl: "https://acme.com" })).toBe(
      "https://acme.com/og/jane.jpg",
    );

    const noName =
      "<title>Team — Acme</title>" + '<meta property="og:image" content="https://acme.com/og/generic.jpg">';
    expect(findPersonPhotoInHtml(noName, { fullName: "Jane Doe", pageUrl: "https://acme.com" })).toBeUndefined();
  });

  it("過濾 svg/ico/追蹤像素/非 http(s)", () => {
    const html =
      '<img alt="Jane Doe" src="https://x.com/j.svg">' +
      '<img alt="Jane Doe" src="https://x.com/1x1.gif">' +
      '<img alt="Jane Doe" src="data:image/png;base64,AAAA">';
    expect(findPersonPhotoInHtml(html, { fullName: "Jane Doe", pageUrl: "https://x.com" })).toBeUndefined();
  });

  it("無姓名 token → undefined（嚴禁捏造）", () => {
    expect(
      findPersonPhotoInHtml('<img alt="team" src="https://x.com/a.jpg">', { pageUrl: "https://x.com" }),
    ).toBeUndefined();
  });

  it("拉丁 2 字母段（Li）不子字串誤中裝飾圖 alt，僅整名/詞界命中真照片", () => {
    // 'li' 是 reliable/application/click 的子字串——舊版會把第一張裝飾圖誤指派為頭像。
    const html =
      '<img src="https://cdn.example.com/ui/reliable-badge.png" alt="Reliable application, click here">' +
      '<img src="https://cdn.example.com/people/liwei.jpg" alt="Li Wei, VP Engineering">';
    expect(findPersonPhotoInHtml(html, { fullName: "Li Wei", pageUrl: "https://example.com/team" })).toBe(
      "https://cdn.example.com/people/liwei.jpg",
    );
  });

  it("純裝飾頁（僅含姓名子字串、無獨立詞）→ undefined（不誤指派）", () => {
    const html = '<img src="https://cdn.example.com/ui/hero.png" alt="reliable quality, click to apply">';
    expect(findPersonPhotoInHtml(html, { fullName: "Li", pageUrl: "https://example.com/x" })).toBeUndefined();
  });

  it("佔位/預設圖黑名單：FB 預設佔位圖不被當頭像（alt 與 og:image 兩路都擋）", () => {
    // 實測抓到的真實 FB 預設佔位圖（檔名含 FB_default → path 命中 default）。
    const fbDefault = "https://www.niea.org.tw/public/element/FB_default_image.jpg";
    // (1) alt 命中人名，但 src 是 FB 預設圖 → 不採用（無其他候選 → undefined）。
    expect(
      findPersonPhotoInHtml(`<img alt="程峻宏 理事長" src="${fbDefault}">`, {
        fullNameZh: "程峻宏",
        pageUrl: "https://www.niea.org.tw/about",
      }),
    ).toBeUndefined();
    // (2) og:image 是 FB 預設圖，即使 <title> 含人名也不採用。
    const og =
      "<title>程峻宏 — 理事長</title>" + `<meta property="og:image" content="${fbDefault}">`;
    expect(
      findPersonPhotoInHtml(og, { fullNameZh: "程峻宏", pageUrl: "https://www.niea.org.tw/about" }),
    ).toBeUndefined();
    // (3) 同頁另有真實照片時，跳過佔位圖、採真實照片。
    const withReal =
      `<img alt="程峻宏 理事長" src="${fbDefault}">` +
      '<img alt="程峻宏 理事長" src="https://www.niea.org.tw/uploads/cheng.jpg">';
    expect(
      findPersonPhotoInHtml(withReal, { fullNameZh: "程峻宏", pageUrl: "https://www.niea.org.tw/about" }),
    ).toBe("https://www.niea.org.tw/uploads/cheng.jpg");
  });

  it("data-alt/data-src 干擾屬性不被誤讀（attr 前綴詞界修復）：取真正的 alt/src", () => {
    // 舊版 \balt= 會誤中 data-alt、\bsrc= 會誤中 data-src → 抓到 decoy 錯照片。
    // 此 <img> 的 data-alt 帶不相關文字、data-src 指向 decoy；真正的 alt 含人名、真正的 src 才是頭像。
    const html =
      '<img data-alt="company banner" alt="Jane Doe, CEO" ' +
      'data-src="https://cdn.example.com/decoy/banner.jpg" src="https://cdn.example.com/people/jane.jpg">';
    expect(findPersonPhotoInHtml(html, { fullName: "Jane Doe", pageUrl: "https://example.com/team" })).toBe(
      "https://cdn.example.com/people/jane.jpg",
    );
  });

  it("僅有 data-src（無 src）時，attr(\"src\") 不誤中 data-src；fallback 取 data-src", () => {
    // alt 命中人名；本 <img> 只有 data-src（lazy-load）。attr('src') 應回 undefined（不誤配 data-src），
    // 由 `?? attr('data-src')` 顯式取到真正的 data-src。
    const html = '<img alt="Jane Doe" data-src="https://cdn.example.com/people/jane.jpg">';
    expect(findPersonPhotoInHtml(html, { fullName: "Jane Doe", pageUrl: "https://example.com/team" })).toBe(
      "https://cdn.example.com/people/jane.jpg",
    );
  });

  it("佔位/預設圖黑名單：placeholder/no-image/avatar-default/blank/dummy/spacer 皆擋", () => {
    for (const bad of [
      "https://x.com/img/placeholder.png",
      "https://x.com/img/no-image.jpg",
      "https://x.com/img/no_image.jpg",
      "https://x.com/img/noimage.png",
      "https://x.com/assets/avatar-default.png",
      "https://x.com/og-default.jpg",
      "https://x.com/blank.gif",
      "https://x.com/dummy.png",
      "https://x.com/fallback.jpg",
    ]) {
      expect(
        findPersonPhotoInHtml(`<img alt="Jane Doe" src="${bad}">`, {
          fullName: "Jane Doe",
          pageUrl: "https://x.com",
        }),
      ).toBeUndefined();
    }
  });
});
