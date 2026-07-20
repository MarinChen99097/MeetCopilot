import { setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { MeetingSimulator } from "@/components/sim/MeetingSimulator";
import "../../studio-present.css";

/**
 * /sim — 會議模擬器（測試工具，導覽「測試」群組可見，不隱藏）。
 * 匯入音檔模擬會議進行，端到端驗 DynamicSlide 依對話把補充頁 append 到簡報尾端。
 * studio-present.css：SlideRenderer 的 .slide 版型樣式（縮圖列/預覽需要）。
 */
export default async function SimPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <MeetingSimulator />
    </AppShell>
  );
}
