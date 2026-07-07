import { setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { StudioView } from "@/components/studio/StudioView";
import "../../studio-present.css";

/** /studio — DynamicSlide 簡報工作室（決策 20：成品）。deck 清單 → 三段 wizard / 匯入 → 編輯器。 */
export default async function StudioPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <StudioView />
    </AppShell>
  );
}
