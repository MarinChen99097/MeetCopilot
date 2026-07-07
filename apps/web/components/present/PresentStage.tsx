"use client";

/**
 * PresentStage — /present 播放視圖（帳號 A 分享進 Meet 的乾淨舞台）。
 *
 * ⚠️ 不變量 I3（HUD 絕不外流）：本檔**只**渲染投影片 + 頁碼 + 一個極不顯眼的連線圓點。
 * 嚴禁 import 任何副駕元素（transcript / suggestion / info_card / signals / hud / copilot）。
 * 允許 import：SlideRenderer（純渲染）、lib/api（getDeck / API_BASE）、lib/ws（connect）、@meetcopilot/shared 型別。
 *   → 這份 import 清單即 I3 的機械保證；擴充前務必確認新增 import 不含 HUD 詞彙。
 *
 * 不變量：I1（deck 只從尾端 APPEND 長出，deck_update 靜默接尾）、I2（只有已批准內容才會經 deck_update 抵達）。
 *
 * 連線（可選）：帶 meetingId + token 時開 present-role WS——翻頁上報 page_commit（committedIndex 單調遞增）、
 * 收 deck_update 靜默 append、收 session_state 對齊頁碼。無 session 憑證時＝純本地播放（鍵盤翻頁仍可用）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerMessage, SlideSpec } from "@meetcopilot/shared";
import { API_BASE, getDeck } from "@/lib/api";
import { connect, type WsConnection } from "@/lib/ws";
import { SlideRenderer } from "@/components/slide/SlideRenderer";

type LinkState = "off" | "connecting" | "open" | "reconnecting";

export interface PresentStageProps {
  deckId?: string;
  meetingId?: string;
  token?: string;
}

const RECONNECT_MS = 2000;
const RECONNECT_MAX_MS = 15000;
const MAX_RECONNECT_ATTEMPTS = 10;

export function PresentStage({ deckId, meetingId, token }: PresentStageProps) {
  const [slides, setSlides] = useState<SlideSpec[]>([]);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [link, setLink] = useState<LinkState>("off");

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
    getDeck(deckId)
      .then((view) => {
        if (!alive) return;
        setSlides(view.slides);
        committed.current = view.deck.committedIndex;
        setLoaded(true);
      })
      .catch(() => {
        if (!alive) return;
        setFailed(true);
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [deckId]);

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
      if (attempts >= MAX_RECONNECT_ATTEMPTS) return; // 放棄自動重連；圓點停在 reconnecting，使用者可刷新
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
        onClose: () => {
          if (closed.current || conn.current !== c) return;
          conn.current = null;
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
  }, [meetingId, token, deckId, onMessage]);

  // ── render：極簡舞台（僅投影片 + 頁碼 + 連線圓點）──────────
  if (!loaded) {
    return (
      <main className="mc-present mc-present--loading" aria-busy="true">
        <div className="mc-present__spinner" aria-label="簡報載入中" />
      </main>
    );
  }

  const current = slides[index];

  return (
    <main className="mc-present">
      <div className="mc-present__stage">
        {current ? (
          <SlideRenderer slide={current} size="full" />
        ) : (
          <div className="mc-present__empty">簡報載入中…</div>
        )}
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
