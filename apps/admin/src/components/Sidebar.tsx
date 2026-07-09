"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Sidebar — 資料驅動側欄導航（ADMIN_CONTRACT §8：資料驅動側欄 config）。
 * 桌面優先固定側欄；1280px 以下由 AdminShell 的 CSS 收合為頂部橫列。
 */
interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** 用於 active 判定的前綴（/orgs 需涵蓋 /orgs/[id]）。 */
  match: (path: string) => boolean;
}

const NAV: NavItem[] = [
  { href: "/", label: "總覽", icon: "◫", match: (p) => p === "/" },
  { href: "/usage", label: "花費", icon: "$", match: (p) => p.startsWith("/usage") },
  { href: "/orgs", label: "組織", icon: "⌂", match: (p) => p.startsWith("/orgs") },
  { href: "/jobs", label: "Jobs", icon: "⚙", match: (p) => p.startsWith("/jobs") },
  { href: "/health", label: "健康", icon: "♥", match: (p) => p.startsWith("/health") },
];

export function Sidebar() {
  const pathname = usePathname() || "/";
  return (
    <aside className="ad-sidebar">
      <div className="ad-sidebar__brand">
        <span className="ad-sidebar__logo">MC</span>
        <span className="ad-sidebar__brandtext">
          MeetCopilot
          <small>平台管理後台</small>
        </span>
      </div>
      <nav className="ad-sidebar__nav" aria-label="主導航">
        {NAV.map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`ad-sidebar__link ${active ? "ad-sidebar__link--active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <span className="ad-sidebar__icon" aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
