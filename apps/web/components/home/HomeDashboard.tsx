"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useMe } from "@/components/auth/AuthGuard";
import { Icon, type IconName } from "@/components/AppShell";
import { StateBoundary } from "@/components/ui/StateBoundary";
import { ApiError, getOrgUsage, listCompanies, listDecks, listMeetings, type MeetingRef } from "@/lib/api";
import { fmtUsd } from "@/lib/format";

/**
 * HomeDashboard —「今天」工作台（2026-07-30 全站重設計，INVENTORY §B1）。
 *
 * 版式：header（日期 kicker ＋ h1 ＋ lead ＋ 右側脈衝 primary CTA）
 *      → KPI 列 → 2 欄（左 1.6fr「今天的會議」面板／右 1fr 三張階段卡）。
 *
 * **2026-07-31（W4-wire）接上真資料**。後端**沒有**、也不打算開首頁彙總端點，故 KPI／議程一律由既有清單自湊：
 * - 今日議程／本週會議數 ← `GET /api/meetings?page=1&pageSize=50`（createdAt DESC）在前端依 createdAt 分桶。
 *   會議模型**沒有 scheduledAt**，createdAt 即建會時間——所以本面板誠實地叫「今天建立的會議」。
 * - 簡報數 ← `GET /api/decks` 的 total；公司數 ← `GET /api/crm/companies?pageSize=1` 的 total。
 * - 本月 AI 花費 ← `GET /api/org/usage`（**owner/admin only**）；member 連打都不打，該格直接不存在。
 *
 * **仍然刻意不渲染**：設計稿的「該講的都講到 %」「建議採用率 %」——後端沒有任何來源（checklist 命中率／
 * 建議採納數都不落庫），依契約不發明數字。四格 KPI 有幾格算幾格，載入失敗的格子直接消失（不顯示 0）。
 *
 * 2026-07-28：LIVE 兩個入口是**同分頁導覽**（不再 target=_blank）——「投影簡報」指向 app 內準備頁
 * /present/start（選 deck 後才進乾淨舞台 /present），「開會小幫手」指向 /copilot。乾淨舞台 /present
 * 與 /hud 本身仍不掛 AppShell（I3）。
 */
interface Surface {
  key: string;
  href: string;
  titleKey: string;
  descKey: string;
  icon: IconName;
}

interface Phase {
  key: string;
  tagKey: string;
  live?: boolean;
  titleKey: string;
  links: Surface[];
}

const PHASES: Phase[] = [
  {
    key: "pre",
    tagKey: "home.phasePreTag",
    titleKey: "home.phasePreTitle",
    links: [
      { key: "crm", href: "/crm", titleKey: "nav.itemCrm", descKey: "home.crmDesc", icon: "building" },
      { key: "studio", href: "/studio", titleKey: "nav.itemStudio", descKey: "home.studioDesc", icon: "slides" },
    ],
  },
  {
    key: "live",
    tagKey: "home.phaseLiveTag",
    live: true,
    titleKey: "home.phaseLiveTitle",
    links: [
      { key: "present", href: "/present/start", titleKey: "nav.itemPresent", descKey: "home.presentDesc", icon: "stage" },
      { key: "copilot", href: "/copilot", titleKey: "nav.itemCopilot", descKey: "home.copilotDesc", icon: "headset" },
    ],
  },
  {
    key: "drill",
    tagKey: "home.phaseDrillTag",
    titleKey: "home.phaseDrillTitle",
    links: [{ key: "train", href: "/train", titleKey: "nav.itemTrain", descKey: "home.trainDesc", icon: "mic" }],
  },
];

/** 第一頁抓幾筆會議（今日／本週都從這一頁篩；滿頁時 KPI 顯示「N+」而不硬算）。 */
const MEETINGS_PAGE = 50;

/** 本地時區的今日 00:00。 */
function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
/** 本地時區的本週一 00:00（zh-TW／en 皆以週一為週首，避免跨區歧義）。 */
function startOfWeek(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // 週一=0
  d.setDate(d.getDate() - dow);
  return d.getTime();
}
/** UTC 月初——與 server 的 budget 月窗同定義（usage-queries.OrgBudget）。 */
function startOfMonthUtc(): number {
  const n = new Date();
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1, 0, 0, 0, 0);
}

interface HomeStats {
  /** 今天建立、尚未結束的會議（createdAt DESC）。 */
  today: MeetingRef[];
  /** 今日清單是否可能被第一頁截斷（滿頁且整頁都落在今天）。 */
  todayCapped: boolean;
  weekCount: number;
  weekCapped: boolean;
}

export function HomeDashboard() {
  const t = useTranslations();
  const me = useMe();
  const name = me?.user.displayName ?? "";
  const isManager = me?.role === "owner" || me?.role === "admin";

  const [stats, setStats] = useState<HomeStats | null>(null);
  const [statsErr, setStatsErr] = useState<string | null>(null);
  // KPI：拿不到就是 null ⇒ 該格不渲染（絕不退回 0 假裝有資料）。
  const [deckCount, setDeckCount] = useState<number | null>(null);
  const [companyCount, setCompanyCount] = useState<number | null>(null);
  const [monthSpend, setMonthSpend] = useState<number | null>(null);
  const [kpiReady, setKpiReady] = useState(false);

  const loadMeetings = useCallback(() => {
    setStatsErr(null);
    setStats(null);
    listMeetings({ page: 1, pageSize: MEETINGS_PAGE })
      .then((res) => {
        const items = res.items ?? [];
        const dayFrom = startOfToday();
        const weekFrom = startOfWeek();
        const full = items.length >= MEETINGS_PAGE;
        const today = items.filter((m) => (m.createdAt ?? 0) >= dayFrom && m.status !== "completed");
        const week = items.filter((m) => (m.createdAt ?? 0) >= weekFrom);
        setStats({
          today,
          // 整頁都在今天 ⇒ 第一頁之外可能還有；否則這一頁已看到今天的邊界，數字是準的。
          todayCapped: full && items.every((m) => (m.createdAt ?? 0) >= dayFrom),
          weekCount: week.length,
          weekCapped: full && week.length === items.length,
        });
      })
      .catch((e) => setStatsErr(e instanceof ApiError ? e.message : "載入失敗"));
  }, []);

  useEffect(loadMeetings, [loadMeetings]);

  // KPI 三格分頭抓：任何一支失敗只讓那一格消失，不影響其它格與議程面板。
  useEffect(() => {
    let alive = true;
    // 每格一個 job：成功且元件還活著才寫 state、失敗一律吞掉（讓那一格消失）。
    // 回傳的 promise 永不 reject，所以下方 Promise.all 必定結算 → kpiReady 一定會被打開。
    const kpiJob = <T,>(p: Promise<T>, apply: (v: T) => void) =>
      p
        .then((v) => {
          if (alive) apply(v);
        })
        .catch(() => undefined);
    const jobs: Promise<unknown>[] = [
      kpiJob(listDecks(), (d) => setDeckCount(d.total)),
      kpiJob(listCompanies({ page: 1, pageSize: 1 }), (d) => setCompanyCount(d.total)),
    ];
    // 花費是 owner/admin only 的端點——member 直接不打（打了必 403，也不該看見這格）。
    if (isManager) {
      jobs.push(
        kpiJob(getOrgUsage({ from: startOfMonthUtc(), to: Date.now(), groupBy: "kind" }), (u) =>
          setMonthSpend(u.totalCostUsdPosttax),
        ),
      );
    }
    void Promise.all(jobs).then(() => {
      if (alive) setKpiReady(true);
    });
    return () => {
      alive = false;
    };
  }, [isManager]);

  return (
    <main className="mc-home">
      <header className="mc-home__head">
        <div className="mc-home__id">
          <TodayStamp />
          <h1 className="mc-home__h1">{me ? t("home.greeting", { name }) : t("home.greetingAnon")}</h1>
          <p className="mc-home__lead">{t("home.lead")}</p>
        </div>
        <Link href="/copilot" className="mc-btn mc-btn--primary mc-home__cta">
          <span className="mc-home__ctadot" aria-hidden="true" />
          {t("home.enterCopilot")}
        </Link>
      </header>

      {/* KPI：全部由既有清單端點自湊；拿不到的格子直接不存在（空態不留假數字）。 */}
      {kpiReady ? (
        <section className="mc-kpirow" aria-label={t("home.kpiSection")}>
          {stats ? (
            <Kpi
              label={t("home.kpiWeekMeetings")}
              value={`${stats.weekCount}${stats.weekCapped ? "+" : ""}`}
              sub={t("home.kpiWeekMeetingsSub")}
            />
          ) : null}
          {deckCount !== null ? (
            <Kpi label={t("home.kpiDecks")} value={String(deckCount)} sub={t("home.kpiAllTime")} />
          ) : null}
          {companyCount !== null ? (
            <Kpi label={t("home.kpiCompanies")} value={String(companyCount)} sub={t("home.kpiAllTime")} />
          ) : null}
          {monthSpend !== null ? (
            <Kpi label={t("home.kpiSpend")} value={fmtUsd(monthSpend)} sub={t("home.kpiSpendSub")} href="/spend" />
          ) : null}
        </section>
      ) : null}

      <section className="mc-home__grid" aria-label={t("home.surfaces")}>
        <div className="mc-panel">
          <div className="mc-panel__head">
            <span className="mc-kicker">{t("home.agendaTitle")}</span>
            {stats && stats.today.length > 0 ? (
              <span className="mc-panel__headmeta">
                {t("home.agendaCount", { n: `${stats.today.length}${stats.todayCapped ? "+" : ""}` })}
              </span>
            ) : null}
          </div>
          <div className="mc-panel__body">
            <StateBoundary
              loading={stats === null && !statsErr}
              error={statsErr}
              isEmpty={stats !== null && stats.today.length === 0}
              onRetry={loadMeetings}
              emptyTitle={t("home.agendaEmptyTitle")}
              emptyHint={t("home.agendaEmptyHint")}
              emptyAction={
                <Link href="/copilot" className="mc-btn mc-btn--primary">
                  {t("home.agendaStart")}
                </Link>
              }
            >
              <ul className="mc-agenda" role="list">
                {(stats?.today ?? []).map((m) => (
                  <AgendaRow key={m.id} meeting={m} />
                ))}
              </ul>
              <div className="mc-agenda__foot">
                <Link href="/copilot" className="mc-btn mc-btn--sm">
                  {t("home.agendaStart")}
                </Link>
              </div>
            </StateBoundary>
          </div>
        </div>

        <div className="mc-home__phases">
          {PHASES.map((phase) => (
            <article key={phase.key} className="mc-phasecard">
              <span className="mc-phasecard__head">
                <span className={`mc-kicker${phase.live ? " mc-kicker--live" : ""}`}>{t(phase.tagKey)}</span>
                <span className="mc-phasecard__title">{t(phase.titleKey)}</span>
              </span>
              {phase.links.map((s) => (
                <SurfaceLink key={s.key} surface={s} />
              ))}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

/**
 * 日期 kicker。**只在掛載後才算**——日期是使用者本地時區的東西，在 server 算會跟 client 對不上
 * （AppShell 目前 client-only，但這條規矩不該靠上游巧合成立）。
 */
function TodayStamp() {
  const locale = useLocale();
  const [stamp, setStamp] = useState("");

  useEffect(() => {
    setStamp(
      new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
      }).format(new Date()),
    );
  }, [locale]);

  return (
    <span className="mc-kicker mc-kicker--page" suppressHydrationWarning>
      {stamp}
    </span>
  );
}

/**
 * 單格 KPI。`href` 有給就整格可點（本月花費 → /spend）。
 * 只在呼叫端拿到真值時才會被渲染——本元件不做任何「無資料退回 0」的兜底。
 */
function Kpi({ label, value, sub, href }: { label: string; value: string; sub?: string; href?: string }) {
  const inner = (
    <>
      <span className="mc-kpi__label">{label}</span>
      <span className="mc-kpi__value">{value}</span>
      {sub ? <span className="mc-kpi__sub">{sub}</span> : null}
    </>
  );
  return href ? (
    <Link href={href} className="mc-kpi mc-kpi--link">
      {inner}
    </Link>
  ) : (
    <div className="mc-kpi">{inner}</div>
  );
}

/** meetings.status（005 CHECK）→ badge 樣式；未知值不上色，原樣顯示。 */
const STATUS_TONE: Record<string, string> = {
  scheduled: "mc-badge--accent",
  canceled: "mc-badge--muted",
  no_show: "mc-badge--warn",
  completed: "mc-badge--ok",
};

function AgendaRow({ meeting }: { meeting: MeetingRef }) {
  const t = useTranslations();
  const locale = useLocale();
  const status = meeting.status ?? "";
  // 只有契約已知的四個 status 有譯文；未知值原樣顯示（不硬塞 key，也不吞掉）。
  const statusLabel = status in STATUS_TONE ? t(`home.status.${status}`) : status;
  const time = meeting.createdAt
    ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(meeting.createdAt))
    : "";

  return (
    <li className="mc-agenda__row">
      <span className="mc-agenda__time">{time || "—"}</span>
      <span className="mc-agenda__main">
        <span className="mc-agenda__title">{meeting.title || t("home.agendaUntitled")}</span>
        {/* objective 是使用者自己填的本場目標；沒填就不佔行（不編一句假的）。 */}
        {meeting.objective ? <span className="mc-agenda__obj">{meeting.objective}</span> : null}
      </span>
      {status ? (
        <span className={`mc-badge ${STATUS_TONE[status] ?? "mc-badge--muted"}`}>{statusLabel}</span>
      ) : null}
    </li>
  );
}

function SurfaceLink({ surface }: { surface: Surface }) {
  const t = useTranslations();
  return (
    <Link href={surface.href} className="mc-navlink">
      <span className="mc-navlink__icon">
        <Icon name={surface.icon} size={16} />
      </span>
      <span className="mc-navlink__main">
        <span className="mc-navlink__title">{t(surface.titleKey)}</span>
        <span className="mc-navlink__desc">{t(surface.descKey)}</span>
      </span>
      <span className="mc-navlink__chev" aria-hidden="true">
        ›
      </span>
    </Link>
  );
}
