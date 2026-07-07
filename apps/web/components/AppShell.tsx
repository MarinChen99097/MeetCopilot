"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { logout } from "@/lib/api";
import { AuthGuard, useMe } from "@/components/auth/AuthGuard";
import { ToastProvider } from "@/components/ui/Toast";

/**
 * Authed workbench surfaces reachable from the chrome. present/copilot/hud are DELIBERATELY excluded —
 * they must inherit zero copilot chrome (I3) and are reached from the meeting flow, not the topbar.
 */
const NAV_SURFACES = ["crm", "studio", "train"] as const;

/**
 * AppShell — authed CRM chrome: ToastProvider + AuthGuard + topbar (brand/org/user/logout).
 * Deliberately scoped to CRM routes only — NOT in the root [locale] layout — so /present and
 * the capture surfaces inherit ZERO copilot chrome (invariant I3).
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthGuard>
        <div className="mc-shell">
          <TopBar />
          <div className="mc-shell__body">{children}</div>
        </div>
      </AuthGuard>
    </ToastProvider>
  );
}

const ROLE_LABEL: Record<string, string> = { owner: "擁有者", admin: "管理員", member: "成員" };

function TopBar() {
  const me = useMe();
  const router = useRouter();
  const t = useTranslations();

  function onLogout() {
    logout();
    router.replace("/login");
  }

  return (
    <header className="mc-topbar">
      <div className="mc-topbar__left">
        <Link href="/crm" className="mc-topbar__brand">
          MeetCopilot
        </Link>
        <nav className="mc-topbar__nav" aria-label={t("home.surfaces")}>
          {NAV_SURFACES.map((s) => (
            <Link key={s} href={`/${s}`} className="mc-topbar__navlink">
              {t(`${s}.title`)}
            </Link>
          ))}
        </nav>
        {me ? <span className="mc-topbar__org">{me.org.name}</span> : null}
      </div>
      <div className="mc-topbar__right">
        {me ? (
          <span className="mc-topbar__user">
            {me.user.displayName}
            <span className="mc-topbar__role">{ROLE_LABEL[me.role] ?? me.role}</span>
          </span>
        ) : null}
        <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={onLogout}>
          登出
        </button>
      </div>
    </header>
  );
}
