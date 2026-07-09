"use client";

import type { ReactNode } from "react";
import { AuthGuard } from "./AuthGuard";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

/**
 * AdminShell — 受保護頁面的共用外框：AuthGuard + 側欄 + 頂欄 + 內容區。
 * 每個受保護頁面包一層 <AdminShell title="...">。/login 不使用（無 chrome、無 guard）。
 */
export function AdminShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <AuthGuard>
      <div className="ad-shell">
        <Sidebar />
        <div className="ad-shell__main">
          <TopBar title={title} />
          <main className="ad-shell__content">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}
