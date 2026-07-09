"use client";

import { useRouter } from "next/navigation";
import { logout } from "@/lib/auth";
import { useMe } from "./AuthGuard";

/**
 * TopBar — 頂欄：頁面標題（由 page 傳入）＋登入者 email＋登出。
 * email 來自 useMe()（AuthGuard 提供的 /api/auth/me 身分）。
 */
export function TopBar({ title }: { title: string }) {
  const me = useMe();
  const router = useRouter();

  function onLogout() {
    logout();
    router.replace("/login");
  }

  return (
    <header className="ad-topbar">
      <h1 className="ad-topbar__title">{title}</h1>
      <div className="ad-topbar__right">
        {me ? <span className="ad-topbar__user">{me.user.email}</span> : null}
        <button type="button" className="ad-btn ad-btn--ghost ad-btn--sm" onClick={onLogout}>
          登出
        </button>
      </div>
    </header>
  );
}
