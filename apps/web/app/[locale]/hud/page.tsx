import { setRequestLocale } from "next-intl/server";
import { HudView } from "@/components/hud/HudView";

/**
 * /hud — presenter HUD on a second device (mobile-portrait first). Renders NO app chrome (I3):
 * it only ever lives on the rep's own device and is never captured/shared. Live streams + approval
 * queue run in the client component over the typed WS layer.
 */
export default async function HudPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HudView />;
}
