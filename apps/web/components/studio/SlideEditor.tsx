"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { DeckRef, ImageKind, SlideSpec, SlideTheme } from "@meetcopilot/shared";
import { ApiError, createMeeting, exportDeckPptx, getDeck, patchSlide } from "@/lib/api";
import { buildPresentUrl, buildStaticPresentUrl, type MeetingCreds } from "@/lib/meeting-session";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { StateBoundary } from "@/components/ui/StateBoundary";
import { Spinner } from "@/components/ui/Spinner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SlideRenderer } from "@/components/slide/SlideRenderer";
import { BlockEditor } from "./BlockEditor";
import { ImageJobCard } from "./ImageJobCard";

/** 一個進行中的生圖卡（每張投影片 × kind 各一張，互不阻塞）。 */
interface JobReq {
  key: string;
  slideIndex: number;
  kind: ImageKind;
  prompt?: string;
}

/** background 被拒時的 fallback 漸層（representable：theme.bg 是 string，接受 CSS 漸層值）。 */
function gradientFallback(theme: SlideTheme | undefined): string {
  const a = theme?.accent ?? "#8b5cf6";
  return `linear-gradient(135deg, ${a}, #ec4899)`;
}

export function SlideEditor({ deckId }: { deckId: string }) {
  const router = useRouter();
  const toast = useToast();
  const tLaunch = useTranslations("studio");

  const [deck, setDeck] = useState<DeckRef | null>(null);
  const [slides, setSlides] = useState<SlideSpec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState(0);
  const [draft, setDraft] = useState<SlideSpec | null>(null);
  const [saving, setSaving] = useState(false);
  const [locked409, setLocked409] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [jobs, setJobs] = useState<JobReq[]>([]);
  const [prompt, setPrompt] = useState("");
  // AI 生圖預警：點「生成背景圖 / 整頁生圖」後先跳確認（付費外部 API + 耗時），確認才真的排入 job。
  const [confirmKind, setConfirmKind] = useState<ImageKind | null>(null);
  // 開始簡報 launcher：連線會議播放建 session 中的 pending 態。
  const [launching, setLaunching] = useState(false);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getDeck(deckId)
      .then((view) => {
        if (!alive) return;
        setDeck(view.deck);
        setSlides(view.slides);
        setSelected((s) => Math.min(s, Math.max(0, view.slides.length - 1)));
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof ApiError ? err.message : "載入失敗");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [deckId]);

  useEffect(() => load(), [load]);

  // sync draft when the selected slide changes (discard unsaved edits on switch)
  useEffect(() => {
    const s = slides[selected];
    setDraft(s ? structuredClone(s) : null);
    setLocked409(false);
  }, [slides, selected]);

  const committedIndex = deck?.committedIndex ?? -1;
  const isPlayed = selected <= committedIndex; // I1：已播頁不可改（server 也會回 409）
  const dirty = useMemo(
    () => draft != null && slides[selected] != null && JSON.stringify(draft) !== JSON.stringify(slides[selected]),
    [draft, slides, selected],
  );

  /** 持久化一張投影片（PATCH）；409 = 違反 I1（已播頁）→ 專屬錯誤態。 */
  const persist = useCallback(
    async (index: number, next: SlideSpec): Promise<boolean> => {
      try {
        await patchSlide(deckId, index, next);
        setSlides((prev) => prev.map((s, i) => (i === index ? next : s)));
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setLocked409(true);
          toast.push({ kind: "error", message: "此頁已播出，無法修改（I1）" });
        } else {
          toast.push({ kind: "error", message: err instanceof ApiError ? err.message : "儲存失敗" });
        }
        return false;
      }
    },
    [deckId, toast],
  );

  const save = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    const ok = await persist(selected, draft);
    setSaving(false);
    if (ok) toast.push({ kind: "success", message: "已儲存此頁" });
  }, [draft, persist, selected, toast]);

  /** 生圖 done → 套進該頁並持久化。background→theme.bg=url()；full→image-full 版型。 */
  const applyImage = useCallback(
    (slideIndex: number, dataUri: string, kind: ImageKind) => {
      setSlides((prev) => {
        const base = prev[slideIndex];
        if (!base) return prev;
        const next: SlideSpec =
          kind === "background"
            ? { ...base, theme: { ...base.theme, bg: `url("${dataUri}") center/cover no-repeat` } }
            : { ...base, template: "image-full", blocks: [{ type: "image", dataUri, alt: "" }] };
        void persist(slideIndex, next);
        if (slideIndex === selected) setDraft(structuredClone(next));
        return prev.map((s, i) => (i === slideIndex ? next : s));
      });
    },
    [persist, selected],
  );

  /** 生圖 refused → 套 fallback 漸層背景並持久化（絕不出壞頁）。 */
  const applyFallback = useCallback(
    (slideIndex: number, _kind: ImageKind) => {
      setSlides((prev) => {
        const base = prev[slideIndex];
        if (!base) return prev;
        const next: SlideSpec = { ...base, theme: { ...base.theme, bg: gradientFallback(base.theme) } };
        void persist(slideIndex, next);
        if (slideIndex === selected) setDraft(structuredClone(next));
        return prev.map((s, i) => (i === slideIndex ? next : s));
      });
    },
    [persist, selected],
  );

  const launchJob = (kind: ImageKind) => {
    const jr: JobReq = { key: `${selected}-${kind}-${Date.now()}`, slideIndex: selected, kind, prompt: prompt.trim() || undefined };
    setJobs((prev) => [...prev.filter((j) => !(j.slideIndex === selected && j.kind === kind)), jr]);
    setPrompt("");
  };

  const doExport = useCallback(async () => {
    setExporting(true);
    try {
      const blob = await exportDeckPptx(deckId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${deck?.title ?? "deck"}.pptx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.push({ kind: "success", message: "已開始下載 .pptx" });
    } catch (err) {
      toast.push({ kind: "error", message: err instanceof ApiError ? err.message : "匯出失敗" });
    } finally {
      setExporting(false);
    }
  }, [deckId, deck, toast]);

  /**
   * 靜態預覽：不建 session，直接開 /present?deckId=…（PresentStage 無 meetingId/token 時只在本機翻頁）。
   * URL 需帶 /{locale} 前綴（routing.localePrefix="always"）；同步開分頁，不受 popup blocker 影響。
   */
  const openStaticPreview = useCallback(() => {
    window.open(buildStaticPresentUrl(deckId), "_blank", "noopener,noreferrer");
  }, [deckId]);

  /**
   * 連線會議播放：createMeeting（帳號 A 已登入）→ 以 CreateMeetingResult 組出 present-role creds →
   * buildPresentUrl 帶 present token 開 /present。先同步開空白分頁再導向，避免 await 後被 popup blocker 擋。
   */
  const openLivePlay = useCallback(async () => {
    if (launching) return;
    setLaunching(true);
    const win = window.open("", "_blank");
    if (win) win.opener = null; // 斷開 opener 參照（等同 noopener）；present 分頁不依賴回連。
    try {
      const res = await createMeeting({ title: deck?.title ?? "簡報", deckId });
      const creds: MeetingCreds = { meetingId: res.meeting.id, wsToken: res.wsToken, wsUrl: res.wsUrl };
      const url = buildPresentUrl(deckId, creds);
      if (win) win.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      if (win) win.close();
      toast.push({ kind: "error", message: err instanceof ApiError ? err.message : tLaunch("launchError") });
    } finally {
      setLaunching(false);
    }
  }, [deck, deckId, launching, tLaunch, toast]);

  return (
    <main className="mc-editor">
      <div className="mc-editor__bar">
        <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={() => router.push("/studio")}>
          ← 返回 Studio
        </button>
        <h1 className="mc-editor__title">{deck?.title ?? "簡報"}</h1>
        <div className="mc-editor__baractions">
          <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={doExport} disabled={exporting || loading}>
            {exporting ? <Spinner size={13} /> : "⬇"} 匯出 .pptx
          </button>
          {/* 開始簡報 launcher：靜態預覽（本機翻頁）vs 連線會議播放（建 session，HUD 批准頁即時接尾）。 */}
          <span className="mc-editor__launchlabel" title={tLaunch("launchHint")}>
            {tLaunch("launchTitle")}
          </span>
          <button
            type="button"
            className="mc-btn mc-btn--ghost mc-btn--sm"
            onClick={openStaticPreview}
            disabled={loading || slides.length === 0}
            title={tLaunch("launchHint")}
          >
            ▶ {tLaunch("launchStaticPreview")}
          </button>
          <button
            type="button"
            className="mc-btn mc-btn--primary mc-btn--sm"
            onClick={openLivePlay}
            disabled={launching || loading || slides.length === 0}
            title={tLaunch("launchHint")}
          >
            {launching ? <Spinner size={13} /> : "🎥"} {launching ? tLaunch("launchOpening") : tLaunch("launchLivePlay")}
          </button>
        </div>
      </div>

      <StateBoundary
        loading={loading}
        error={error}
        isEmpty={!loading && slides.length === 0}
        onRetry={load}
        emptyTitle="這份 deck 沒有投影片"
        emptyHint="回 Studio 重新生成或匯入。"
      >
        <div className="mc-editor__grid">
          {/* 左：縮圖列 */}
          <aside className="mc-editor__thumbs" aria-label="投影片列表">
            {slides.map((s, i) => (
              <button
                key={s.id || i}
                type="button"
                className={`mc-thumb ${i === selected ? "is-sel" : ""} ${i <= committedIndex ? "is-played" : ""}`}
                onClick={() => setSelected(i)}
                aria-current={i === selected}
              >
                <span className="mc-thumb__no">{i + 1}</span>
                <span className="mc-thumb__frame">
                  <SlideRenderer slide={s} size="thumb" />
                </span>
                {i <= committedIndex ? <span className="mc-thumb__lock" title="已播出">🔒</span> : null}
              </button>
            ))}
          </aside>

          {/* 中：預覽 */}
          <section className="mc-editor__preview" aria-label="投影片預覽">
            {draft ? (
              <div className="mc-editor__stage">
                <SlideRenderer slide={draft} size="full" />
              </div>
            ) : null}
          </section>

          {/* 右：屬性面板 */}
          <aside className="mc-editor__panel" aria-label="投影片編輯">
            {isPlayed || locked409 ? (
              <div className="mc-editor__locked" role="alert">
                此頁已播出，無法修改（不變量 I1：只改尚未播放的頁）。
              </div>
            ) : null}

            {draft ? (
              <fieldset disabled={isPlayed || locked409} className="mc-editor__fields">
                <BlockEditor slide={draft} onChange={setDraft} />

                <div className="mc-editor__save">
                  <button type="button" className="mc-btn mc-btn--primary" onClick={save} disabled={!dirty || saving}>
                    {saving ? <Spinner size={14} /> : null} 儲存此頁
                  </button>
                  {dirty ? <span className="mc-editor__dirty">尚未儲存</span> : null}
                </div>

                {/* AI 生圖（pre-meeting）：常駐一行成本/時間說明 + 點擊前確認（P1：付費且耗時不可零預警） */}
                <div className="mc-editor__imgtools">
                  <p className="mc-editor__imgh">AI 生圖（背景 / 整頁）</p>
                  <p className="mc-editor__imgnote">會呼叫外部付費 API：約 10–80 秒、每張約 US$0.04，完成自動套上此頁。</p>
                  <input
                    className="mc-input"
                    placeholder="生圖提示（可空，用頁面內容推斷）"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                  <div className="mc-editor__imgbtns">
                    <button type="button" className="mc-btn mc-btn--accent mc-btn--sm" onClick={() => setConfirmKind("background")}>
                      生成背景圖
                    </button>
                    <button type="button" className="mc-btn mc-btn--accent mc-btn--sm" onClick={() => setConfirmKind("full")}>
                      整頁生圖
                    </button>
                  </div>
                </div>
              </fieldset>
            ) : null}

            {/* 生圖卡（可跨頁多張並行；輪詢 + 離開再回來） */}
            {jobs
              .filter((j) => j.slideIndex === selected)
              .map((j) => (
                <ImageJobCard
                  key={j.key}
                  deckId={deckId}
                  slideIndex={j.slideIndex}
                  kind={j.kind}
                  prompt={j.prompt}
                  onApply={(dataUri, kind) => applyImage(j.slideIndex, dataUri, kind)}
                  onFallback={(kind) => applyFallback(j.slideIndex, kind)}
                  onClose={() => setJobs((prev) => prev.filter((x) => x.key !== j.key))}
                />
              ))}
          </aside>
        </div>
      </StateBoundary>

      {confirmKind ? (
        <ConfirmDialog
          ariaLabel="AI 生圖確認"
          title={confirmKind === "background" ? "生成背景圖？" : "整頁生圖？"}
          message={
            <>
              這會呼叫外部付費 API（OpenAI）產生圖片：約需 <strong>10–80 秒</strong>、每張約 <strong>US$0.04</strong>。
              完成後會自動套進目前這一頁；圖片不合意可再重生。確定要繼續嗎？
            </>
          }
          cancelLabel="取消"
          confirmLabel="確定生成"
          confirmTone="accent"
          onCancel={() => setConfirmKind(null)}
          onConfirm={() => {
            launchJob(confirmKind);
            setConfirmKind(null);
          }}
        />
      ) : null}
    </main>
  );
}
