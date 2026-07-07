"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ImageJobStatus, ImageJobView, ImageKind } from "@meetcopilot/shared";
import { ApiError, enqueueImageJob, getImageJob } from "@/lib/api";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { Spinner } from "@/components/ui/Spinner";

/**
 * ImageJobCard — pre-meeting AI 生圖（OpenAI gpt-image-2，約 10–80s）的 job 進度卡。
 * 五態齊全：queued / running / done / failed / refused。**refused = 內容審核拒絕 → 套 fallback 漸層**，絕不出壞頁。
 * 耐心 UI：轉圈 + 「約 10–80 秒、可離開再回來、完成會套上」；jobId 存 localStorage，離開重進自動接回輪詢。
 *
 * done → onApply(dataUri)；refused → onFallback()（editor 把該頁 theme.bg 設為漸層並持久化）。
 * 多頁可各自有一張卡、各自輪詢、互不阻塞（每卡一個 timer）。
 */
const POLL_MS = 3000;
const key = (deckId: string, slideIndex: number, kind: ImageKind) => `mc_imgjob_${deckId}_${slideIndex}_${kind}`;

const TONE: Record<ImageJobStatus, StatusTone> = {
  queued: "muted",
  running: "info",
  done: "ok",
  failed: "danger",
  refused: "warn",
};
const LABEL: Record<ImageJobStatus, string> = {
  queued: "排隊中",
  running: "生成中",
  done: "完成",
  failed: "失敗",
  refused: "已擋下",
};

export function ImageJobCard({
  deckId,
  slideIndex,
  kind,
  prompt,
  onApply,
  onFallback,
  onClose,
}: {
  deckId: string;
  slideIndex: number;
  kind: ImageKind;
  prompt?: string;
  onApply: (dataUri: string, kind: ImageKind) => void;
  onFallback: (kind: ImageKind) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<ImageJobStatus | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const timer = useRef<number | null>(null);
  const settled = useRef(false);

  const stop = useCallback(() => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const finish = useCallback(
    (view: ImageJobView) => {
      stop();
      window.localStorage.removeItem(key(deckId, slideIndex, kind));
      if (settled.current) return;
      settled.current = true;
      if (view.status === "done" && view.dataUri) onApply(view.dataUri, kind);
      else if (view.status === "refused") onFallback(kind);
    },
    [deckId, slideIndex, kind, onApply, onFallback, stop],
  );

  const poll = useCallback(
    (jobId: string) => {
      stop();
      const tick = async () => {
        try {
          const view = await getImageJob(jobId);
          setStatus(view.status);
          setError(view.error);
          if (view.status === "done" || view.status === "failed" || view.status === "refused") finish(view);
        } catch {
          // transient poll error: keep last known status, retry next tick
        }
      };
      void tick();
      timer.current = window.setInterval(tick, POLL_MS);
    },
    [finish, stop],
  );

  // resume an in-flight job on mount (leave-and-return)
  useEffect(() => {
    const saved = window.localStorage.getItem(key(deckId, slideIndex, kind));
    if (saved) {
      settled.current = false;
      poll(saved);
    }
    return stop;
  }, [deckId, slideIndex, kind, poll, stop]);

  const start = useCallback(async () => {
    setSubmitting(true);
    setError(undefined);
    settled.current = false;
    try {
      const { jobId } = await enqueueImageJob(deckId, { slideIndex, kind, prompt: prompt?.trim() || undefined });
      window.localStorage.setItem(key(deckId, slideIndex, kind), jobId);
      setStatus("queued");
      poll(jobId);
    } catch (err) {
      setStatus("failed");
      setError(err instanceof ApiError ? err.message : "無法送出生圖工作");
    } finally {
      setSubmitting(false);
    }
  }, [deckId, slideIndex, kind, prompt, poll]);

  // auto-start when the card mounts with no resumable job
  useEffect(() => {
    const saved = window.localStorage.getItem(key(deckId, slideIndex, kind));
    if (!saved && status === null && !submitting) void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount for a fresh card
  }, []);

  const active = status === "queued" || status === "running";
  const kindLabel = kind === "background" ? "背景圖" : "整頁圖";

  return (
    <div className={`mc-imgjob mc-imgjob--${status ?? "queued"}`}>
      <div className="mc-imgjob__head">
        <span className="mc-imgjob__title">
          {active || submitting ? <Spinner size={14} /> : null} AI 生{kindLabel}
        </span>
        {status ? <StatusBadge tone={TONE[status]}>{LABEL[status]}</StatusBadge> : null}
      </div>

      {active ? (
        <p className="mc-imgjob__hint">
          AI 生圖約 <strong>10–80 秒</strong>，可以先去做別的、完成會自動套上。離開此頁再回來仍會接續。
        </p>
      ) : null}

      {status === "refused" ? (
        <p className="mc-imgjob__note">此提示被內容審核擋下，已自動套用 <strong>fallback 漸層背景</strong>（不會產生壞頁）。</p>
      ) : null}

      {status === "failed" ? (
        <div className="mc-imgjob__body">
          <p className="mc-imgjob__err">生圖失敗：{error ?? "未知錯誤"}</p>
          <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={() => void start()}>
            重試
          </button>
        </div>
      ) : null}

      {status === "done" ? <p className="mc-imgjob__note">已套用到本頁。</p> : null}

      {!active && !submitting ? (
        <button type="button" className="mc-imgjob__close" onClick={onClose} aria-label="關閉生圖卡">
          關閉
        </button>
      ) : null}
    </div>
  );
}
