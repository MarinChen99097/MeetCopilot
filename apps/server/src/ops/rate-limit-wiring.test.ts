/**
 * 貴端點 rate-limit 的**接線**驗收（index.ts:131-158 那份 exact-path 名單）。
 *
 * 為什麼需要這一檔：`POST /api/meetings` 在 023 之後會於建會成功後背景觸發 `generateChecklist`
 * （12,000 字 outline 輸入、maxOutputTokens 4096、attempts 2、deadline 45s、MAX_TOKENS 還會再打一次）
 * → 它是本 repo **最貴的單次請求**，而原本的限流名單只列了便宜 10 倍的 `draft-objective`（且是 router 內
 * **另開一個** TokenBucketRateLimiter，導致同 org 額度兩桶相加、且被 429 的請求仍白 parse 2mb body）。
 *
 * 兩段驗收：
 *  A. 行為面——用真 express ＋真 TokenBucketRateLimiter 複刻 index.ts 的層序，證明
 *     (1) 兩條 meetings 端點都被限流、(2) 共用**同一個桶**（額度不加倍）、
 *     (3) 429 發生在 body parser **之前**、(4) exact-path 不誤傷 `/api/meetings/:id/...` 與 GET。
 *  B. 接線面——直接讀原始碼，鎖住「名單有這兩條、掛在 body parser 之前、整個 src 只有一個 limiter 實例」。
 */
import { describe, it, expect } from "vitest";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rateLimit, TokenBucketRateLimiter } from "./token-bucket.js";

const SRC_DIR = fileURLToPath(new URL("../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(new URL(rel, new URL("../", import.meta.url)), "utf8");

// ── A. 行為面 ────────────────────────────────────────────────────────────────

/** 複刻 index.ts 的層序：假 auth（填 req.auth.orgId）→ exact-path limiter → body parser → 路由。 */
async function buildApp(): Promise<{
  base: string;
  close: () => Promise<void>;
  /** 走到「body parser 位置」的請求路徑（被 429 的請求不會出現在這裡）。 */
  parsed: string[];
}> {
  const parsed: string[] = [];
  // org 桶 capacity 2、幾乎不補點；ip 桶放很寬，讓 org 成為唯一約束（測試可控）。
  const limit = rateLimit(new TokenBucketRateLimiter({ capacity: 2, refillPerSec: 0.0001 }, { capacity: 10_000, refillPerSec: 10_000 }));

  const app = express();
  // 站 index.ts 裡 jwtGuard 的位置：orgId 取自「已驗證身分」，測試用 header 模擬不同 org。
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { auth?: { orgId: string; userId: string; role: string } }).auth = {
      orgId: req.header("x-test-org") ?? "orgX",
      userId: "u",
      role: "owner",
    };
    next();
  });
  app.post("/api/meetings", limit);
  app.post("/api/meetings/draft-objective", limit);
  // 這個 marker 站在 index.ts 的 `app.use(express.json({limit:"2mb"}))` 位置：跑到＝body 真的被 parse。
  app.use((req: Request, _res: Response, next: NextFunction) => {
    parsed.push(req.path);
    next();
  });
  app.use(express.json({ limit: "2mb" }));
  app.post("/api/meetings", (_req, res) => void res.status(201).json({ created: true }));
  app.post("/api/meetings/draft-objective", (_req, res) => void res.json({ objective: "" }));
  app.post("/api/meetings/:id/end", (_req, res) => void res.json({ ended: true }));
  app.get("/api/meetings", (_req, res) => void res.json({ items: [] }));

  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    parsed,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("貴端點限流：POST /api/meetings 與 /api/meetings/draft-objective（修正 A 行為面）", () => {
  it("兩條端點都被限流、共用同一個桶（額度不加倍）、429 發生在 body parser 之前", async () => {
    const app = await buildApp();
    const post = (path: string, org: string) =>
      fetch(`${app.base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-org": org },
        body: JSON.stringify({ title: "x" }),
      });
    try {
      // (1) POST /api/meetings 真的被限流（capacity 2 → 第 3 次 429＋Retry-After）。
      expect((await post("/api/meetings", "orgA")).status).toBe(201);
      expect((await post("/api/meetings", "orgA")).status).toBe(201);
      const denied = await post("/api/meetings", "orgA");
      expect(denied.status).toBe(429);
      expect(Number(denied.headers.get("Retry-After"))).toBeGreaterThan(0);

      // (3) 被 429 的那次**沒有**走到 body parser 的位置（只有前 2 次成功的請求走到）。
      expect(app.parsed.filter((p) => p === "/api/meetings")).toHaveLength(2);

      // (2) 額度不加倍：同一個 org 的桶已空 → draft-objective 立刻 429（若各自一桶，這裡會是 200）。
      const objective = await post("/api/meetings/draft-objective", "orgA");
      expect(objective.status).toBe(429);
      expect(app.parsed.filter((p) => p === "/api/meetings/draft-objective")).toHaveLength(0);

      // draft-objective 自己也確實受保護（換一個乾淨的 org：2 次放行、第 3 次 429）。
      expect((await post("/api/meetings/draft-objective", "orgB")).status).toBe(200);
      expect((await post("/api/meetings/draft-objective", "orgB")).status).toBe(200);
      expect((await post("/api/meetings/draft-objective", "orgB")).status).toBe(429);
    } finally {
      await app.close();
    }
  });

  it("exact-path 語意：`/api/meetings` 不誤傷 `/api/meetings/:id/end`，GET 列表也不被限流", async () => {
    const app = await buildApp();
    const post = (path: string) =>
      fetch(`${app.base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-org": "orgC" },
        body: JSON.stringify({}),
      });
    try {
      // 先把 orgC 的桶抽乾（2 次 + 1 次 429）。
      await post("/api/meetings");
      await post("/api/meetings");
      expect((await post("/api/meetings")).status).toBe(429);

      // 子路徑不在名單上 → 仍然放行（契約明文：exact paths only）。
      expect((await post("/api/meetings/abc123/end")).status).toBe(200);
      expect((await post("/api/meetings/abc123/signals/s1/writeback")).status).toBe(404); // 有到 router、不是 429

      // GET 輪詢端點不受限（index.ts 註解：GET polling endpoints are left unlimited）。
      const list = await fetch(`${app.base}/api/meetings`, { headers: { "x-test-org": "orgC" } });
      expect(list.status).toBe(200);
    } finally {
      await app.close();
    }
  });
});

// ── B. 接線面（原始碼鎖定：這是「名單漏了就回不去」的回歸鎖）───────────────────

describe("限流接線鎖定（修正 A 接線面）", () => {
  const index = readSrc("index.ts");

  it("index.ts 的共用名單包含這兩條 exact path，且掛在 body parser 之前", () => {
    expect(index).toContain('app.post("/api/meetings", jwtGuard, limit);');
    expect(index).toContain('app.post("/api/meetings/draft-objective", jwtGuard, limit);');

    // 層序：limiter 名單 → express.json（超限請求不浪費 parse）。
    const parserAt = index.indexOf('app.use(express.json({ limit: "2mb" }))');
    expect(parserAt).toBeGreaterThan(0);
    expect(index.indexOf('app.post("/api/meetings", jwtGuard, limit);')).toBeLessThan(parserAt);
    expect(index.indexOf('app.post("/api/meetings/draft-objective", jwtGuard, limit);')).toBeLessThan(parserAt);
  });

  it("C2（§11.5 v1.4）：/api/decks/import 與 /api/decks/:id/extract-text 都在共用名單、掛在 body parser 之前", () => {
    // 匯入端點是 LLM 觸發端點（每發最多 TEXT_EXTRACT_VISION_MAX_PAGES 次讀圖）且每次匯入都是新 deck
    // ＝in-flight 去重永不命中——名單漏了這條就回不去（v1.4 契約更正的回歸鎖）。
    expect(index).toContain('app.post("/api/decks/import", jwtGuard, limit);');
    expect(index).toContain('app.post("/api/decks/:id/extract-text", jwtGuard, limit);');

    // 層序：限流在 body parser 之前 → 429 發生在 multer 收 50MB 檔之前。
    const parserAt = index.indexOf('app.use(express.json({ limit: "2mb" }))');
    expect(parserAt).toBeGreaterThan(0);
    expect(index.indexOf('app.post("/api/decks/import", jwtGuard, limit);')).toBeLessThan(parserAt);
    expect(index.indexOf('app.post("/api/decks/:id/extract-text", jwtGuard, limit);')).toBeLessThan(parserAt);
  });

  it("整個 apps/server/src 只有一個 TokenBucketRateLimiter 實例（router 不得另開一桶）", () => {
    const files = readdirSync(SRC_DIR, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => f.replace(/\\/g, "/"));
    const owners = files.filter((f) => readFileSync(`${SRC_DIR}${f}`, "utf8").includes("new TokenBucketRateLimiter("));
    expect(owners).toEqual(["index.ts"]);

    // meetings 路由器不得再自建／自掛限流（註解可以提到它，程式碼不行）。
    const routes = readSrc("realtime/meetings-routes.ts");
    expect(routes).not.toContain("new TokenBucketRateLimiter");
    expect(routes).not.toMatch(/^import .*token-bucket\.js";$/m);
    expect(routes).not.toContain("objectiveLimit");
  });
});
