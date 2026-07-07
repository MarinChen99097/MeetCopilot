import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

const SURFACES = ["crm", "studio", "present", "copilot", "hud", "train"] as const;

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const tSurface = await getTranslations();

  return (
    <main className="mc-placeholder">
      <h1>{t("title")}</h1>
      <p>{t("subtitle")}</p>
      <nav className="mc-nav" aria-label={t("surfaces")}>
        {SURFACES.map((s) => (
          <Link key={s} href={`/${s}`}>
            {tSurface(`${s}.title`)}
          </Link>
        ))}
      </nav>
    </main>
  );
}
