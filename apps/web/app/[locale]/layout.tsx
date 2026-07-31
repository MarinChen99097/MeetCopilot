import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Space_Grotesk, IBM_Plex_Mono, Noto_Sans_TC } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import "../globals.css";

// next/font (self-hosted at build time — **no Google Fonts <link>**, CSP/效能，見 DESIGN_APPLY §0)。
// 三個字族＝設計稿 §A1：Space Grotesk（拉丁主字）／Noto Sans TC（繁中）／IBM Plex Mono（kicker・數字・meta）。
const fontDisplay = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});
const fontMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});
const fontTc = Noto_Sans_TC({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-tc",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MeetCopilot",
};

/**
 * 首屏前套用主題，避免 FOUC（淺色是預設，所以只有選 dark 的人需要在 paint 前補屬性）。
 * 同步 inline script、跑在 <head>：讀 localStorage → 掛 `data-theme` 到 <html>。
 * key 與 AppShell 的 ThemeSwitch 共用（mc.theme）；storage 被停用時安靜退回預設淺色。
 */
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem("mc.theme");if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

interface LocaleLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

/**
 * Root layout (sole owner of html/body): only locale validation + NextIntlClientProvider.
 *
 * No app chrome (topbar/switcher/logout) here on purpose — /present must inherit ZERO copilot UI (I3).
 * Any shared chrome belongs in a nested route-group layout that deliberately excludes /present, /hud, /copilot.
 */
export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // Enable synchronous locale for Server Components below (next-intl static-render convention).
  setRequestLocale(locale);

  const messages = await getMessages();

  return (
    <html lang={locale}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className={`${fontDisplay.variable} ${fontMono.variable} ${fontTc.variable}`}>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
