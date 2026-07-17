import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { HomeDashboard } from "@/components/home/HomeDashboard";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "home" });
  return { title: t("metaTitle") };
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Home is now an authed dashboard inside AppShell (→ AuthGuard). Logged-out visitors are sent to /login.
  return (
    <AppShell>
      <HomeDashboard />
    </AppShell>
  );
}
