import type { ReactNode } from "react";
import type { Metadata } from "next";
import "./globals.css";

/**
 * Root layout（唯一擁有 html/body）。zh-TW 單語（無 next-intl）。
 * 不放 chrome：側欄/頂欄由各受保護頁面透過 <AdminShell> 提供，讓 /login 保持無 chrome。
 */
export const metadata: Metadata = {
  title: "MeetCopilot 平台管理後台",
  description: "平台管理者後台：花費、帳號、研究 Job、系統健康。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-TW">
      <body>{children}</body>
    </html>
  );
}
