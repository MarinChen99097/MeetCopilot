"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useMe } from "@/components/auth/AuthGuard";
import { Icon, type IconName } from "@/components/AppShell";

/**
 * HomeDashboard — the authed workspace landing. Renders a three-phase "meeting flow" (PRE → LIVE → DRILL)
 * where each phase links to its consumer surfaces. The single flow-rail pulse is the only animation.
 *
 * 2026-07-28：LIVE 兩張卡與側欄同步改為**同分頁導覽**（不再 target=_blank／↗）——「會議簡報」指向 app 內準備頁
 * /present/start（選 deck 後才進乾淨舞台 /present），「MeetCopilot」指向 /copilot cockpit。乾淨舞台 /present
 * 與 /hud 本身仍不掛 AppShell（I3）。
 */
interface Surface {
  key: string;
  href: string;
  titleKey: string;
  descKey: string;
  icon: IconName;
}

const PRE: Surface[] = [
  { key: "crm", href: "/crm", titleKey: "crm.title", descKey: "home.crmDesc", icon: "building" },
  { key: "studio", href: "/studio", titleKey: "studio.title", descKey: "home.studioDesc", icon: "slides" },
];
const LIVE: Surface[] = [
  { key: "present", href: "/present/start", titleKey: "nav.present", descKey: "home.presentDesc", icon: "stage" },
  { key: "copilot", href: "/copilot", titleKey: "nav.copilot", descKey: "home.copilotDesc", icon: "headset" },
];
const DRILL: Surface[] = [
  { key: "train", href: "/train", titleKey: "train.title", descKey: "home.trainDesc", icon: "mic" },
];

export function HomeDashboard() {
  const t = useTranslations();
  const me = useMe();
  const name = me?.user.displayName ?? "";

  return (
    <main className="mc-home">
      <header className="mc-home__hero">
        <span className="mc-kicker mc-kicker--live">MEETCOPILOT WORKSPACE</span>
        <h1>{me ? t("home.greeting", { name }) : t("home.greetingAnon")}</h1>
        <p className="mc-home__lead">{t("home.lead")}</p>
      </header>

      <section className="mc-flow" aria-label={t("home.surfaces")}>
        <div className="mc-flow__rail">
          <span className="mc-flow__pulse" />
        </div>

        <article className="mc-phase">
          <span className="mc-phase__tag">PRE</span>
          <h2 className="mc-phase__title">{t("home.phasePreTitle")}</h2>
          <p className="mc-phase__desc">{t("home.phasePreDesc")}</p>
          <div className="mc-phase__cards">
            {PRE.map((s) => (
              <SurfaceCard key={s.key} surface={s} />
            ))}
          </div>
        </article>

        <article className="mc-phase mc-phase--live">
          <span className="mc-phase__tag">LIVE</span>
          <h2 className="mc-phase__title">{t("home.phaseLiveTitle")}</h2>
          <p className="mc-phase__desc">{t("home.phaseLiveDesc")}</p>
          <div className="mc-phase__cards">
            {LIVE.map((s) => (
              <SurfaceCard key={s.key} surface={s} />
            ))}
          </div>
          <p className="mc-phase__note">{t("home.liveNote")}</p>
        </article>

        <article className="mc-phase">
          <span className="mc-phase__tag">DRILL</span>
          <h2 className="mc-phase__title">{t("home.phaseDrillTitle")}</h2>
          <p className="mc-phase__desc">{t("home.phaseDrillDesc")}</p>
          <div className="mc-phase__cards">
            {DRILL.map((s) => (
              <SurfaceCard key={s.key} surface={s} />
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}

function SurfaceCard({ surface }: { surface: Surface }) {
  const t = useTranslations();
  return (
    <Link href={surface.href} className="mc-surfacecard">
      <span className="mc-surfacecard__icon">
        <Icon name={surface.icon} size={20} />
      </span>
      <span className="mc-surfacecard__main">
        <span className="mc-surfacecard__title">{t(surface.titleKey)}</span>
        <span className="mc-surfacecard__desc">{t(surface.descKey)}</span>
      </span>
      <span className="mc-surfacecard__chev" aria-hidden="true">
        ›
      </span>
    </Link>
  );
}
