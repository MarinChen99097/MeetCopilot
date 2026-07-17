"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter, usePathname } from "@/i18n/navigation";
import { logout } from "@/lib/api";
import { AuthGuard, useMe } from "@/components/auth/AuthGuard";
import { ToastProvider } from "@/components/ui/Toast";

/**
 * AppShell — authed workbench chrome: ToastProvider + AuthGuard + a collapsible left sidebar.
 * Deliberately scoped to workbench routes only (crm/studio/train/settings/home) — NOT in the root
 * [locale] layout — so /present, /copilot and /hud inherit ZERO copilot chrome (invariant I3).
 * present/copilot/hud are reached from the "會中進行" group as target=_blank standalone tabs.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthGuard>
        <Shell>{children}</Shell>
      </AuthGuard>
    </ToastProvider>
  );
}

const RAIL_KEY = "mc.sidebar.rail";

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Read the persisted collapse state synchronously (lazy initializer) so the rail
  // never flashes expanded-then-collapsed on first paint. This is safe from a
  // hydration mismatch ONLY because Shell always mounts *after* AuthGuard resolves
  // on the client (AuthGuard renders a spinner while "checking", never the shell —
  // see AuthGuard.tsx:53-62), so there is no server-rendered sidebar to diverge
  // from. If AuthGuard is ever made SSR-capable, move this read back into an effect.
  const [rail, setRail] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(RAIL_KEY) === "1";
    } catch {
      return false; // private mode / storage disabled — default expanded
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Reset the mobile drawer when the viewport widens past the drawer breakpoint,
  // so a drawer left open on a narrow screen doesn't linger after resizing up.
  // 881px is the desktop side of the CSS off-canvas breakpoint (max-width:880px).
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 881px)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setMobileOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Esc closes the mobile drawer.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  function toggleRail() {
    setRail((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(RAIL_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const closeMobile = () => setMobileOpen(false);

  return (
    <div className={`mc-shell${rail ? " is-rail" : ""}${mobileOpen ? " is-mobile-open" : ""}`}>
      <Sidebar rail={rail} pathname={pathname} onToggleRail={toggleRail} onNavigate={closeMobile} />
      <MobileScrim open={mobileOpen} onClose={closeMobile} />
      <div className="mc-shell__main">
        <MobileBar onOpen={() => setMobileOpen(true)} />
        <div className="mc-shell__body">{children}</div>
      </div>
    </div>
  );
}

/* ── navigation model ─────────────────────────────────────────── */

interface NavItem {
  key: string;
  href: string;
  labelKey: string;
  icon: IconName;
  external?: boolean;
}
interface NavGroup {
  kickerKey: string;
  live?: boolean;
  adminOnly?: boolean;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  { kickerKey: "nav.workspace", items: [{ key: "home", href: "/", labelKey: "nav.home", icon: "home" }] },
  {
    kickerKey: "nav.pre",
    items: [
      { key: "crm", href: "/crm", labelKey: "crm.title", icon: "building" },
      { key: "studio", href: "/studio", labelKey: "studio.title", icon: "slides" },
    ],
  },
  {
    kickerKey: "nav.live",
    live: true,
    items: [
      { key: "present", href: "/present", labelKey: "present.title", icon: "stage", external: true },
      { key: "copilot", href: "/copilot", labelKey: "copilot.title", icon: "headset", external: true },
      { key: "hud", href: "/hud", labelKey: "hud.title", icon: "gauge", external: true },
    ],
  },
  { kickerKey: "nav.practice", items: [{ key: "train", href: "/train", labelKey: "train.title", icon: "mic" }] },
  {
    kickerKey: "nav.admin",
    adminOnly: true,
    items: [{ key: "team", href: "/settings/team", labelKey: "org.nav.team", icon: "users" }],
  },
];

function isActive(pathname: string, href: string, external?: boolean): boolean {
  if (external) return false; // present/copilot/hud open in a new tab — never marked active
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/* ── sidebar ──────────────────────────────────────────────────── */

function Sidebar({
  rail,
  pathname,
  onToggleRail,
  onNavigate,
}: {
  rail: boolean;
  pathname: string;
  onToggleRail: () => void;
  onNavigate: () => void;
}) {
  const t = useTranslations();
  const me = useMe();
  const isAdmin = me?.role === "owner" || me?.role === "admin";

  return (
    <aside className="mc-sidebar">
      <div className="mc-sidebar__head">
        <Link href="/" className="mc-sidebar__brand" aria-label="MeetCopilot" onClick={onNavigate}>
          <LogoMark />
          <span className="mc-sidebar__wordmark">MeetCopilot</span>
        </Link>
        <button
          type="button"
          className="mc-sidebar__collapse"
          onClick={onToggleRail}
          aria-label={t(rail ? "nav.expand" : "nav.collapse")}
          aria-expanded={!rail}
        >
          <Icon name="menu" />
        </button>
      </div>

      <nav className="mc-sidebar__nav" aria-label={t("home.surfaces")}>
        {NAV_GROUPS.map((group) => {
          if (group.adminOnly && !isAdmin) return null;
          return (
            <div className="mc-sidebar__group" key={group.kickerKey}>
              <span className={`mc-kicker mc-sidebar__kicker${group.live ? " mc-kicker--live" : ""}`}>
                {t(group.kickerKey)}
              </span>
              {group.items.map((item) => {
                const label = t(item.labelKey);
                const active = isActive(pathname, item.href, item.external);
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    className={`mc-sidebar__item${active ? " is-active" : ""}`}
                    title={rail ? label : item.external ? t("nav.newTab") : undefined}
                    aria-current={active ? "page" : undefined}
                    onClick={onNavigate}
                    {...(item.external ? { target: "_blank", rel: "noopener" } : {})}
                  >
                    <Icon name={item.icon} />
                    <span className="mc-sidebar__label">{label}</span>
                    {item.external ? (
                      <span className="mc-sidebar__ext" aria-hidden="true">
                        ↗
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <SidebarFoot onNavigate={onNavigate} />
    </aside>
  );
}

function SidebarFoot({ onNavigate }: { onNavigate: () => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();

  function switchLocale(next: "zh-TW" | "en") {
    if (next === locale) return;
    router.replace(pathname, { locale: next });
  }

  function onLogout() {
    onNavigate();
    logout();
    router.replace("/login");
  }

  return (
    <div className="mc-sidebar__foot">
      {me ? (
        <div className="mc-sidebar__org" title={me.org.name}>
          {me.org.name}
        </div>
      ) : null}
      {me ? (
        <div className="mc-sidebar__user">
          <span className="mc-sidebar__avatar" aria-hidden="true">
            {initials(me.user.displayName)}
          </span>
          <div className="mc-sidebar__userid">
            <span className="mc-sidebar__username">{me.user.displayName}</span>
            <span className="mc-sidebar__role">{t(`org.roles.${me.role}`)}</span>
          </div>
        </div>
      ) : null}
      <div className="mc-langswitch" role="group" aria-label={t("nav.language")}>
        <button
          type="button"
          className={locale === "zh-TW" ? "is-on" : ""}
          aria-pressed={locale === "zh-TW"}
          onClick={() => switchLocale("zh-TW")}
        >
          中
        </button>
        <button
          type="button"
          className={locale === "en" ? "is-on" : ""}
          aria-pressed={locale === "en"}
          onClick={() => switchLocale("en")}
        >
          EN
        </button>
      </div>
      <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm mc-sidebar__logout" onClick={onLogout}>
        {t("nav.logout")}
      </button>
    </div>
  );
}

function MobileBar({ onOpen }: { onOpen: () => void }) {
  const t = useTranslations();
  return (
    <header className="mc-mobilebar">
      <button type="button" className="mc-mobilebar__btn" onClick={onOpen} aria-label={t("nav.menu")}>
        <Icon name="menu" />
      </button>
      <span className="mc-mobilebar__wordmark">MeetCopilot</span>
    </header>
  );
}

function MobileScrim({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations();
  return (
    <button
      type="button"
      className="mc-scrim"
      aria-label={t("nav.closeMenu")}
      tabIndex={open ? 0 : -1}
      onClick={onClose}
    />
  );
}

/* ── initials for the user avatar ─────────────────────────────── */

function initials(name: string): string {
  const [first, second] = name.trim().split(/\s+/).filter(Boolean);
  if (!first) return "?";
  if (!second) return first.slice(0, 2).toUpperCase();
  return (first.charAt(0) + second.charAt(0)).toUpperCase();
}

/* ── inline icon set (no new dependency) ──────────────────────── */

export type IconName =
  | "home"
  | "building"
  | "slides"
  | "stage"
  | "headset"
  | "gauge"
  | "mic"
  | "users"
  | "menu";

const ICON_PATHS: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="M3 10.5 12 4l9 6.5" />
      <path d="M5 9.5V20h14V9.5" />
    </>
  ),
  building: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M9.5 21v-4h5v4" />
      <path d="M8 7h.01M12 7h.01M16 7h.01M8 11h.01M12 11h.01M16 11h.01" />
    </>
  ),
  slides: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="1" />
      <path d="M12 16v4" />
      <path d="M8 20h8" />
    </>
  ),
  stage: <path d="M8 5.5v13l10-6.5z" />,
  headset: (
    <>
      <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
      <rect x="2.5" y="13" width="4.5" height="6" rx="1.4" />
      <rect x="17" y="13" width="4.5" height="6" rx="1.4" />
      <path d="M19.2 19a4 3 0 0 1-4 3h-2.2" />
    </>
  ),
  gauge: (
    <>
      <path d="M4 19a8 8 0 1 1 16 0" />
      <path d="M12 15l4-4" />
      <circle cx="12" cy="15" r="0.6" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0" />
      <path d="M12 17v4" />
      <path d="M9 21h6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.4a3 3 0 0 1 0 5.6" />
      <path d="M18 20a5.5 5.5 0 0 0-3-4.9" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="mc-ico"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

function LogoMark() {
  return (
    <svg className="mc-sidebar__mark" viewBox="0 0 24 24" width={22} height={22} aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="6" fill="var(--mc-accent)" />
      <path
        d="M6 17V7l6 6 6-6v10"
        fill="none"
        stroke="#fff"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
