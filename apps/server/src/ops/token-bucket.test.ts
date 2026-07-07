/**
 * TokenBucketRateLimiter — 單元測試（M5 §C）。用注入時鐘驗證：容量內放行、超限拒絕＋Retry-After、
 * 隨時間補點恢復、per-org 與 per-IP 兩維度獨立、被拒不扣另一桶。
 */
import { describe, it, expect } from "vitest";
import { TokenBucketRateLimiter } from "./token-bucket.js";

function fixedClock(startMs = 0) {
  let now = startMs;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("TokenBucketRateLimiter", () => {
  it("allows up to capacity then rejects with Retry-After", () => {
    const clock = fixedClock();
    // org: capacity 3, 1 token/sec; ip: generous so org is the binding constraint.
    const rl = new TokenBucketRateLimiter(
      { capacity: 3, refillPerSec: 1 },
      { capacity: 1000, refillPerSec: 1000 },
      clock.now,
    );
    expect(rl.take("org1", "1.1.1.1").allowed).toBe(true);
    expect(rl.take("org1", "1.1.1.1").allowed).toBe(true);
    expect(rl.take("org1", "1.1.1.1").allowed).toBe(true);
    const denied = rl.take("org1", "1.1.1.1");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(1000); // ≤ 1s to refill 1 token at 1/s
  });

  it("refills over time", () => {
    const clock = fixedClock();
    const rl = new TokenBucketRateLimiter(
      { capacity: 1, refillPerSec: 1 },
      { capacity: 1000, refillPerSec: 1000 },
      clock.now,
    );
    expect(rl.take("org1", "1.1.1.1").allowed).toBe(true);
    expect(rl.take("org1", "1.1.1.1").allowed).toBe(false);
    clock.advance(1000); // +1s → +1 token
    expect(rl.take("org1", "1.1.1.1").allowed).toBe(true);
  });

  it("isolates orgs and IPs (independent buckets)", () => {
    const clock = fixedClock();
    const rl = new TokenBucketRateLimiter(
      { capacity: 1, refillPerSec: 0.001 },
      { capacity: 1000, refillPerSec: 1000 },
      clock.now,
    );
    expect(rl.take("orgA", "1.1.1.1").allowed).toBe(true);
    expect(rl.take("orgA", "1.1.1.1").allowed).toBe(false); // orgA exhausted
    expect(rl.take("orgB", "1.1.1.1").allowed).toBe(true); // orgB independent
  });

  it("rejects on IP exhaustion without spending the org token (no double-charge on denial)", () => {
    const clock = fixedClock();
    const rl = new TokenBucketRateLimiter(
      { capacity: 2, refillPerSec: 0.0001 }, // org: 2 tokens, effectively no refill during the test
      { capacity: 1, refillPerSec: 0.0001 }, // ip: 1 token per distinct IP
      clock.now,
    );
    expect(rl.take("org1", "ip1").allowed).toBe(true); // org 2→1, ip1 1→0
    expect(rl.take("org1", "ip1").allowed).toBe(false); // blocked by ip1 (empty); org1 must stay at 1
    // Fresh IP still has a token; if the denial above had wrongly spent org1, org1 would be 0 → this would fail.
    expect(rl.take("org1", "ip2").allowed).toBe(true); // org 1→0
    expect(rl.take("org1", "ip3").allowed).toBe(false); // now org1 is genuinely exhausted
  });
});
