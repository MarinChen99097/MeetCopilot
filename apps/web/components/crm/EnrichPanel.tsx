"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CrawlMode, CrawlTargetType } from "@meetcopilot/shared";
import { ApiError, enrich, getResearchJob, type ResearchJob } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { JobProgressCard } from "@/components/ui/JobProgressCard";
import { Spinner } from "@/components/ui/Spinner";

const POLL_MS = 2500;
const storageKey = (t: CrawlTargetType, id: string) => `mc_enrich_${t}_${id}`;

/**
 * EnrichPanel — triggers POST /api/research/enrich then polls GET /api/research/jobs/:id
 * (queued→running→done/failed). The active jobId is persisted per-target in localStorage so the
 * user can leave and come back (contract §3 job model). On done → onDone() so the parent refreshes
 * the entity + provenance to reveal newly-filled fields.
 */
export function EnrichPanel({
  targetType,
  targetId,
  onDone,
}: {
  targetType: CrawlTargetType;
  targetId: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CrawlMode>("detailed");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [job, setJob] = useState<ResearchJob | null>(null);
  const timer = useRef<number | null>(null);
  const doneNotified = useRef(false);

  const stopPolling = useCallback(() => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const poll = useCallback(
    (jobId: string) => {
      stopPolling();
      const tick = async () => {
        try {
          const j = await getResearchJob(jobId);
          setJob(j);
          if (j.status === "done" || j.status === "failed") {
            stopPolling();
            window.localStorage.removeItem(storageKey(targetType, targetId));
            if (j.status === "done" && !doneNotified.current) {
              doneNotified.current = true;
              toast.push({ kind: "success", message: `研究完成，填入 ${j.fieldsFilled ?? 0} 個欄位` });
              onDone();
            }
            if (j.status === "failed" && !doneNotified.current) {
              doneNotified.current = true;
              toast.push({ kind: "error", message: `研究失敗：${j.error ?? "未知錯誤"}` });
            }
          }
        } catch {
          // transient poll error: keep the last known job, try again next tick
        }
      };
      void tick();
      timer.current = window.setInterval(tick, POLL_MS);
    },
    [onDone, stopPolling, targetId, targetType, toast],
  );

  // resume an in-flight job on mount
  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey(targetType, targetId));
    if (saved) {
      doneNotified.current = false;
      poll(saved);
    }
    return stopPolling;
  }, [poll, stopPolling, targetId, targetType]);

  async function submit() {
    setSubmitting(true);
    doneNotified.current = false;
    try {
      const { jobId } = await enrich({
        targetType,
        targetId,
        mode,
        url: (mode === "detailed" || mode === "deep") && url.trim() ? url.trim() : undefined,
      });
      window.localStorage.setItem(storageKey(targetType, targetId), jobId);
      setJob({ id: jobId, targetType, targetId, mode, status: "queued" });
      setOpen(false);
      poll(jobId);
    } catch (err) {
      toast.push({ kind: "error", message: err instanceof ApiError ? err.message : "無法啟動研究" });
    } finally {
      setSubmitting(false);
    }
  }

  const busy = job?.status === "queued" || job?.status === "running";

  return (
    <div className="mc-enrich">
      <button
        type="button"
        className="mc-btn mc-btn--accent"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
      >
        {busy ? <Spinner size={14} /> : "🔎"} 研究此{targetType === "company" ? "公司" : "主管"}
      </button>

      {open ? (
        <div className="mc-enrich__panel">
          <div className="mc-enrich__modes" role="radiogroup" aria-label="研究模式">
            <label className={`mc-enrich__mode ${mode === "quick" ? "is-on" : ""}`}>
              <input type="radio" name="mode" checked={mode === "quick"} onChange={() => setMode("quick")} />
              <span>輕量（quick）</span>
              <small>快速補幾個關鍵欄位</small>
            </label>
            <label className={`mc-enrich__mode ${mode === "detailed" ? "is-on" : ""}`}>
              <input type="radio" name="mode" checked={mode === "detailed"} onChange={() => setMode("detailed")} />
              <span>會前建檔（detailed）</span>
              <small>爬官網＋子頁＋grounding</small>
            </label>
            <label className={`mc-enrich__mode ${mode === "deep" ? "is-on" : ""}`}>
              <input type="radio" name="mode" checked={mode === "deep"} onChange={() => setMode("deep")} />
              <span>深度（全網研究）</span>
              <small>全網新聞／維基／公開檔＋官網產品，逐欄標示真實來源</small>
            </label>
          </div>
          {mode === "detailed" || mode === "deep" ? (
            <label className="mc-field">
              <span>官網 URL（可選，作為研究起點）</span>
              <input
                className="mc-input"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
              />
            </label>
          ) : null}
          <div className="mc-enrich__actions">
            <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={() => setOpen(false)}>
              取消
            </button>
            <button type="button" className="mc-btn mc-btn--primary mc-btn--sm" onClick={submit} disabled={submitting}>
              {submitting ? <Spinner size={13} /> : "開始研究"}
            </button>
          </div>
        </div>
      ) : null}

      {job ? (
        <JobProgressCard
          job={job}
          onRetry={() => setOpen(true)}
          onDismiss={() => {
            setJob(null);
            window.localStorage.removeItem(storageKey(targetType, targetId));
          }}
        />
      ) : null}
    </div>
  );
}
