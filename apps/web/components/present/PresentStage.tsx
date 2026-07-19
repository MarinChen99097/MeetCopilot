"use client";

/**
 * PresentStage — /present 播放視圖（帳號 A 分享進 Meet 的乾淨舞台）。
 *
 * ⚠️ 不變量 I3（HUD 絕不外流）：本檔**只**渲染投影片 + 頁碼 + 一個極不顯眼的連線圓點。
 * 嚴禁 import 任何副駕元素（transcript / suggestion / info_card / signals / hud / copilot）。
 * 允許 import：SlideRenderer（純渲染）、lib/api（getDeck / API_BASE）、lib/ws（connect）、@meetcopilot/shared 型別、
 *   next-intl（useTranslations，僅文案）、@/i18n/navigation（Link，僅 locale-aware 導覽——非 HUD、且只在「無投影片可播」的終態顯示）。
 *   → 這份 import 清單即 I3 的機械保證；擴充前務必確認新增 import 不含 HUD 詞彙（transcript/suggestion/signals/copilot…）。
 *
 * 不變量：I1（deck 只從尾端 APPEND 長出，deck_update 靜默接尾）、I2（只有已批准內容才會經 deck_update 抵達）。
 *
 * 連線（可選）：帶 meetingId + token 時開 present-role WS——翻頁上報 page_commit（committedIndex 單調遞增）、
 * 收 deck_update 靜默 append、收 session_state 對齊頁碼。無 session 憑證時＝純本地播放（鍵盤翻頁仍可用）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ServerMessage, SlideSpec } from "@meetcopilot/shared";
import { API_BASE, getDeck } from "@/lib/api";
import { connect, type WsConnection } from "@/lib/ws";
import { Link } from "@/i18n/navigation";
import { SlideRenderer } from "@/components/slide/SlideRenderer";

type LinkState = "off" | "connecting" | "open" | "reconnecting" | "failed";

export interface PresentStageProps {
  deckId?: string;
  meetingId?: string;
  token?: string;
}

const RECONNECT_MS = 2000;
const RECONNECT_MAX_MS = 15000;
const MAX_RECONNECT_ATTEMPTS = 10;
// getDeck 無內建 timeout：後端久候不回時避免無限 spinner，超過此上限即視同載入失敗。
const LOAD_TIMEOUT_MS = 12000;
/**
 * 原始頁簽章 URL 續簽間隔（缺陷 4）。原始頁 <img> 的簽章有 TTL（server 預設 8h）；長會議若 WS 整場不重連，
 * 就不會觸發既有的 reconnect refetch → 逾時後原始頁 403 破圖。故 deck 有原始頁時每 30 分鐘（<< TTL）靜默續簽。
 */
const ASSET_URL_REFRESH_MS = 30 * 60_000;

export function PresentStage({ deckId, meetingId, token }: PresentStageProps) {
  const t = useTranslations("present");
  const [slides, setSlides] = useState<SlideSpec[]>([]);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [link, setLink] = useState<LinkState>("off");
  const [reloadKey, setReloadKey] = useState(0); // 重試：bump 後重跑 deck 載入 effect。
  const [wsNonce, setWsNonce] = useState(0); // 連線重試：bump 後重跑 WS effect（重置重連預算）。
  const [hasOriginals, setHasOriginals] = useState(false); // deck 有原始頁（簽章 URL）→ 啟用週期性續簽。

  // committedIndex：本地已播出的最高頁（送 page_commit 用；單調遞增，只增不減）。
  const committed = useRef(-1);
  const conn = useRef<WsConnection | null>(null);
  const retry = useRef<number | null>(null);
  const closed = useRef(false);

  // ── 載入 deck（即使沒有 WS 也可純本地播放）────────────────
  useEffect(() => {
    if (!deckId) {
      setLoaded(true);
      return;
    }
    let alive = true;
    // 載入上限：後端久候不回時，逾時視同失敗（避免 spinner 無限轉）。
    const timer = window.setTimeout(() => {
      if (!alive) return;
      setFailed(true);
      setLoaded(true);
    }, LOAD_TIMEOUT_MS);
    getDeck(deckId)
      .then((view) => {
        if (!alive) return;
        window.clearTimeout(timer);
        setSlides(view.slides);
        committed.current = view.deck.committedIndex;
        setHasOriginals(view.deck.originalCount > 0); // 有原始頁才需週期性續簽
        setFailed(false); // 逾時後才回來的成功也能復原
        setLoaded(true);
      })
      .catch(() => {
        if (!alive) return;
        window.clearTimeout(timer);
        setFailed(true);
        setLoaded(true);
      });
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [deckId, reloadKey]);

  // 重試：清掉失敗/載入旗標並重跑上面的 effect（回退 spinner→重抓 deck）。
  const retryLoad = useCallback(() => {
    setFailed(false);
    setLoaded(false);
    setReloadKey((k) => k + 1);
  }, []);

  // 續簽 backstop（缺陷 4）：deck 有原始頁時，長會議期間每 30 分鐘（<< TTL）靜默 getDeck 換新簽章 URL，
  // 避免 WS 整場不重連（不觸發既有 reconnect refetch）時原始頁 <img> 逾時 403 破圖。committedIndex 只增不減、不跳頁。
  useEffect(() => {
    if (!deckId || !hasOriginals) return;
    const id = window.setInterval(() => {
      getDeck(deckId)
        .then((view) => {
          setSlides(view.slides); // 服務端為權威全量（含已批准 append）；重抓＝換新簽章，不改頁序
          if (view.deck.committedIndex > committed.current) committed.current = view.deck.committedIndex;
        })
        .catch(() => {
          // 續簽暫時性失敗：留給下一輪（既有 WS reconnect refetch 亦為後援）。
        });
    }, ASSET_URL_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [deckId, hasOriginals]);

  const total = slides.length;

  // ── page_commit：翻到新頁時上報（單調遞增；重播舊頁不重送）────
  const commitPage = useCallback((i: number) => {
    if (i <= committed.current) return;
    committed.current = i;
    conn.current?.send({ type: "page_commit", index: i });
  }, []);

  const go = useCallback(
    (next: number) => {
      setIndex((cur) => {
        const clamped = Math.max(0, Math.min(next, Math.max(0, total - 1)));
        if (clamped > cur) commitPage(clamped);
        return clamped;
      });
    },
    [commitPage, total],
  );

  // ── 鍵盤翻頁（→/Space/PageDown 前進；←/PageUp 後退）─────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
        case " ":
          e.preventDefault();
          go(index + 1);
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          go(index - 1);
          break;
        case "Home":
          e.preventDefault();
          go(0);
          break;
        case "End":
          e.preventDefault();
          go(total - 1);
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index, total]);

  // ── 伺服器訊息（present 角色僅消費 deck_update / session_state / error）──
  const onMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "deck_update":
        // I1：靜默把新頁接到 deck 尾端，不打斷當前播放、不彈任何 UI。
        setSlides((prev) => [...prev, msg.op.slide]);
        break;
      case "session_state":
        // 重連對齊：committedIndex 只用來校準本地已播上限，不強制跳頁（避免打斷）。
        if (msg.committedIndex > committed.current) committed.current = msg.committedIndex;
        break;
      default:
        // transcript / signals / info_card / suggestion / research_status 等 HUD 訊息在 present 不該出現；
        // 即使收到也一律忽略，永不渲染到舞台（I3 的執行期防線）。
        break;
    }
  }, []);

  // ── WS 連線（帶 session 憑證才開；真・斷線自動重連）────────────
  // 用 lib/ws 的 lifecycle 回呼反映真實 socket 狀態：onOpen→綠點+重送 hello+重抓 deck（補齊斷線期間 append 的頁，
  // 避免翻過舊尾端而空白）；onClose→退回 reconnecting 圓點並以退避重連（有上限，避免無限迴圈）。
  useEffect(() => {
    if (!meetingId || !token) {
      setLink("off");
      return;
    }
    closed.current = false;
    let attempts = 0;

    // (重)連上就重抓整份 deck，把斷線期間漏收的 deck_update（尾端 append）補齊；committedIndex 只增不減。
    const refetchDeck = () => {
      if (!deckId) return;
      getDeck(deckId)
        .then((view) => {
          if (closed.current) return;
          setSlides(view.slides);
          if (view.deck.committedIndex > committed.current) committed.current = view.deck.committedIndex;
        })
        .catch(() => {});
    };

    const scheduleReconnect = () => {
      if (closed.current || retry.current !== null) return;
      if (attempts >= MAX_RECONNECT_ATTEMPTS) {
        // 自動重連預算耗盡 → 進終態「連線失敗」，等待面板給使用者「重新連線」按鈕（不無限靜默重連）。
        setLink("failed");
        return;
      }
      const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_MS * 2 ** attempts);
      attempts += 1;
      retry.current = window.setTimeout(() => {
        retry.current = null;
        open();
      }, backoff);
    };

    const open = () => {
      if (closed.current) return;
      setLink((s) => (s === "off" ? "connecting" : "reconnecting"));
      const c = connect(API_BASE, token, meetingId, "present", {
        onOpen: () => {
          if (closed.current) return;
          attempts = 0;
          setLink("open");
          c.send({ type: "hello", role: "present" });
          refetchDeck();
        },
        onClose: (ev) => {
          if (closed.current || conn.current !== c) return;
          conn.current = null;
          // 憑證無效 / 握手錯誤（4001/4000）＝重試也不會成功 → 立即終態，別耗盡重連預算。
          const code = ev?.code ?? 1006;
          if (code === 4001 || code === 4000) {
            setLink("failed");
            return;
          }
          setLink("reconnecting");
          scheduleReconnect();
        },
        // onError 之後瀏覽器必接著發 close → 交給 onClose 統一處理重連。
        onError: () => {},
      });
      conn.current = c;
      c.on(onMessage);
    };

    open();

    return () => {
      closed.current = true;
      if (retry.current !== null) {
        window.clearTimeout(retry.current);
        retry.current = null;
      }
      conn.current?.close();
      conn.current = null;
    };
  }, [meetingId, token, deckId, onMessage, wsNonce]);

  // 連線重試（終態「連線失敗」後）：重置重連預算並重跑 WS effect。
  const retryWs = useCallback(() => {
    setLink("connecting");
    setWsNonce((n) => n + 1);
  }, []);

  // ── render：極簡舞台（僅投影片 + 頁碼 + 連線圓點）──────────
  // 載入中（deck 抓取進行中；已有 LOAD_TIMEOUT_MS 上限，不會無限轉）。
  if (!loaded) {
    return (
      <main className="mc-present mc-present--loading" aria-busy="true">
        <div className="mc-present__spinner" aria-label={t("loading")} />
      </main>
    );
  }

  const current = slides[index];
  // 有 session 憑證＝live 分享：投影片可能還會經 WS deck_update 陸續抵達，空舞台＝「即將開始」而非死路。
  const isLive = Boolean(meetingId && token);

  // 無投影片可播：依情境給明確終態，取代會誤導的「載入中…」。
  // 這些畫面只在「無內容可播」時出現，不含任何副駕元素；回 App 鈕在真正播放（有投影片）時永不顯示（I3）。
  if (!current) {
    if (failed) {
      return (
        <main className="mc-present">
          <div className="mc-present__stage">
            <div className="mc-present__notice" role="alert">
              <p className="mc-present__notice-title">{t("failedTitle")}</p>
              <p className="mc-present__notice-desc">{t("failedDesc")}</p>
              <div className="mc-present__notice-actions">
                {deckId ? (
                  <button type="button" className="mc-btn mc-btn--ghost" onClick={retryLoad}>
                    {t("retry")}
                  </button>
                ) : null}
                <Link href="/" className="mc-btn mc-btn--primary">
                  {t("backHome")}
                </Link>
              </div>
            </div>
          </div>
        </main>
      );
    }
    if (isLive) {
      // 連線終態失敗：中性「連線中斷 + 重新連線」（I3：純連線狀態，無任何副駕元素）。
      if (link === "failed") {
        return (
          <main className="mc-present">
            <div className="mc-present__stage">
              <div className="mc-present__notice" role="alert">
                <p className="mc-present__notice-title">{t("connFailedTitle")}</p>
                <p className="mc-present__notice-desc">{t("connFailedDesc")}</p>
                <div className="mc-present__notice-actions">
                  <button type="button" className="mc-btn mc-btn--primary" onClick={retryWs}>
                    {t("connRetry")}
                  </button>
                </div>
              </div>
            </div>
          </main>
        );
      }
      // 合法觀眾在等報告者推第一頁：連上前顯示「連線中…」，連上後顯示友善等待（守 I3、也不像壞掉）。
      const connecting = link !== "open";
      return (
        <main className="mc-present">
          <div className="mc-present__stage">
            <div className="mc-present__empty" role="status">
              <span
                className={`mc-present__waitdot mc-present__waitdot--${connecting ? "connecting" : "open"}`}
                aria-hidden="true"
              />
              {connecting ? t("connConnecting") : t("waiting")}
            </div>
          </div>
        </main>
      );
    }
    // 沒帶 deck、或 deck 為空且非 live：死路→給出口。
    return (
      <main className="mc-present">
        <div className="mc-present__stage">
          <div className="mc-present__notice" role="status">
            <p className="mc-present__notice-title">{t("emptyTitle")}</p>
            <p className="mc-present__notice-desc">{t("emptyDesc")}</p>
            <div className="mc-present__notice-actions">
              <Link href="/" className="mc-btn mc-btn--primary">
                {t("backHome")}
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mc-present">
      <div className="mc-present__stage">
        <SlideRenderer slide={current} size="full" />
      </div>

      {total > 0 ? (
        <div className="mc-present__pageno" aria-hidden="true">
          {link !== "off" ? <span className={`mc-present__dot mc-present__dot--${link}`} /> : null}
          <span>
            {index + 1} / {total}
          </span>
        </div>
      ) : null}
    </main>
  );
}
