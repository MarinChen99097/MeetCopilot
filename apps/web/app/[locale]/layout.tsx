import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import "../globals.css";

// next/font (Next-bundled, no new dependency): display + mono variable fonts.
// CJK falls back naturally to --mc-font. Variables consumed by :root --mc-font-display/mono.
const fontDisplay = Geist({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const fontMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "MeetCopilot",
};

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
      <body className={`${fontDisplay.variable} ${fontMono.variable}`}>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
