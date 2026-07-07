import { defineRouting } from "next-intl/routing";

/**
 * i18n routing (single source of truth). `locales` order = display order.
 * Default zh-TW (UI language ≠ content language, per ARCHITECTURE §1). Secondary en.
 */
export const LOCALES = ["zh-TW", "en"] as const;
export type AppLocale = (typeof LOCALES)[number];

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: "zh-TW",
  localePrefix: "always",
  localeDetection: true,
});
