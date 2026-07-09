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
 * 研究深度三選（對齊後端 CrawlMode）。每個模式一行人話說明＋成本/時間量級提示，讓銷售使用者自選成本，
 * 不再寫死最貴的 deep。預設 quick；deep（全網研究、費用較高）需二次確認才送出。
 */
const MODES: { value: CrawlMode; label: string; desc: string; cost: string }[] = [
  { value: "quick", label: "快速掃描", desc: "只掃官網首頁與主要頁，抓基本欄位", cost: "官網快掃・約 1 分內" },
  { value: "detailed", label: "官網深掃", desc: "深爬官網多層子頁，抓產品與細節", cost: "官網深掃・數分鐘" },
  { value: "deep", label: "全網深度研究", desc: "全網新聞／維基／公開檔＋官網，逐欄標示外部來源", cost: "全網研究・數分鐘・費用較高" },
];

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
  const [mode, setMode] = useState<CrawlMode>("quick"); // 預設最便宜的快速掃描
  const [deepConfirm, setDeepConfirm] = useState(false); // deep 需二次確認
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

  const chooseMode = (m: CrawlMode) => {
    setMode(m);
    setDeepConfirm(false); // 換模式重置 deep 確認
  };

  const togglePanel = () => {
    setDeepConfirm(false);
    setOpen((o) => !o);
  };

  // 無 URL 的 company 後端一律走全網深度研究（name-based），故「實際會跑 deep」＝選 deep 或（company 且無 URL）。
  const noUrl = !url.trim();
  const effectiveDeep = mode === "deep" || (targetType === "company" && noUrl);

  async function submit() {
    // deep（最貴）二次確認：第一次點只顯示警告，再點才真的送出。含「無 URL→全網研究」這條隱性昂貴路徑。
    if (effectiveDeep && !deepConfirm) {
      setDeepConfirm(true);
      return;
    }
    setSubmitting(true);
    doneNotified.current = false;
    try {
      const { jobId } = await enrich({
        targetType,
        targetId,
        mode,
        url: url.trim() ? url.trim() : undefined,
      });
      window.localStorage.setItem(storageKey(targetType, targetId), jobId);
      setJob({ id: jobId, targetType, targetId, mode, status: "queued" });
      setOpen(false);
      setDeepConfirm(false);
      poll(jobId);
    } catch (err) {
      toast.push({ kind: "error", message: err instanceof ApiError ? err.message : "無法啟動研究" });
    } finally {
      setSubmitting(false);
    }
  }

  const busy = job?.status === "queued" || job?.status === "running";
  const primaryLabel = effectiveDeep ? (deepConfirm ? "確認開始（費用較高）" : "全網深度研究") : "開始研究";

  return (
    <div className="mc-enrich">
      <button
        type="button"
        className="mc-btn mc-btn--accent"
        onClick={togglePanel}
        disabled={busy}
      >
        {busy ? <Spinner size={14} /> : "🔎"} 研究此{targetType === "company" ? "公司" : "主管"}
      </button>

      {open ? (
        <div className="mc-enrich__panel">
          <div className="mc-enrich__lead">
            <strong>研究此{targetType === "company" ? "公司" : "主管"}</strong>
            <small>選擇研究深度。預設「快速掃描」；全網深度研究較貴、需再次確認。</small>
          </div>

          <div className="mc-enrich__modes" role="radiogroup" aria-label="研究深度">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={mode === m.value}
                className={`mc-enrich__mode ${mode === m.value ? "is-on" : ""}`}
                onClick={() => chooseMode(m.value)}
              >
                <strong>{m.label}</strong>
                <small>{m.desc}</small>
                <small>{m.cost}</small>
              </button>
            ))}
          </div>

          <label className="mc-field">
            <span>官網 URL（可選，作為研究起點）</span>
            <input
              className="mc-input"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setDeepConfirm(false); // URL 改變會影響「是否實際跑 deep」→ 重置確認
              }}
              placeholder="https://example.com"
            />
            {targetType === "company" && noUrl ? (
              <small className="mc-field__hint">將以公司名稱做全網深度研究（不需官網）</small>
            ) : null}
          </label>

          {effectiveDeep && deepConfirm ? (
            <p className="mc-enrich__warn" role="alert">
              {mode === "deep"
                ? "全網深度研究會查詢多個外部來源、耗時數分鐘且費用較高。確認要開始嗎？"
                : "此公司無官網 URL，將以公司名稱做全網深度研究（耗時數分鐘、費用較高）。確認要開始嗎？"}
            </p>
          ) : null}

          <div className="mc-enrich__actions">
            <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={() => setOpen(false)}>
              取消
            </button>
            <button type="button" className="mc-btn mc-btn--primary mc-btn--sm" onClick={submit} disabled={submitting}>
              {submitting ? <Spinner size={13} /> : primaryLabel}
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
