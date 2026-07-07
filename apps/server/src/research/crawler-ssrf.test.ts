/**
 * F4 — SSRF / DNS-rebinding guard for the Playwright crawler.
 *
 * We can't spin a real headless Chromium crawl in unit tests (browser download + live network), so we assert
 * the two pieces the fix rests on, both exercisable without network:
 *   1. `hostResolverRules` pins the validated target host to its validated IP — this is what Chromium is
 *      launched with, so it can never independently re-resolve the target host to a private/metadata address
 *      (the rebinding TOCTOU on the user-supplied URL). It does NOT fail other hosts closed: a prior
 *      `,MAP * ~NOTFOUND` clause broke common www↔apex cross-host redirects (e.g. www.ghost.org→ghost.org,
 *      ERR_NAME_NOT_RESOLVED); other hosts are gated per-request by the context.route resolveAndValidate guard.
 *   2. The pre-nav `resolveAndValidate` gate still rejects literal internal/metadata/loopback addresses and
 *      still accepts a literal public IP (behavior unchanged by the fix — the guard runs before launch).
 * A full end-to-end rebinding probe needs the live crawl (noted in the F4 report).
 */
import { describe, it, expect } from "vitest";
import { hostResolverRules } from "./crawler.js";
import { isPrivateIp, resolveAndValidate } from "../import/extract.js";

describe("hostResolverRules (F4 IP pin)", () => {
  it("pins the validated target host to its IPv4 (no fail-closed clause for other hosts)", () => {
    expect(hostResolverRules("example.com", "93.184.216.34", 4)).toBe(
      "MAP example.com 93.184.216.34",
    );
  });

  it("brackets IPv6 replacements (Chromium host[:port] parsing)", () => {
    expect(hostResolverRules("example.com", "2606:2800:220:1:248:1893:25c8:1946", 6)).toBe(
      "MAP example.com [2606:2800:220:1:248:1893:25c8:1946]",
    );
  });
});

describe("pre-nav SSRF gate still holds (F4 unchanged behavior)", () => {
  it("blocks cloud metadata / loopback / private literals", async () => {
    await expect(resolveAndValidate("169.254.169.254")).rejects.toThrow(); // AWS/GCP/Azure metadata
    await expect(resolveAndValidate("127.0.0.1")).rejects.toThrow(); // loopback
    await expect(resolveAndValidate("10.0.0.5")).rejects.toThrow(); // RFC1918
    await expect(resolveAndValidate("::1")).rejects.toThrow(); // IPv6 loopback
  });

  it("accepts a literal public IP", async () => {
    await expect(resolveAndValidate("93.184.216.34")).resolves.toEqual({ ip: "93.184.216.34", family: 4 });
  });

  it("isPrivateIp classifies the load-bearing ranges", () => {
    expect(isPrivateIp("169.254.169.254")).toBe(true);
    expect(isPrivateIp("100.100.100.200")).toBe(true); // CGNAT (Alibaba metadata)
    expect(isPrivateIp("93.184.216.34")).toBe(false);
  });
});
