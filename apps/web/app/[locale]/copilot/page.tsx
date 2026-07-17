import { setRequestLocale } from "next-intl/server";
import { CockpitView } from "@/components/copilot/CockpitView";

/**
 * /copilot — in-meeting copilot cockpit (account B, Chrome/Edge desktop). Renders NO AppShell chrome
 * (no sidebar/topbar) on purpose: this surface is reached from the meeting flow, and this browser tab is
 * never screen-shared (I3 convention). The cockpit fuses the capture control and the live HUD suggestion
 * stream into one window (two WS to the same meeting); real capture pipeline + WS live in the client component.
 */
export default async function CopilotPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <CockpitView />;
}
