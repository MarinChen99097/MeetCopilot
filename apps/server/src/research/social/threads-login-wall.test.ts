/**
 * threads.isLoginWallContent：Threads/IG 未登入攔截頁偵測（finalUrl→/login 或抽出「貼文」命中 ≥2 條登入頁 UI 標記）。
 */
import { describe, it, expect } from "vitest";
import { isLoginWallContent } from "./threads.js";

// E2E 實錄的 Threads 未登入攔截頁 UI 字串（Connact 案例，innerText fallback 逐行擷取後被誤當貼文）。
const E2E_LOGIN_WALL_LINES = [
  "Log in",
  "Sign up",
  "Continue with Instagram",
  "Log in with Instagram",
  "Forgot password?",
  "Scan to get the app",
  "See what people are sharing on Threads",
  "Terms of Use",
  "Privacy Policy",
];

describe("isLoginWallContent", () => {
  it("finalUrl 轉去 /login → 判死（即使無貼文）", () => {
    expect(isLoginWallContent("https://www.threads.net/login", [])).toBe(true);
    expect(isLoginWallContent("https://www.instagram.com/accounts/login/?next=x", [])).toBe(true);
    expect(isLoginWallContent("https://www.threads.net/login/?hl=en", ["just a post"])).toBe(true);
  });

  it("E2E 實錄 9 條登入頁 UI 字串（命中 ≥2 條）→ 判死", () => {
    expect(isLoginWallContent("https://www.threads.net/@connact", E2E_LOGIN_WALL_LINES)).toBe(true);
  });

  it("僅命中 1 條標記 → 不判死（避免誤傷真實貼文）", () => {
    // 只有 "Terms of Use" 一條命中，其餘皆真實貼文文字。
    const posts = [
      "本週新品上市，歡迎到門市體驗！",
      "感謝各位支持，我們達成十萬會員里程碑。",
      "See our Terms of Use for the giveaway rules.",
    ];
    expect(isLoginWallContent("https://www.threads.net/@brand", posts)).toBe(false);
  });

  it("真實貼文（無登入標記）→ 不判死", () => {
    const posts = [
      "新春優惠開跑，全館 8 折。",
      "我們的永續報告書已上線，歡迎下載。",
      "團隊招募中，誠徵前端工程師。",
    ];
    expect(isLoginWallContent("https://www.threads.net/@brand", posts)).toBe(false);
  });

  it("無 finalUrl 且無貼文 → false", () => {
    expect(isLoginWallContent(undefined, [])).toBe(false);
  });

  it("finalUrl 非合法 URL 仍走字串比對（含 /login）", () => {
    expect(isLoginWallContent("not-a-url/accounts/login", [])).toBe(true);
  });
});
