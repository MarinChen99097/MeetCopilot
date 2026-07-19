/**
 * photo-cse：Google CSE 圖片搜尋回應解析（pickCseImage）＋未設定憑證優雅 skip（searchPersonPhotoCse）。
 * pickCseImage 為純函式（不打網路）；searchPersonPhotoCse 僅測「未設定→不打 API」路徑（避免真連外）。
 */
import { describe, it, expect } from "vitest";
import { pickCseImage, searchPersonPhotoCse } from "./photo-cse.js";

describe("pickCseImage", () => {
  it("取第一張過守衛的圖（原圖 link + contextLink）；跳過前面的佔位圖", () => {
    const resp = {
      items: [
        { link: "https://site.com/img/placeholder.png", image: { contextLink: "https://site.com/a" } },
        { link: "https://site.com/people/chen.jpg", image: { contextLink: "https://site.com/team" } },
      ],
    };
    expect(pickCseImage(resp)).toEqual({
      link: "https://site.com/people/chen.jpg",
      contextLink: "https://site.com/team",
    });
  });

  it("contextLink 缺 → 只回 link", () => {
    const resp = { items: [{ link: "https://site.com/people/li.jpg" }] };
    expect(pickCseImage(resp)).toEqual({ link: "https://site.com/people/li.jpg" });
  });

  it("守衛過濾：svg/ico/追蹤像素/佔位圖/非 http(s) 全數不合格 → undefined", () => {
    const resp = {
      items: [
        { link: "https://x.com/logo.svg" },
        { link: "https://x.com/1x1.gif" },
        { link: "https://x.com/img/no-image.png" },
        { link: "data:image/png;base64,AAAA" },
      ],
    };
    expect(pickCseImage(resp)).toBeUndefined();
  });

  it("只掃前 4 筆：第 5 筆才是合格圖 → undefined", () => {
    const bad = { link: "https://x.com/img/placeholder.png" };
    const resp = { items: [bad, bad, bad, bad, { link: "https://x.com/people/real.jpg" }] };
    expect(pickCseImage(resp)).toBeUndefined();
  });

  it("無 items / 壞形狀 → undefined", () => {
    expect(pickCseImage({})).toBeUndefined();
    expect(pickCseImage({ items: "nope" })).toBeUndefined();
    expect(pickCseImage(undefined)).toBeUndefined();
    expect(pickCseImage(null)).toBeUndefined();
  });
});

describe("searchPersonPhotoCse — 未設定憑證優雅 skip（不打 API）", () => {
  it("cfg 未提供 → undefined", async () => {
    expect(await searchPersonPhotoCse(undefined, "陳明宏", "Acme")).toBeUndefined();
  });
  it("apiKey / cx 任一空 → undefined", async () => {
    expect(await searchPersonPhotoCse({ apiKey: "", cx: "cx1" }, "陳明宏", "Acme")).toBeUndefined();
    expect(await searchPersonPhotoCse({ apiKey: "k1", cx: "" }, "陳明宏", "Acme")).toBeUndefined();
  });
});
