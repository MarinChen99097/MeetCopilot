/**
 * Shared helpers for the CRM HTTP routes (apps/server/src/crm-routes).
 * All CRM routes are org-scoped from req.auth.orgId — the frontend NEVER sends orgId (API_CONTRACT §0).
 * Handlers are async; asyncHandler funnels rejections to the index.ts error middleware ({error:string}).
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { Page } from "@meetcopilot/crm";

/** Wrap an async route handler so thrown/rejected errors reach the {error} error middleware. */
export function asyncHandler(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}

/** Tenant scope — always from the verified JWT, never from body/query. authRequired guarantees req.auth. */
export function orgId(req: Request): string {
  return req.auth!.orgId;
}

/** Acting user (provenance filled_by='human' backing for 細填/確認). */
export function userId(req: Request): string {
  return req.auth!.userId;
}

/** Path param as a string. A matched Express `:key` is always present; "" only if the route ever omits it. */
export function param(req: Request, key: string): string {
  const v = req.params[key];
  return typeof v === "string" ? v : "";
}

/** Trim to a non-empty string or undefined (query values may be arrays → undefined). */
export function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/** Parse ?page=&pageSize= with defaults (page 1, size 20) and clamping (size 1..100). */
export function parsePage(req: Request): Page {
  const page = Math.max(1, Math.trunc(Number(req.query.page)) || 1);
  const rawSize = Math.trunc(Number(req.query.pageSize)) || 20;
  const pageSize = Math.min(100, Math.max(1, rawSize));
  return { page, pageSize };
}

export function notFound(res: Response, what = "not found"): void {
  res.status(404).json({ error: what });
}

export function badRequest(res: Response, msg: string): void {
  res.status(400).json({ error: msg });
}

/** System/bookkeeping keys a client must never set through create/patch bodies (repo owns them). */
const SYSTEM_KEYS = new Set([
  "id",
  "orgId",
  "createdAt",
  "updatedAt",
  "verifiedStatus",
  "verifiedBy",
  "verifiedAt",
  "crawlConfidence",
  "lastCrawledAt",
  "lastEnrichedAt",
  "rawCrawl",
]);

/**
 * Strip system-managed keys (and any `extraStrip`, e.g. path-supplied companyId) from a request body,
 * returning a Partial<T> safe to hand a repo create/update. Non-object bodies → {}.
 */
export function sanitize<T>(body: unknown, extraStrip: string[] = []): Partial<T> {
  const obj = (body ?? {}) as Record<string, unknown>;
  if (typeof obj !== "object" || Array.isArray(obj)) return {};
  const strip = new Set([...SYSTEM_KEYS, ...extraStrip]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!strip.has(k)) out[k] = v;
  }
  return out as Partial<T>;
}

/** True when `v` is a member of the allowed literal set (enum validation). */
export function isOneOf<T extends string>(v: unknown, allowed: readonly T[]): v is T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v);
}

/**
 * Content-Disposition (RFC5987): ASCII fallback + filename* (UTF-8 percent-encoded); `ext` e.g. "pptx"/"pdf".
 * Shared by the deck export routes (both the source-preserving export and the legacy export.pptx).
 */
export function contentDisposition(title: string, ext: string): string {
  const clean = title.replace(/[\r\n"\\]/g, "").trim() || "deck";
  const ascii = clean.replace(/[^\x20-\x7E]/g, "_").replace(/_+/g, "_").trim() || "deck";
  const encoded = encodeURIComponent(`${clean}.${ext}`).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${encoded}`;
}
