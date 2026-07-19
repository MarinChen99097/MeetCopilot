/**
 * Company routes (API_CONTRACT §2 — 公司).
 *   GET    /companies?query=&status=&page=&pageSize=  → {items:CompanySummary[], total}
 *   POST   /companies  {name, domain?, websiteUrl?}   → 201 Company
 *   GET    /companies/:id                             → Company + counts
 *   PATCH  /companies/:id  {...partial}               → Company (細填: repo writes filled_by='human' provenance)
 *   DELETE /companies/:id                             → 204
 *   GET    /companies/:id/{news,locations,funding,tech,departments} → child arrays
 * All org-scoped from req.auth.orgId.
 */
import type { Router, Request } from "express";
import type { CrmCore } from "@meetcopilot/crm";
import type { Company, NewCompany, SocialPost } from "@meetcopilot/shared";
import { asyncHandler, orgId, userId, str, parsePage, notFound, badRequest, sanitize, param } from "./helpers.js";
import { cleanUrl } from "../research/extract-shared.js";

/**
 * 帳號連結白名單化（XSS 縱深，契約三）：social_links JSON ＋ 六個 social_* 單欄整併，每個值過 cleanUrl——
 * **只收絕對 http(s)**（javascript:/data:/相對路徑/非法一律略過，不進 links）；curated 單欄勝（後 put 覆蓋）。
 * 前端另有 scheme 驗證（SocialTab）＋React sanitizeURL，此為 server 側第一道；純函式，供單測。
 */
export function buildSocialLinks(company: {
  socialLinks?: Record<string, string | undefined> | null;
  socialLinkedin?: string;
  socialTwitter?: string;
  socialFacebook?: string;
  socialYoutube?: string;
  socialCrunchbase?: string;
  socialGithub?: string;
}): Record<string, string> {
  const links: Record<string, string> = {};
  const put = (key: string, val: string | undefined): void => {
    const clean = cleanUrl(val); // 絕對 http(s) 才回值；非法 → undefined → 略過
    if (clean) links[key] = clean;
  };
  if (company.socialLinks && typeof company.socialLinks === "object") {
    for (const [k, v] of Object.entries(company.socialLinks)) put(k, v as string | undefined);
  }
  put("linkedin", company.socialLinkedin);
  put("twitter", company.socialTwitter);
  put("facebook", company.socialFacebook);
  put("youtube", company.socialYoutube);
  put("crunchbase", company.socialCrunchbase);
  put("github", company.socialGithub);
  return links;
}

/**
 * 貼文 URL 白名單化（XSS 縱深，契約三）：非絕對 http(s) 的 url → 剝除（設 undefined），其餘欄原樣保留。
 * 前端渲染時另驗 scheme（無 href 時純文字顯示）。純函式，供單測。
 */
export function sanitizeSocialPosts(posts: SocialPost[]): SocialPost[] {
  return posts.map((p) => {
    const clean = cleanUrl(p.url);
    return clean === p.url ? p : { ...p, url: clean };
  });
}

export function registerCompanyRoutes(router: Router, core: CrmCore): void {
  // ── list ──
  router.get(
    "/companies",
    asyncHandler(async (req, res) => {
      const filter = { query: str(req.query.query), status: str(req.query.status) };
      const result = await core.companies.list(orgId(req), filter, parsePage(req));
      res.json(result);
    }),
  );

  // ── create ──
  router.post(
    "/companies",
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const name = str(body.name);
      if (!name) {
        badRequest(res, "name is required");
        return;
      }
      const input: NewCompany = { ...sanitize<NewCompany>(body), name };
      const company = await core.companies.create(orgId(req), input);
      res.status(201).json(company);
    }),
  );

  // ── detail (+ counts) ──
  router.get(
    "/companies/:id",
    asyncHandler(async (req, res) => {
      const oid = orgId(req);
      const company = await core.companies.findById(oid, param(req, "id"));
      if (!company) {
        notFound(res, "company not found");
        return;
      }
      const counts = await core.companies.counts(oid, param(req, "id"));
      res.json({ ...company, counts });
    }),
  );

  // ── 細填 (human overwrite → provenance) ──
  router.patch(
    "/companies/:id",
    asyncHandler(async (req, res) => {
      const oid = orgId(req);
      const existing = await core.companies.findById(oid, param(req, "id"));
      if (!existing) {
        notFound(res, "company not found");
        return;
      }
      const patch = sanitize<Company>(req.body);
      const company = await core.companies.update(oid, param(req, "id"), patch, { userId: userId(req) });
      res.json(company);
    }),
  );

  // ── delete ──
  router.delete(
    "/companies/:id",
    asyncHandler(async (req, res) => {
      const oid = orgId(req);
      const existing = await core.companies.findById(oid, param(req, "id"));
      if (!existing) {
        notFound(res, "company not found");
        return;
      }
      await core.companies.delete(oid, param(req, "id"));
      res.status(204).end();
    }),
  );

  // ── children (org-scoped arrays; empty [] if company absent/foreign) ──
  const cid = (req: Request): string => param(req, "id");
  router.get(
    "/companies/:id/news",
    asyncHandler(async (req, res) => {
      res.json(await core.companyChildren.listNews(orgId(req), cid(req)));
    }),
  );
  router.get(
    "/companies/:id/locations",
    asyncHandler(async (req, res) => {
      res.json(await core.companyChildren.listLocations(orgId(req), cid(req)));
    }),
  );
  router.get(
    "/companies/:id/funding",
    asyncHandler(async (req, res) => {
      res.json(await core.companyChildren.listFunding(orgId(req), cid(req)));
    }),
  );
  router.get(
    "/companies/:id/tech",
    asyncHandler(async (req, res) => {
      res.json(await core.companyChildren.listTech(orgId(req), cid(req)));
    }),
  );
  router.get(
    "/companies/:id/departments",
    asyncHandler(async (req, res) => {
      res.json(await core.companyChildren.listDepartments(orgId(req), cid(req)));
    }),
  );

  // ── social：帳號連結（social_links JSON ＋ 六個 social_* 單欄整併）＋ 貼文/影片（company_social_posts）──
  // authz 同其它 child 路由：org-scoped；公司不存在/非本 org → { links:{}, posts:[] }（不洩漏）。
  router.get(
    "/companies/:id/social",
    asyncHandler(async (req, res) => {
      const oid = orgId(req);
      const id = cid(req);
      const company = await core.companies.findById(oid, id);
      if (!company) {
        res.json({ links: {}, posts: [] });
        return;
      }
      // 先鋪 social_links JSON（可帶 instagram/threads 等），再以六個 social_* 單欄覆蓋（curated 勝）；
      // 每值過 cleanUrl 白名單（只收絕對 http(s)，擋 javascript:/data:/相對路徑——XSS 縱深契約三）。
      const links = buildSocialLinks(company);
      const posts = sanitizeSocialPosts(await core.companySocial.listByCompany(oid, id));
      res.json({ links, posts });
    }),
  );
}
