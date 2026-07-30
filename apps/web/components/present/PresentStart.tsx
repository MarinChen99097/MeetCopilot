"use client";

/**
 * PresentStart — `/present/start` 的「會議簡報」準備頁（掛 AppShell）。
 *
 * 為什麼存在（2026-07-28 決策 4）：側欄原本直接指裸 `/present`（不帶 deckId），而 PresentStage 沒有 deckId 必定
 * 落在「沒有可播放的簡報」終態——那個入口 100% 是死路，而且還先開一個新分頁才讓人撞牆。現在側欄指這裡：
 * 選一份簡報 → 看清楚要播哪份 → 按「播放」才**同分頁**進乾淨舞台 `/present`。
 *
 * I3：本檔**不 import 任何 HUD／副駕元件**（無 transcript / suggestion / info_card / signals / hud / copilot）。
 * 只有 deck 清單（listDecks）、會議憑證讀取（meeting-session，純 sessionStorage/URL 讀取，不是 HUD 內容）與
 * 既有通用元件。乾淨舞台 `/present` 本身仍不掛 AppShell。
 *
 * 導覽一律 `router.push`（同分頁）——絕不 `window.open`：會議簡報完全不開新分頁（使用者明示）。
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { DeckSummary } from "@meetcopilot/shared";
import { ApiError, listDecks } from "@/lib/api";
import { fmtRelative } from "@/lib/format";
import { Link, useRouter } from "@/i18n/navigation";
import { StateBoundary } from "@/components/ui/StateBoundary";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  buildPresentUrl,
  buildStaticPresentUrl,
  readMeetingCreds,
  type MeetingCreds,
} from "@/lib/meeting-session";

/**
 * 兩個 builder 回的是**絕對網址**（`${origin}/{locale}/present?…`），因為它們原本的用途是「開新分頁 / 貼到
 * 第二裝置」。本頁是同分頁導覽、用 next-intl 的 locale-aware `router.push`（它自己會補 `/{locale}` 前綴），
 * 所以這裡把絕對網址還原成 in-app 路徑。仍走 builder 而不自己拼 query，是為了讓 query 參數名稱只有一個真相
 * 來源（`/present` 吃 `token`、`/hud` 吃 `wsToken`，很容易寫錯）。
 */
function toInAppPath(absolute: string): string {
  try {
    const u = new URL(absolute);
    const segs = u.pathname.split("/").filter(Boolean); // ["zh-TW", "present"]
    return `/${segs.slice(1).join("/")}${u.search}`;
  } catch {
    return absolute; // 不該發生（builder 一律回絕對網址）；退回原字串總比 throw 好
  }
}

export function PresentStart() {
  const t = useTranslations("presentStart");
  const router = useRouter();

  const [items, setItems] = useState<DeckSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // 會議憑證（sessionStorage / URL）只存在於 client → 初值 null，掛載後才讀，避免 SSR/hydration 不一致。
  const [creds, setCreds] = useState<MeetingCreds | null>(null);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    listDecks()
      .then((res) => {
        if (!alive) return;
        setItems(res.items);
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof ApiError ? err.message : "load-failed");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => load(), [load]);

  useEffect(() => {
    setCreds(readMeetingCreds());
  }, []);

  // 預設選最近更新的那份（清單已由後端依 updatedAt 排序）——「選對象→按開始」的低門檻預設值。
  useEffect(() => {
    if (selected === null && items.length > 0 && items[0]) setSelected(items[0].id);
  }, [items, selected]);

  const deck = items.find((d) => d.id === selected) ?? null;

  const start = useCallback(
    (mode: "static" | "live") => {
      if (!deck) return;
      const absolute =
        mode === "live" && creds ? buildPresentUrl(deck.id, creds) : buildStaticPresentUrl(deck.id);
      router.push(toInAppPath(absolute));
    },
    [creds, deck, router],
  );

  return (
    <main className="mc-pstart">
      <header className="mc-pstart__head">
        <span className="mc-kicker mc-kicker--live">{t("kicker")}</span>
        <h1 className="mc-pstart__h1">{t("title")}</h1>
        <p className="mc-pstart__lead">{t("lead")}</p>
      </header>

      <StateBoundary
        loading={loading}
        error={error ? t("loadError") : null}
        isEmpty={items.length === 0}
        onRetry={load}
        skeleton={<GridSkeleton />}
        emptyTitle={t("emptyTitle")}
        emptyHint={t("emptyHint")}
        emptyAction={
          <Link href="/studio" className="mc-btn mc-btn--primary">
            {t("emptyCta")}
          </Link>
        }
      >
        <section className="mc-pstart__pick" aria-label={t("pickTitle")}>
          <h2 className="mc-pstart__h2">{t("pickTitle")}</h2>
          <ul className="mc-deckgrid">
            {items.map((d) => {
              const on = d.id === selected;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    className={`mc-deckcard${on ? " is-selected" : ""}`}
                    aria-pressed={on}
                    onClick={() => setSelected(d.id)}
                  >
                    <span className="mc-deckcard__title">{d.title}</span>
                    <span className="mc-deckcard__meta">
                      <StatusBadge tone={on ? "accent" : "muted"}>
                        {d.language === "zh-TW" ? "繁中" : "EN"}
                      </StatusBadge>
                      <span>{t("slides", { n: d.slideCount })}</span>
                    </span>
                    <span className="mc-deckcard__foot">{t("updated", { when: fmtRelative(d.updatedAt) })}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </StateBoundary>

      {deck ? (
        <section className="mc-pstart__launch" aria-label={t("launchTitle")}>
          <div className="mc-pstart__launch-id">
            <span className="mc-pstart__launch-label">{t("launchTitle")}</span>
            <p className="mc-pstart__launch-title">{deck.title}</p>
            <p className="mc-pstart__launch-meta">
              {t("slides", { n: deck.slideCount })} · {t("updated", { when: fmtRelative(deck.updatedAt) })}
            </p>
          </div>

          <div className="mc-pstart__launch-actions">
            <div className="mc-pstart__action">
              <button type="button" className="mc-btn mc-btn--primary" onClick={() => start("static")}>
                {t("playStatic")}
              </button>
              <p className="mc-pstart__action-hint">{t("playStaticHint")}</p>
            </div>

            <div className="mc-pstart__action">
              {/* 連線會議播放需要會議 session 憑證（POST /api/meetings 產出、由 MeetCopilot cockpit 建立）。
                  沒有憑證時停用並直接給出口，而不是讓人按下去才發現連不上。 */}
              <button
                type="button"
                className="mc-btn mc-btn--ghost"
                onClick={() => start("live")}
                disabled={!creds}
                title={creds ? undefined : t("noCreds")}
              >
                {t("playLive")}
              </button>
              <p className="mc-pstart__action-hint">
                {creds ? (
                  t("playLiveHint")
                ) : (
                  <>
                    {t("noCreds")}{" "}
                    <Link href="/copilot" className="mc-pstart__action-link">
                      {t("noCredsCta")}
                    </Link>
                  </>
                )}
              </p>
            </div>
          </div>

          <p className="mc-pstart__tip" role="note">
            {t("shareTip")}
          </p>
        </section>
      ) : null}
    </main>
  );
}

function GridSkeleton() {
  return (
    <ul className="mc-deckgrid" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i}>
          <div className="mc-deckcard mc-deckcard--skel">
            <div className="mc-skel__line" style={{ width: "70%" }} />
            <div className="mc-skel__line" style={{ width: "40%" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
