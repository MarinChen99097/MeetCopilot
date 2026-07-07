import { setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { TeamSettingsView } from "@/components/settings/TeamSettingsView";

/** /settings/team — 邀請制成員管理（M5 §D，決策 20：無計費）。owner/admin 才可操作。 */
export default async function TeamSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <TeamSettingsView />
    </AppShell>
  );
}
