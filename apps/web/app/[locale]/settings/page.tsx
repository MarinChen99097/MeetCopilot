import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

/**
 * /settings — index redirect (P1-2). `/settings` had no page and fell through to the default 404;
 * send it to the only settings surface that exists (team). Locale-prefixed to satisfy `localePrefix:"always"`.
 */
export default async function SettingsIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  redirect(`/${locale}/settings/team`);
}
