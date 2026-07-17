"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { CrawlMode, CrawlTargetType } from "@meetcopilot/shared";
import { ApiError, enrich, getResearchJob, type ResearchJob } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { JobProgressCard } from "@/components/ui/JobProgressCard";
import { Spinner } from "@/components/ui/Spinner";

const POLL_MS = 2500;
const storageKey = (t: CrawlTargetType, id: string) => `mc_enrich_${t}_${id}`;

/**
 * 研究單一入口（RESEARCH_UPGRADE_CONTRACT §3）：移除舊「快速掃描／官網深掃」選項，
 * 一律走 deep（全網＋社群、多輪迭代）。送出 payload 照既有 deep 契約（mode='deep'），不自創欄位。
 * 官網 URL 仍可選填作為研究起點；缺 URL 的 company 後端一律 name-based 全網研究。
 * 路徑分離：本面板走 `enrich()`（研究 job 端點）；DeckWizard 的「從網址匯入」走 `extractUrl`/`extractPdf`
 * （DeckWizard.tsx:134,147），兩者互不影響。
 */
const DEEP_MODE: CrawlMode = "deep";

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
  const t = useTranslations("enrichPanel");
  const toast = useToast();
  const [open, setOpen] = useState(false);
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
        mode: DEEP_MODE, // 單一深度模式；URL 為可選研究起點
        url: url.trim() ? url.trim() : undefined,
      });
      window.localStorage.setItem(storageKey(targetType, targetId), jobId);
      setJob({ id: jobId, targetType, targetId, mode: DEEP_MODE, status: "queued" });
      setOpen(false);
      poll(jobId);
    } catch (err) {
      toast.push({ kind: "error", message: err instanceof ApiError ? err.message : "無法啟動研究" });
    } finally {
      setSubmitting(false);
    }
  }

  const busy = job?.status === "queued" || job?.status === "running";
  const targetNoun = targetType === "company" ? "公司" : "主管";

  return (
    <div className="mc-enrich">
      <button type="button" className="mc-btn mc-btn--accent" onClick={() => setOpen((o) => !o)} disabled={busy}>
        {busy ? <Spinner size={14} /> : "🔎"} 研究此{targetNoun}
      </button>

      {open ? (
        <div className="mc-enrich__panel">
          <div className="mc-enrich__lead">
            <strong>{t("deepEntryLabel")}</strong>
            <small>{t("deepEntryDesc")}</small>
          </div>

          <p className="mc-enrich__warn" role="note">
            {t("timeHint")}
          </p>

          <label className="mc-field">
            <span>官網 URL（可選，作為研究起點）</span>
            <input
              className="mc-input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
            />
            {targetType === "company" && !url.trim() ? (
              <small className="mc-field__hint">將以公司名稱做全網深度研究（不需官網）</small>
            ) : null}
          </label>

          <div className="mc-enrich__actions">
            <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={() => setOpen(false)}>
              取消
            </button>
            <button type="button" className="mc-btn mc-btn--primary mc-btn--sm" onClick={submit} disabled={submitting}>
              {submitting ? <Spinner size={13} /> : t("start")}
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
