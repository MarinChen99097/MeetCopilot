import { setRequestLocale } from "next-intl/server";
import { CopilotView } from "@/components/copilot/CopilotView";

/**
 * /copilot — listener/capture surface (account B, Chrome/Edge desktop). Renders NO app chrome
 * (no topbar) on purpose: this surface is reached from the meeting flow, and this browser tab is
 * never screen-shared. Real capture pipeline + WS live in the client component.
 */
export default async function CopilotPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <CopilotView />;
}
