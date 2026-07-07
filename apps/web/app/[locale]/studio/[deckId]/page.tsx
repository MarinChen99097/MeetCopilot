import { setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { SlideEditor } from "@/components/studio/SlideEditor";
import "../../../studio-present.css";

/** /studio/[deckId] — slide 編輯器（縮圖列 + 預覽 + blocks 屬性面板 + AI 生圖 + 匯出）。 */
export default async function DeckEditorPage({
  params,
}: {
  params: Promise<{ locale: string; deckId: string }>;
}) {
  const { locale, deckId } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <SlideEditor deckId={deckId} />
    </AppShell>
  );
}
