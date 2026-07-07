/**
 * TokenBucketRateLimiter — in-memory per-org ＋ per-IP token bucket（實作 ops/rate-limiter.ts 的 RateLimiter 介面，M5_CONTRACT §C）。
 *
 * 決策 20：單 VM 單進程 → 記憶體即可（日後多實例再換共享儲存 Redis）。兩維度各一組 bucket：
 *   - per-org（authenticated 端點；orgId 由已驗證 JWT 來，攻擊者無法偽造 → 主要防線）。
 *   - per-IP（次要防線；trust proxy 後的真實來源；防單一來源灌爆未帶合法 org 的情境）。
 * `take` 同時檢核兩桶：任一空 → allowed=false（且不從另一桶扣點）。retryAfterMs 取「補滿 1 token 需時」。
 *
 * 有界性（L13）：每個相異 org/ip 一個 bucket；invite-only 單 VM 下 org 數小，但匿名 IP 可能多，
 * 故加一個 unref 的定期 sweep 清掉「已補滿到上限」（= 閒置）的 bucket，避免無界成長。dispose() 停 timer。
 */
import type { Request, Response, NextFunction } from "express";
import type { RateLimiter, RateLimitDecision } from "./rate-limiter.js";

/** 一個維度的 bucket 參數。capacity＝突發上限；refillPerSec＝穩態速率。 */
export interface BucketConfig {
  capacity: number;
  refillPerSec: number;
}

interface Bucket {
  tokens: number;
  /** 上次補點的時間戳（ms）。 */
  last: number;
}

/** 預設：per-org 30 req/min（capacity 30、0.5/s）、per-IP 60 req/min（NAT 下較寬）。 */
export const DEFAULT_ORG_BUCKET: BucketConfig = { capacity: 30, refillPerSec: 30 / 60 };
export const DEFAULT_IP_BUCKET: BucketConfig = { capacity: 60, refillPerSec: 60 / 60 };

const SWEEP_INTERVAL_MS = 60_000;

export class TokenBucketRateLimiter implements RateLimiter {
  private readonly orgBuckets = new Map<string, Bucket>();
  private readonly ipBuckets = new Map<string, Bucket>();
  private sweepTimer?: NodeJS.Timeout;

  constructor(
    private readonly orgCfg: BucketConfig = DEFAULT_ORG_BUCKET,
    private readonly ipCfg: BucketConfig = DEFAULT_IP_BUCKET,
    /** 可注入時鐘（測試用）；預設 Date.now。 */
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** 啟動閒置 bucket 清掃（unref → 不阻擋進程退出）。回傳 this 以便鏈式。 */
  start(): this {
    if (this.sweepTimer) return this;
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    if (typeof this.sweepTimer.unref === "function") this.sweepTimer.unref();
    return this;
  }

  /** 停 sweep timer（優雅關機呼叫）。 */
  dispose(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
  }

  take(orgId: string, ip: string): RateLimitDecision {
    const org = this.refill(this.orgBuckets, orgId, this.orgCfg);
    const ipb = this.refill(this.ipBuckets, ip, this.ipCfg);
    // 先各自 refill 再判斷；任一不足即拒，且**不扣點**（否則被拒的請求仍消耗另一桶額度）。
    if (org.tokens < 1) return { allowed: false, retryAfterMs: retryAfterMs(org, this.orgCfg) };
    if (ipb.tokens < 1) return { allowed: false, retryAfterMs: retryAfterMs(ipb, this.ipCfg) };
    org.tokens -= 1;
    ipb.tokens -= 1;
    return { allowed: true };
  }

  private refill(map: Map<string, Bucket>, key: string, cfg: BucketConfig): Bucket {
    const now = this.now();
    let b = map.get(key);
    if (!b) {
      b = { tokens: cfg.capacity, last: now };
      map.set(key, b);
      return b;
    }
    const elapsedSec = (now - b.last) / 1000;
    if (elapsedSec > 0) {
      b.tokens = Math.min(cfg.capacity, b.tokens + elapsedSec * cfg.refillPerSec);
      b.last = now;
    }
    return b;
  }

  /** 移除已補滿到上限（閒置足夠久）的 bucket，控制記憶體。 */
  private sweep(): void {
    sweepMap(this.orgBuckets, this.orgCfg, this.now());
    sweepMap(this.ipBuckets, this.ipCfg, this.now());
  }
}

function sweepMap(map: Map<string, Bucket>, cfg: BucketConfig, now: number): void {
  for (const [key, b] of map) {
    const tokens = Math.min(cfg.capacity, b.tokens + ((now - b.last) / 1000) * cfg.refillPerSec);
    if (tokens >= cfg.capacity) map.delete(key);
  }
}

/** 補滿 1 token（達可通過門檻）所需毫秒，向上取整。 */
function retryAfterMs(b: Bucket, cfg: BucketConfig): number {
  const deficit = 1 - b.tokens;
  if (deficit <= 0) return 0;
  return Math.ceil((deficit / cfg.refillPerSec) * 1000);
}

/**
 * Express 中介層工廠：套在貴的端點（見 index.ts）。必須在 authRequired 之後掛，才拿得到 req.auth.orgId。
 * 超限 → 429 `{error}`＋Retry-After（秒）。orgId 缺（理論上不會，因掛在 auth 後）→ 退回 "anon"。
 */
export function rateLimit(limiter: RateLimiter) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const orgId = req.auth?.orgId ?? "anon";
    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const decision = limiter.take(orgId, ip);
    if (decision.allowed) {
      next();
      return;
    }
    if (decision.retryAfterMs != null) {
      res.setHeader("Retry-After", String(Math.ceil(decision.retryAfterMs / 1000)));
    }
    res.status(429).json({ error: "rate limit exceeded — slow down and retry shortly" });
  };
}
