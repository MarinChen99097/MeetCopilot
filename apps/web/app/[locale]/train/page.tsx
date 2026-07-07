import { setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { TrainWorkbench } from "@/components/train/TrainWorkbench";

/** /train — 語音模擬訓練（M4b，決策 20：成品）。persona 選擇 → 語音對練 → 課後評分。 */
export default async function TrainPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <TrainWorkbench />
    </AppShell>
  );
}
