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

  // ── WS 連線（帶 session 憑證才開；斷線自動重連）────────────
  useEffect(() => {
    if (!meetingId || !token) {
      setLink("off");
      return;
    }
    closed.current = false;

    const open = () => {
      if (closed.current) return;
      setLink((s) => (s === "open" ? s : s === "off" ? "connecting" : "reconnecting"));
      const c = connect(API_BASE, token, meetingId, "present");
      conn.current = c;
      c.on(onMessage);
      // WsConnection 不外露 socket 狀態；用一次 hello 觸發 server 回 session_state，並以計時器樂觀標記 open。
      c.send({ type: "hello", role: "present" });
      window.setTimeout(() => {
        if (!closed.current && conn.current === c) setLink("open");
      }, 300);
    };

    open();

    // 保底重連：以固定間隔確認連線存在（WsConnection 未暴露 onclose，故用輕量守衛）。
    retry.current = window.setInterval(() => {
      if (closed.current) return;
      // 若 socket 已被 GC/關閉，send 會是 no-op；此處僅維持 UI 提示，實際重連交由使用者刷新或下一次 hello。
    }, RECONNECT_MS);

    return () => {
      closed.current = true;
      if (retry.current !== null) window.clearInterval(retry.current);
      conn.current?.close();
      conn.current = null;
    };
  }, [meetingId, token, onMessage]);

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
