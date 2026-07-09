import type { ResearchJob } from "@/lib/api";
import { JobStatusBadge } from "./StatusBadge";
import { Spinner } from "./Spinner";

/** 研究模式顯示名（與 EnrichPanel 三選一致）。 */
const MODE_LABEL: Record<string, string> = {
  deep: "全網深度研究",
  detailed: "官網深掃",
  quick: "快速掃描",
};

/**
 * JobProgressCard — long-task (crawl/enrich) progress (PROMPT 0 通用元件 #4).
 * queued→running→done/failed；done 顯示 fieldsFilled 與 sources；failed 顯示 error＋重試。
 * 可離開再回來（狀態由外層輪詢 hook 保存）。Presentational.
 */
export function JobProgressCard({
  job,
  onRetry,
  onDismiss,
}: {
  job: ResearchJob;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  const active = job.status === "queued" || job.status === "running";
  return (
    <div className={`mc-job mc-job--${job.status}`}>
      <div className="mc-job__head">
        <div className="mc-job__title">
          {active ? <Spinner size={14} /> : null}
          <span>研究工作 · {MODE_LABEL[job.mode] ?? "研究"}</span>
        </div>
        <JobStatusBadge status={job.status} />
      </div>

      {active ? (
        <p className="mc-job__hint">
          {job.status === "queued"
            ? "已排入佇列，稍候開始…"
            : job.mode === "deep"
              ? "正在全網研究（新聞／維基／公開檔＋官網產品）、逐欄標示來源…可離開再回來。"
              : "正在爬取官網與子頁、抽取欄位…可離開再回來。"}
        </p>
      ) : null}

      {job.status === "done" ? (
        <div className="mc-job__body">
          <p className="mc-job__stat">
            填入欄位：<strong>{job.fieldsFilled ?? 0}</strong> 個
          </p>
          {job.sources && job.sources.length > 0 ? (
            <details className="mc-job__sources">
              <summary>來源 {job.sources.length} 筆</summary>
              <ul>
                {job.sources.map((s, i) => (
                  <li key={i}>
                    <a href={s} target="_blank" rel="noreferrer noopener">
                      {s}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {job.status === "failed" ? (
        <div className="mc-job__body">
          <p className="mc-job__err">失敗：{job.error ?? "未知錯誤"}</p>
          {onRetry ? (
            <button type="button" className="mc-btn mc-btn--ghost" onClick={onRetry}>
              重試
            </button>
          ) : null}
        </div>
      ) : null}

      {onDismiss && !active ? (
        <button type="button" className="mc-job__dismiss" onClick={onDismiss} aria-label="關閉工作卡">
          關閉
        </button>
      ) : null}
    </div>
  );
}
