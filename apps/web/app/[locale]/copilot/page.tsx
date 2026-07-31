import { setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { CockpitView } from "@/components/copilot/CockpitView";
// I2 批准卡的「補充頁建議」用 SlideRenderer 畫真縮圖 → 需要 slide 的樣式表（`.slide*` 只在這支 CSS 裡）。
import "../../studio-present.css";

/**
 * /copilot — in-meeting copilot cockpit (account B, Chrome/Edge desktop). The cockpit fuses the capture
 * control and the live HUD suggestion stream into one window (two WS to the same meeting); real capture
 * pipeline + WS live in the client component.
 *
 * 2026-07-28 決策：本頁**掛 AppShell**（側欄）——這個分頁在帳號 B、**永不被螢幕分享**，所以掛 app chrome
 * 不觸及 I3；掛上後才有回 App 的路徑（原本開新分頁進來是條單向死巷）。
 * 對比：`/present`（會被分享進 Meet）與 `/hud`（第二裝置鏡像）**絕不**掛 AppShell——I3 的機械保證。
 */
export default async function CopilotPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <CockpitView />
    </AppShell>
  );
}
