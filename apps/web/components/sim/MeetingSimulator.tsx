"use client";

/**
 * 會議模擬器（測試工具，非隱藏功能）——用「匯入音檔」模擬會議進行，端到端走真管線：
 *   選/匯入 deck（如 AI金融商品應用v1.pdf）→ 選 mp3 → 建 meeting（綁 deck）→
 *   [capture WS] mp3 解碼成 16k mono PCM 逐 frame 灌出（= 真收音格式）→ server ASR → 分析 →
 *   DynamicSlide 補充頁橋接 → [hud WS] 建議進批准佇列（右欄，報告者手動 ACCEPT，I2）→
 *   [present WS] 已批准補充頁 append 到 deck 尾端 → 中欄縮圖列即時長出新頁（I1）。
 *
 * 三條 WS（capture 送音、present 收 deck_update、hud 收 suggestion/送批准）＝與真會議相同拓撲，
 * 只有音源換成匯入檔。I3 不受影響：真正分享給對方的 /present 仍只收 deck_update；本測試台把三視圖擺一起
 * 是報告者自己的私有測試環境。
 *
 * 執行環境：本頁用 lib/api 的 API_BASE（build 期 NEXT_PUBLIC_API_BASE）——本機 dev 打本機 server、
 * 線上 web 打線上 server（兩邊都支援，見頁面上方環境標示）。PDF 轉原始頁需伺服器有 poppler(pdftoppm)：
 * 本機裸 Windows 沒有 → 匯入會停在 failed（頁面會誠實顯示 importError＋提示）；線上環境已內建。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, CompanySummary, DeckSummary, ServerMessage, SlideSpec } from "@meetcopilot/shared";
import { API_BASE, createMeeting, getDeck, importDeck, listCompanies, listDecks } from "@/lib/api";
import { useTranslations } from "next-intl";
import { useRealtime, wsStatusKey } from "@/lib/useRealtime";
import {
  buildHudUrl,
  buildPresentUrl,
  clearMeetingCreds,
  saveMeetingCreds,
  type MeetingCreds,
} from "@/lib/meeting-session";
import { HudInner } from "@/components/hud/HudView";
import { SlideRenderer } from "@/components/slide/SlideRenderer";
import { startMp3Capture } from "@/lib/mp3-capture";
import type { CaptureController } from "@/lib/audio-capture";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface DeckInfo {
  id: string;
  title: string;
  importStatus: string;
  count: number;
  originalCount: number;
}

export function MeetingSimulator() {
  const [phase, setPhase] = useState<"setup" | "running">("setup");
  const [creds, setCreds] = useState<MeetingCreds | null>(null);
  const [deckId, setDeckId] = useState<string>("");

  return (
    <div style={{ maxWidth: phase === "running" ? "none" : 920, margin: "0 auto", padding: "1.25rem 1rem 3rem" }}>
      <header style={{ marginBottom: "1rem" }}>
        <span className="mc-kicker">測試工具</span>
        <h1 style={{ margin: "0.2rem 0 0.3rem", fontSize: "1.5rem" }}>🧪 會議模擬器</h1>
        <p style={{ margin: 0, color: "var(--mc-text-2)", fontSize: "0.9rem" }}>
          匯入音檔模擬會議進行，看 DynamicSlide 依對話把補充頁 append 到簡報尾端（走真 ASR→分析→批准→append 管線）。
        </p>
        <p style={{ margin: "0.4rem 0 0", fontSize: "0.78rem", color: "var(--mc-text-2)" }}>
          API：<code>{API_BASE}</code>　·　切換環境＝以對應的前端（本機 dev / 線上）開啟本頁
        </p>
      </header>

      {phase === "setup" ? (
        <SetupPanel
          deckId={deckId}
          setDeckId={setDeckId}
          onStart={(c) => {
            setCreds(c);
            setPhase("running");
          }}
        />
      ) : creds ? (
        <RunningPanel
          creds={creds}
          deckId={deckId}
          onStop={() => {
            clearMeetingCreds();
            setCreds(null);
            setPhase("setup");
          }}
        />
      ) : null}
    </div>
  );
}

/* ─────────────────────────── SETUP ─────────────────────────── */

function SetupPanel({
  deckId,
  setDeckId,
  onStart,
}: {
  deckId: string;
  setDeckId: (id: string) => void;
  onStart: (creds: MeetingCreds) => void;
}) {
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [companyId, setCompanyId] = useState<string>("");
  const [deckInfo, setDeckInfo] = useState<DeckInfo | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [mp3, setMp3] = useState<File | null>(null);
  const [speed, setSpeed] = useState(1);
  const [title, setTitle] = useState("測試會議：AI 金融商品應用");
  const [starting, setStarting] = useState(false);
  const [startErr, setStartErr] = useState<string | null>(null);

  const refreshDecks = useCallback(async () => {
    try {
      const res = await listDecks();
      setDecks(res.items);
    } catch {
      /* 未登入或後端未起 → 交由 AuthGuard/錯誤訊息處理 */
    }
  }, []);

  useEffect(() => {
    void refreshDecks();
    listCompanies({ page: 1 })
      .then((r) => setCompanies(r.items))
      .catch(() => {});
  }, [refreshDecks]);

  const selectDeck = useCallback(
    async (id: string) => {
      setDeckId(id);
      setDeckInfo(null);
      if (!id) return;
      try {
        const v = await getDeck(id);
        setDeckInfo({
          id,
          title: v.deck.title,
          importStatus: v.deck.importStatus,
          count: v.slides.length,
          originalCount: v.deck.originalCount,
        });
      } catch {
        /* ignore */
      }
    },
    [setDeckId],
  );

  const onImport = useCallback(
    async (file: File) => {
      setImporting(true);
      setImportMsg("上傳中…");
      try {
        const { deckId: id } = await importDeck(file);
        setImportMsg("轉檔中…（PDF 逐頁轉圖，需伺服器有 poppler / pdftoppm）");
        const started = Date.now();
        while (Date.now() - started < 120_000) {
          await sleep(1500);
          const v = await getDeck(id);
          if (v.deck.importStatus === "ready") {
            setImportMsg(`匯入完成：${v.slides.length} 頁原始簡報`);
            await refreshDecks();
            await selectDeck(id);
            return;
          }
          if (v.deck.importStatus === "failed") {
            setImportMsg(
              `轉檔失敗：${v.deck.importError ?? "未知錯誤"} — 本機需安裝 poppler(pdftoppm)，或改用已部署的線上環境測試。`,
            );
            return;
          }
        }
        setImportMsg("轉檔逾時。請稍後在下方 deck 清單重新選取。");
      } catch (e) {
        setImportMsg(`匯入失敗：${(e as Error).message}`);
      } finally {
        setImporting(false);
      }
    },
    [refreshDecks, selectDeck],
  );

  const canStart = !!deckId && !!mp3 && !starting;

  async function start() {
    if (!mp3) return;
    setStarting(true);
    setStartErr(null);
    try {
      const res = await createMeeting({ title: title.trim() || "測試會議", deckId, companyId: companyId || undefined });
      const c: MeetingCreds = { meetingId: res.meeting.id, wsToken: res.wsToken, wsUrl: res.wsUrl };
      // mp3 檔本身不能存進 sessionStorage；用模組級暫存交給 RunningPanel。
      pendingMp3 = mp3;
      pendingSpeed = speed;
      saveMeetingCreds(c);
      onStart(c);
    } catch (e) {
      setStartErr((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {/* 1. deck */}
      <section className="mc-card" style={cardStyle}>
        <h2 style={h2Style}>① 選擇簡報（原始 PPT/PDF，補充頁會加在它後面）</h2>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
          <select
            className="mc-input"
            value={deckId}
            onChange={(e) => void selectDeck(e.target.value)}
            style={{ minWidth: 280 }}
            aria-label="選擇既有 deck"
          >
            <option value="">— 選擇既有 deck —</option>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}（{d.slideCount} 頁）
              </option>
            ))}
          </select>
          <label className="mc-btn mc-btn--ghost" style={{ cursor: importing ? "wait" : "pointer" }}>
            {importing ? "匯入中…" : "＋ 匯入 PDF / PPTX"}
            <input
              type="file"
              accept=".pdf,.pptx"
              hidden
              disabled={importing}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImport(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {importMsg ? (
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.82rem", color: "var(--mc-text-2)" }}>{importMsg}</p>
        ) : null}
        {deckInfo ? (
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.82rem" }}>
            已選：<b>{deckInfo.title}</b> · 狀態 {deckInfo.importStatus} · 共 {deckInfo.count} 頁
            {deckInfo.originalCount > 0 ? `（原始 ${deckInfo.originalCount}）` : ""}
            {deckInfo.importStatus !== "ready" ? (
              <span style={{ color: "#e0a336" }}>　⚠ 尚未 ready，原始頁可能還沒轉好</span>
            ) : null}
          </p>
        ) : null}
      </section>

      {/* 2. audio */}
      <section className="mc-card" style={cardStyle}>
        <h2 style={h2Style}>② 匯入會議音檔（mp3 等）</h2>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="file"
            accept="audio/*,.mp3,.m4a,.wav,.ogg"
            className="mc-input"
            onChange={(e) => setMp3(e.target.files?.[0] ?? null)}
            aria-label="選擇音檔"
          />
          <label style={{ fontSize: "0.85rem" }}>
            速度{" "}
            <select className="mc-input" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              <option value={1}>1×（擬真）</option>
              <option value={2}>2×</option>
              <option value={4}>4×（快灌）</option>
            </select>
          </label>
        </div>
        {mp3 ? (
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.82rem" }}>
            已選音檔：<b>{mp3.name}</b>（{(mp3.size / 1024 / 1024).toFixed(1)} MB）
          </p>
        ) : (
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.82rem", color: "var(--mc-text-2)" }}>
            假想三人會議：2 位客戶＋1 位報告者（說話者標註由 LLM 依內容推斷；選對方公司可幫助命中名冊）。
          </p>
        )}
      </section>

      {/* 3. meta + start */}
      <section className="mc-card" style={cardStyle}>
        <h2 style={h2Style}>③ 會議設定 → 開始</h2>
        <div style={{ display: "grid", gap: "0.6rem" }}>
          <label style={{ fontSize: "0.85rem" }}>
            會議標題
            <input
              className="mc-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ display: "block", width: "100%", marginTop: 4 }}
            />
          </label>
          <label style={{ fontSize: "0.85rem" }}>
            對方公司（選填，供說話者/CRM 名冊）
            <select
              className="mc-input"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              style={{ display: "block", width: "100%", marginTop: 4 }}
            >
              <option value="">— 不指定 —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {startErr ? <p style={{ color: "var(--mc-danger)", fontSize: "0.85rem" }}>{startErr}</p> : null}
        <div style={{ marginTop: "0.8rem" }}>
          <button type="button" className="mc-btn mc-btn--primary" disabled={!canStart} onClick={() => void start()}>
            {starting ? "建立會議中…" : "▶ 開始模擬會議"}
          </button>
          {!deckId || !mp3 ? (
            <span style={{ marginLeft: 10, fontSize: "0.8rem", color: "var(--mc-text-2)" }}>
              需先選好 deck 與音檔
            </span>
          ) : null}
        </div>
      </section>
    </div>
  );
}

/* 模組級暫存：mp3 File 無法序列化進 sessionStorage，開始時交棒給 RunningPanel。 */
let pendingMp3: File | null = null;
let pendingSpeed = 1;

/* ─────────────────────────── RUNNING ─────────────────────────── */

function RunningPanel({ creds, deckId, onStop }: { creds: MeetingCreds; deckId: string; onStop: () => void }) {
  // 本頁其餘文案是測試工具，刻意留繁中硬編；但連線狀態的標籤來自**共用**的 `wsStatusKey`
  // （/copilot、/hud 同一份），它回的是 `ws` namespace 的 key，必須走 t() 才有字。
  const tw = useTranslations("ws");
  const [slides, setSlides] = useState<SlideSpec[]>([]);
  // 本次會議開始時的 deck 頁數；之後 append 進來的都是「本次新增」補充頁（對任何 deck 型別都正確，
  // 不依賴 originalCount——native/generated deck 的 originalCount=0 會把全部頁誤標成補充）。
  const [seedLen, setSeedLen] = useState(0);
  const [focus, setFocus] = useState(0);
  const [progress, setProgress] = useState(0);
  const [audioDone, setAudioDone] = useState(false);
  const [audioErr, setAudioErr] = useState<string | null>(null);
  const [deckErr, setDeckErr] = useState<string | null>(null);
  const [level, setLevel] = useState(0);

  const prevLen = useRef(0);
  const railEnd = useRef<HTMLDivElement | null>(null);
  const captureSendRef = useRef<((m: ClientMessage) => void) | null>(null);
  const sendAudioRef = useRef<((f: ArrayBuffer) => void) | null>(null);
  const captureCtrlRef = useRef<CaptureController | null>(null);
  const mp3Started = useRef(false);
  // 卸載旗標：capture controller 是在 startMp3Capture 解碼（decodeAudioData＋離線重取樣，數秒）之後才產生的。
  // 若解碼期間就卸載/結束，卸載 effect 當下 captureCtrlRef 仍 null → stop() 空轉，解碼完成後 controller 才被建立、
  // 其 setInterval 會對著已關閉的 WS 永遠空轉直到整檔播畢（資源洩漏）。用 mountedRef 讓解碼完成的 .then 檢查：
  // 已卸載就立刻 stop()。放在 ref 而非 start-effect 的 cleanup，是為了不在 WS 每次重連（status 變動重跑 effect）時誤停灌流。
  const mountedRef = useRef(true);

  // present WS：收 deck_update → 尾端 append（I1），縮圖列即時長出新頁。
  const onPresentMsg = useCallback((msg: ServerMessage) => {
    if (msg.type === "deck_update") setSlides((prev) => [...prev, msg.op.slide]);
  }, []);
  const present = useRealtime({
    apiBase: creds.wsUrl ?? API_BASE,
    wsToken: creds.wsToken,
    meetingId: creds.meetingId,
    role: "present",
    enabled: true,
    onMessage: onPresentMsg,
  });

  // capture WS：open 後送 consent，再開始把 mp3 灌出。
  const onCaptureOpen = useCallback(() => {
    captureSendRef.current?.({ type: "consent", granted: true });
  }, []);
  // consent 落地的前提是 server 端 runtime 已建立——而 runtime 是 hub.attach 裡「非同步」ensureRuntime（兩次 DB 讀後才
  // sessions.set）建立的。若 open 時送的 consent 早於 runtime 建好，會被靜默丟棄（ws-server consent handler no-op），
  // 之後音訊全被 consent gate 丟掉 → 零 ASR → 零補充頁（本機低延遲最易中）。runtime 建好後 server 才發 session_state，
  // 故收到 session_state 即（重）送一次 consent 兜底；idempotent，重送無害。
  const onCaptureMsg = useCallback((msg: ServerMessage) => {
    if (msg.type === "session_state") captureSendRef.current?.({ type: "consent", granted: true });
  }, []);
  const capture = useRealtime({
    apiBase: creds.wsUrl ?? API_BASE,
    wsToken: creds.wsToken,
    meetingId: creds.meetingId,
    role: "capture",
    enabled: true,
    onMessage: onCaptureMsg,
    onOpen: onCaptureOpen,
  });
  captureSendRef.current = capture.send;
  sendAudioRef.current = capture.sendAudio;

  // 種子：載入 deck 全量（原始頁 + 已批准補充頁）。
  useEffect(() => {
    let alive = true;
    setDeckErr(null);
    getDeck(deckId)
      .then((v) => {
        if (!alive) return;
        setSlides(v.slides);
        setSeedLen(v.slides.length);
        setFocus(Math.max(0, v.slides.length - 1));
      })
      .catch((e) => {
        // 不吞錯：否則預覽永遠停在「載入中…」、seedLen=0 還會誤標後續頁。誠實顯示。
        if (alive) setDeckErr((e as Error).message || "deck 載入失敗");
      });
    return () => {
      alive = false;
    };
  }, [deckId]);

  // capture open 後啟動 mp3 灌流（只啟一次）。
  useEffect(() => {
    if (capture.status !== "open" || mp3Started.current) return;
    const file = pendingMp3;
    if (!file) {
      setAudioErr("找不到音檔（請重新從設定頁開始）。");
      return;
    }
    mp3Started.current = true;
    startMp3Capture(
      file,
      { onFrame: (pcm) => sendAudioRef.current?.(pcm), onEnded: () => setAudioDone(true) },
      { speed: pendingSpeed, onProgress: setProgress },
    )
      .then((c) => {
        if (!mountedRef.current) c.stop(); // 解碼期間已卸載/結束 → 立即停，別讓 setInterval 對著關閉的 WS 空轉
        else captureCtrlRef.current = c;
      })
      .catch((e) => {
        if (mountedRef.current) setAudioErr((e as Error).message);
        mp3Started.current = false;
      });
  }, [capture.status]);

  // VU 表：rAF 讀 controller.getLevel()。
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setLevel(captureCtrlRef.current?.getLevel() ?? 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 卸載時停掉音檔灌流（並標記卸載，讓解碼中的 startMp3Capture 一 resolve 就自我停止）。
  useEffect(
    () => () => {
      mountedRef.current = false;
      captureCtrlRef.current?.stop();
    },
    [],
  );

  // 有新頁 append → 自動聚焦最後一頁 + 捲到尾端。
  useEffect(() => {
    if (slides.length > prevLen.current) {
      setFocus(slides.length - 1);
      railEnd.current?.scrollIntoView({ behavior: "smooth", inline: "end", block: "nearest" });
    }
    prevLen.current = slides.length;
  }, [slides.length]);

  const supplementCount = Math.max(0, slides.length - seedLen);
  const focused = slides[focus];

  return (
    <div style={{ display: "grid", gap: "0.9rem" }}>
      {/* header / controls */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "center" }}>
        <strong style={{ fontSize: "1.05rem" }}>模擬進行中</strong>
        <span style={pill}>
          共 {slides.length} 頁（原始 {seedLen} ＋ <b style={{ color: "#7ee0a3" }}>本次 AI 補充 {supplementCount}</b>）
        </span>
        <span style={pill}>capture：{tw(wsStatusKey(capture.status))}</span>
        <span style={pill}>present：{tw(wsStatusKey(present.status))}</span>
        <span style={{ flex: 1 }} />
        <a className="mc-btn mc-btn--ghost mc-btn--sm" href={buildPresentUrl(deckId, creds)} target="_blank" rel="noopener">
          ↗ 另開 present
        </a>
        <a className="mc-btn mc-btn--ghost mc-btn--sm" href={buildHudUrl(creds)} target="_blank" rel="noopener">
          ↗ 另開 HUD
        </a>
        <button type="button" className="mc-btn mc-btn--sm" onClick={onStop}>
          ■ 結束模擬
        </button>
      </div>

      {/* audio bar */}
      <div className="mc-card" style={{ ...cardStyle, display: "flex", alignItems: "center", gap: "0.8rem" }}>
        <span style={{ fontSize: "0.85rem", whiteSpace: "nowrap" }}>🎧 收音（mp3）</span>
        <div style={{ flex: 1, height: 8, background: "var(--mc-sunk)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: `${Math.round(progress * 100)}%`, height: "100%", background: "var(--mc-accent)", transition: "width .2s" }} />
        </div>
        <div style={{ width: 60, height: 8, background: "var(--mc-sunk)", borderRadius: 4, overflow: "hidden" }} title="音量">
          <div style={{ width: `${Math.round(level * 100)}%`, height: "100%", background: "#7ee0a3" }} />
        </div>
        <span style={{ fontSize: "0.78rem", color: "var(--mc-text-2)", whiteSpace: "nowrap" }}>
          {audioErr ? `⚠ ${audioErr}` : audioDone ? "音檔播畢" : `${Math.round(progress * 100)}%`}
        </span>
      </div>

      {/* main: present preview + thumbs | hud */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) minmax(300px,1fr)", gap: "0.9rem", alignItems: "start" }}>
        <div style={{ display: "grid", gap: "0.6rem" }}>
          <div className="mc-card" style={{ ...cardStyle, padding: "0.6rem" }}>
            {/* 佔位底色走 --mc-sunk（不是 #000）：淺色主題下黑底會讓下面那行 token 化的提示字對比不足。 */}
            <div style={{ aspectRatio: "16/9", background: "var(--mc-sunk)", borderRadius: 8, overflow: "hidden", display: "grid" }}>
              {focused ? (
                <SlideRenderer slide={focused} size="full" />
              ) : (
                // 錯誤字疊在上面那層 --mc-sunk 底上：淺色主題的 --mc-danger 只有 4.22:1（未達 AA 4.5），
                // 故走 --mc-danger-on-sunk（淺色壓深成 #9a332f → 5.90:1；深色不變 → 5.92:1）。
                <div style={{ placeSelf: "center", color: deckErr ? "var(--mc-danger-on-sunk)" : "var(--mc-text-2)", fontSize: "0.85rem", padding: "0 1rem", textAlign: "center" }}>
                  {deckErr ? `⚠ deck 載入失敗：${deckErr}` : "載入中…"}
                </div>
              )}
            </div>
            <p style={{ margin: "0.4rem 2px 0", fontSize: "0.78rem", color: "var(--mc-text-2)" }}>
              第 {focus + 1} / {slides.length} 頁　{focus >= seedLen ? "· 🟢 本次 AI 補充頁" : "· 原始簡報頁"}
            </p>
          </div>
          {/* thumbnail rail */}
          <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "4px 2px 8px" }}>
            {slides.map((s, i) => {
              const isSupp = i >= seedLen;
              return (
                <button
                  key={s.id ?? i}
                  type="button"
                  onClick={() => setFocus(i)}
                  title={`第 ${i + 1} 頁${isSupp ? "（AI 補充）" : ""}`}
                  style={{
                    flex: "0 0 auto",
                    width: 132,
                    padding: 0,
                    border: `2px solid ${i === focus ? "var(--mc-accent)" : isSupp ? "#3f9e6b" : "transparent"}`,
                    borderRadius: 6,
                    overflow: "hidden",
                    background: "#000",
                    cursor: "pointer",
                    position: "relative",
                  }}
                >
                  <div style={{ aspectRatio: "16/9", pointerEvents: "none" }}>
                    <SlideRenderer slide={s} size="thumb" />
                  </div>
                  <span
                    style={{
                      position: "absolute",
                      left: 3,
                      bottom: 3,
                      fontSize: 10,
                      padding: "1px 4px",
                      borderRadius: 4,
                      background: isSupp ? "#2f7a52" : "rgba(0,0,0,0.6)",
                      color: "#fff",
                    }}
                  >
                    {i + 1}
                    {isSupp ? " AI" : ""}
                  </span>
                </button>
              );
            })}
            <div ref={railEnd} />
          </div>
        </div>

        {/* HUD：真 transcript/signals/建議＋批准（I2 手動接受）。
            單欄收斂現在由 HUD 自己負責：`rootTag="section"` → 元件輸出 `section.mc-hudm`，
            globals.css 的 `section.mc-hudm` 規則（內嵌用法）已把 100dvh／max-width／大內距拿掉。
            舊的 `.mc-cockpit__hud` 覆寫（配舊 `.mc-hud` 兩欄 grid）連同整個 .mc-cockpit* 區塊已刪除。 */}
        <div className="mc-card" style={{ ...cardStyle, padding: "0.5rem", minHeight: 360 }}>
          <p style={{ margin: "0 0 0.4rem", fontSize: "0.8rem", color: "var(--mc-text-2)" }}>
            MeetCopilot（建議出現後按「接受」即 append 到簡報尾端 →）
          </p>
          <HudInner embedded creds={creds} rootTag="section" />
        </div>
      </div>
    </div>
  );
}

/* ── inline style tokens（測試工具，最小樣式） ──
   2026-07-31：`.mc-card` 只是個沒有 CSS 規則的 class（globals.css 只有 --mc-card **變數**），
   所以卡片外觀完全由這裡決定。原本寫死的 rgba(255,255,255,…) 白膜只在深底成立，淺色主題下
   邊框與底色都等於看不見 → 比照 SpendDashboard 改吃 --mc-* token（雙主題自動翻轉）。 */
const cardStyle: React.CSSProperties = {
  border: "1px solid var(--mc-border)",
  borderRadius: 12,
  padding: "1rem",
  background: "var(--mc-card)",
};
const h2Style: React.CSSProperties = { margin: "0 0 0.6rem", fontSize: "0.98rem" };
const pill: React.CSSProperties = {
  fontSize: "0.78rem",
  padding: "2px 8px",
  borderRadius: 999,
  // 同 cardStyle 的理由：寫死的白膜只在深底看得見，淺色主題下等於沒有底。
  // --mc-surface-2 是雙主題都成立的 wash token（淺色＝深墨淡底、深色＝白淡底）。
  background: "var(--mc-surface-2)",
};
