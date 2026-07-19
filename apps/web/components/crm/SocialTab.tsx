"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, getSocial, type CompanySocial, type SocialPost } from "@/lib/api";
import { fmtDate, fmtNumber } from "@/lib/format";
import { StateBoundary } from "@/components/ui/StateBoundary";

/** 平台顯示名（帳號卡＋貼文分組標頭共用）。未知平台回退為首字大寫。 */
const PLATFORM_LABEL: Record<string, string> = {
  youtube: "YouTube",
  threads: "Threads",
  linkedin: "LinkedIn",
  twitter: "X / Twitter",
  x: "X / Twitter",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  crunchbase: "Crunchbase",
  github: "GitHub",
};
/** 帳號卡與貼文分組的偏好排序（其餘平台按字母序附後）。 */
const PLATFORM_ORDER = [
  "youtube",
  "threads",
  "linkedin",
  "twitter",
  "x",
  "facebook",
  "instagram",
  "tiktok",
  "crunchbase",
  "github",
];

function platformLabel(p: string): string {
  return PLATFORM_LABEL[p] ?? (p.length > 0 ? p.charAt(0).toUpperCase() + p.slice(1) : "其他");
}

/**
 * scheme 白名單（XSS 縱深，客戶端第二道）：只回傳絕對 http(s) URL，否則 null。
 * javascript:/data:/相對路徑等 → null（呼叫端改以純文字顯示、不掛 href）。server 端已過 cleanUrl，此為前端保險。
 */
function httpUrl(u: string | undefined | null): string | null {
  if (typeof u !== "string" || u.trim().length === 0) return null;
  try {
    const parsed = new URL(u.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? u.trim() : null;
  } catch {
    return null;
  }
}
function orderIndex(p: string): number {
  const i = PLATFORM_ORDER.indexOf(p);
  return i === -1 ? PLATFORM_ORDER.length : i;
}
function byPlatformThenName(a: string, b: string): number {
  const d = orderIndex(a) - orderIndex(b);
  return d !== 0 ? d : a.localeCompare(b);
}

/** 社群 tab：四平台帳號卡 ＋ 每平台下列貼文/影片（標題/文字、日期、觀看數、外開連結）。 */
export function SocialTab({ companyId }: { companyId: string }) {
  const [data, setData] = useState<CompanySocial | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getSocial(companyId)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof ApiError ? err.message : "載入失敗");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [companyId]);

  useEffect(() => load(), [load]);

  // 帳號連結：links 物件中非空字串值 → 依偏好排序的 [platform,url] 清單。
  const linkEntries = useMemo(() => {
    const links = data?.links ?? {};
    return Object.entries(links)
      .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
      .map(([platform, url]) => [platform, (url as string).trim()] as [string, string])
      .sort((a, b) => byPlatformThenName(a[0], b[0]));
  }, [data]);

  // 貼文：按 platform 分組，組內以 publishedAt 由新到舊。
  const groups = useMemo(() => {
    const map = new Map<string, SocialPost[]>();
    for (const p of data?.posts ?? []) {
      const key = p.platform || "其他";
      const arr = map.get(key) ?? [];
      arr.push(p);
      map.set(key, arr);
    }
    return Array.from(map.entries())
      .sort((a, b) => byPlatformThenName(a[0], b[0]))
      .map(([platform, posts]) => ({
        platform,
        posts: [...posts].sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0)),
      }));
  }, [data]);

  const isEmpty = linkEntries.length === 0 && groups.length === 0;

  return (
    <div className="mc-tabpane">
      <h3 className="mc-tabpane__title">社群</h3>
      <StateBoundary
        loading={loading}
        error={error}
        isEmpty={isEmpty}
        onRetry={load}
        emptyTitle="尚無社群資料"
        emptyHint="用研究引擎抓取社群帳號、影片與貼文。"
      >
        {linkEntries.length > 0 ? (
          <div className="mc-social__accounts">
            {linkEntries.map(([platform, url]) => {
              // scheme 驗證：非 http(s) → 純文字（不掛 href，XSS 縱深）。
              const safe = httpUrl(url);
              const label = <span className="mc-social__account-plat">{platformLabel(platform)}</span>;
              return safe ? (
                <a
                  key={platform}
                  className="mc-social__account"
                  href={safe}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={safe}
                >
                  {label}
                  <span className="mc-social__account-open" aria-hidden="true">
                    ↗
                  </span>
                </a>
              ) : (
                <span key={platform} className="mc-social__account" title={url}>
                  {label}
                </span>
              );
            })}
          </div>
        ) : null}

        {groups.map((g) => (
          <section key={g.platform} className="mc-social__group">
            <div className="mc-social__group-head">
              <span className="mc-social__group-plat">{platformLabel(g.platform)}</span>
              <span className="mc-social__group-count">{fmtNumber(g.posts.length)} 則</span>
            </div>
            <ul className="mc-social__posts">
              {g.posts.map((p) => (
                <SocialPostRow key={p.id} post={p} />
              ))}
            </ul>
          </section>
        ))}
      </StateBoundary>
    </div>
  );
}

function SocialPostRow({ post }: { post: SocialPost }) {
  const title = post.title?.trim() ?? "";
  const content = post.content?.trim() ?? "";
  const heading = title || content || "(無標題)";
  // 標題與內容都有、且不同 → 標題下另列內文；標題即內文時不重複顯示。
  const showBody = !!title && !!content && content !== title;
  const views = post.metrics?.views;
  // scheme 驗證：非 http(s) → 純文字（不掛 href，XSS 縱深）。
  const safeUrl = httpUrl(post.url);
  return (
    <li className="mc-social__post">
      <div className="mc-social__post-top">
        <span className="mc-social__post-title">
          {safeUrl ? (
            <a href={safeUrl} target="_blank" rel="noreferrer noopener">
              {heading}
            </a>
          ) : (
            heading
          )}
        </span>
      </div>
      <div className="mc-social__post-meta">
        {post.publishedAt ? <span>{fmtDate(post.publishedAt)}</span> : null}
        {typeof views === "number" && Number.isFinite(views) ? (
          <span className="mc-social__post-views">👁 {fmtNumber(views)} 次觀看</span>
        ) : null}
      </div>
      {showBody ? <p className="mc-social__post-body">{content}</p> : null}
    </li>
  );
}
