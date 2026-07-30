import { setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { PresentStart } from "@/components/present/PresentStart";
import "../../../studio-present.css";

/**
 * /present/start — 「會議簡報」準備頁（2026-07-28 決策 4）。**掛 AppShell**：這是 app 內的頁面，不會被分享。
 *
 * 側欄「會議簡報」指向這裡（不再指裸 `/present`——那沒有 deckId，必定落在「沒有可播放的簡報」死路）。
 * 這裡選好 deck 後才**同分頁**導覽到乾淨舞台 `/present?deckId=…`；`/present` 本身**絕不**掛 AppShell（I3）。
 */
export default async function PresentStartPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <PresentStart />
    </AppShell>
  );
}
