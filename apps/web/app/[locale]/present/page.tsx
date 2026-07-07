import { getTranslations, setRequestLocale } from "next-intl/server";

/**
 * /present — the shared stage (I3). This surface is what account A screen-shares, so its rendered
 * output must contain ZERO copilot vocabulary (no HUD, suggestion, transcript, or card elements).
 * M0: a neutral, empty slide stage. Real slide rendering + silent `deck_update` append land in M2.
 */
export default async function PresentPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("present");
  return (
    <main className="mc-stage">
      <p>{t("desc")}</p>
    </main>
  );
}
