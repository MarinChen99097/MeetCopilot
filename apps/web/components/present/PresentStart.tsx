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
      {/* 頁首走 globals.css 的 .mc-pagehead 版式（studio-present.css 的舊 `.mc-pstart__head`/`__h1`
          已隨本次清理刪除，此處不再有第二套可選）。 */}
      <header className="mc-pagehead">
        <div className="mc-pagehead__id">
          <span className="mc-kicker mc-kicker--page">{t("kicker")}</span>
          <h1 className="mc-pagehead__h1">{t("title")}</h1>
          <p className="mc-pagehead__lead">{t("lead")}</p>
        </div>
      </header>

      <section className="mc-pstart__grid">
        <div className="mc-pstart__pick">
          <span className="mc-kicker">{t("pickTitle")}</span>
          <StateBoundary
            loading={loading}
            error={error ? t("loadError") : null}
            isEmpty={items.length === 0}
            onRetry={load}
            skeleton={<ListSkeleton />}
            emptyTitle={t("emptyTitle")}
            emptyHint={t("emptyHint")}
            emptyAction={
              <Link href="/studio" className="mc-btn mc-btn--primary">
                {t("emptyCta")}
              </Link>
            }
          >
            <ul className="mc-decklist">
              {items.map((d) => {
                const on = d.id === selected;
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      className={`mc-deckrow${on ? " is-selected" : ""}`}
                      aria-pressed={on}
                      onClick={() => setSelected(d.id)}
                    >
                      {/* 縮圖佔位：後端無 deck 封面圖 → 用頁數的 mono 標記，不放假縮圖。 */}
                      <span className="mc-deckrow__thumb mc-mono" aria-hidden="true">
                        {t("slides", { n: d.slideCount })}
                      </span>
                      <span className="mc-deckrow__id">
                        <span className="mc-deckrow__title">{d.title}</span>
                        <span className="mc-deckrow__meta">
                          {d.language === "zh-TW" ? "繁中" : "EN"} · {t("updated", { when: fmtRelative(d.updatedAt) })}
                        </span>
                      </span>
                      <span className="mc-deckrow__mark mc-mono">{on ? t("picked") : t("pick")}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </StateBoundary>
        </div>

        {/* 右欄啟動卡。設計稿的「開始前確認三件事」preflight 需要後端沒有的就緒欄位
            （收音狀態／手機已連上／要講的事已備好，INVENTORY §D1）→ 不編假勾選，
            只保留真正存在的判斷：有沒有進行中的會議 session（決定能不能連線播放）。
            兩條播放路徑（單機／連線）是既有能力，設計稿把它收斂成一顆鈕，實作**保留兩條**。 */}
        <aside className="mc-launchcard" aria-label={t("launchTitle")}>
          <span className="mc-kicker">{t("launchTitle")}</span>
          {deck ? (
            <>
              <div className="mc-launchcard__deck">
                <span className="mc-launchcard__title">{deck.title}</span>
                <span className="mc-launchcard__meta mc-mono">
                  {t("slides", { n: deck.slideCount })} · {t("updated", { when: fmtRelative(deck.updatedAt) })}
                </span>
              </div>

              <button type="button" className="mc-btn mc-btn--primary mc-launchcard__go" onClick={() => start("static")}>
                {t("playStatic")}
              </button>
              <p className="mc-launchcard__hint">{t("playStaticHint")}</p>

              <div className="mc-launchcard__alt">
                <button
                  type="button"
                  className="mc-btn mc-btn--ghost"
                  onClick={() => start("live")}
                  disabled={!creds}
                  title={creds ? undefined : t("noCreds")}
                >
                  {t("playLive")}
                </button>
                <p className="mc-launchcard__hint">
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
            </>
          ) : (
            <p className="mc-launchcard__hint">{t("pickTitle")}</p>
          )}

          <p className="mc-launchcard__keys" role="note">
            {t("shareTip")}
          </p>
        </aside>
      </section>
    </main>
  );
}

function ListSkeleton() {
  return (
    <ul className="mc-decklist" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <li key={i}>
          <div className="mc-deckrow mc-deckrow--skel">
            <div className="mc-deckrow__thumb" />
            <div className="mc-deckrow__id">
              <div className="mc-skel__line" style={{ width: "60%" }} />
              <div className="mc-skel__line" style={{ width: "35%" }} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
