"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
import { DataTable, type Column } from "@/components/DataTable";
import { StateBoundary } from "@/components/StateBoundary";
import { JobStatusBadge } from "@/components/StatusBadge";
import { KpiCard } from "@/components/KpiCard";
import { StackedBarChart } from "@/components/charts/StackedBarChart";
import { DateRangePicker, lastNDays, type DateRange } from "@/components/DateRangePicker";
import { getJobStats, listJobs } from "@/lib/api";
import type { AdminJobMode, AdminJobStatus, JobRow } from "@/lib/api-types";
import { useAsync } from "@/lib/useAsync";
import { fmtDateTime, fmtDuration, fmtNumber } from "@/lib/format";
import { jobModeLabel, jobStatusLabel } from "@/lib/labels";

const STATUSES: AdminJobStatus[] = ["queued", "running", "done", "failed"];
const MODES: AdminJobMode[] = ["quick", "detailed", "deep"];
const LIMIT = 50;

export default function JobsPage() {
  return (
    <AdminShell title="研究 Job 監控">
      <Suspense fallback={null}>
        <JobsBody />
      </Suspense>
    </AdminShell>
  );
}

function JobsBody() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<string>(searchParams.get("status") ?? "");
  const [mode, setMode] = useState<string>("");
  const orgId = searchParams.get("orgId") ?? "";
  const [range, setRange] = useState<DateRange>(() => lastNDays(14));
  const [offset, setOffset] = useState(0);

  const stats = useAsync(() => getJobStats(14), []);
  const jobs = useAsync(
    () => listJobs({ status, mode, orgId, from: range.from, to: range.to, limit: LIMIT, offset }),
    [status, mode, orgId, range.from, range.to, offset],
  );

  function resetAndSet(fn: () => void) {
    setOffset(0);
    fn();
  }

  const columns: Column<JobRow>[] = [
    { key: "createdAt", header: "建立", render: (r) => fmtDateTime(r.createdAt), sortValue: (r) => r.createdAt, width: "150px" },
    { key: "orgName", header: "組織", render: (r) => r.orgName || r.orgId },
    { key: "targetName", header: "目標", render: (r) => r.targetName || r.targetId },
    { key: "mode", header: "模式", render: (r) => jobModeLabel(r.mode) },
    { key: "status", header: "狀態", render: (r) => <JobStatusBadge status={r.status} />, sortValue: (r) => r.status },
    { key: "queueMs", header: "排隊", align: "right", render: (r) => fmtDuration(r.queueMs), sortValue: (r) => r.queueMs ?? -1 },
    { key: "durationMs", header: "耗時", align: "right", render: (r) => fmtDuration(r.durationMs), sortValue: (r) => r.durationMs ?? -1 },
    { key: "error", header: "錯誤", render: (r) => <ExpandableError error={r.error} /> },
  ];

  const items = jobs.data?.items ?? [];

  return (
    <div className="ad-page">
      {/* #8 統計 */}
      <StateBoundary loading={stats.loading} error={stats.error} onRetry={stats.reload}>
        {stats.data ? (
          <>
            <section className="ad-kpi-row">
              <KpiCard label="失敗率（14 日）" value={`${stats.data.failRatePct.toFixed(1)}%`} tone={stats.data.failRatePct > 0 ? "danger" : "ok"} emphasis={stats.data.failRatePct >= 20} />
              <KpiCard label="平均耗時" value={fmtDuration(stats.data.avgDurationMs)} tone="muted" />
            </section>
            <div className="ad-grid-2">
              <section className="ad-card">
                <div className="ad-card__head">
                  <h2 className="ad-card__title">近 14 日 Job 狀態</h2>
                </div>
                <StateBoundary loading={false} isEmpty={stats.data.days.length === 0} emptyTitle="無統計資料">
                  <StackedBarChart days={stats.data.days} />
                </StateBoundary>
              </section>
              <section className="ad-card">
                <div className="ad-card__head">
                  <h2 className="ad-card__title">最常見錯誤（Top {stats.data.topErrors.length}）</h2>
                </div>
                {stats.data.topErrors.length === 0 ? (
                  <p className="ad-muted">近 14 日無失敗錯誤。</p>
                ) : (
                  <ul className="ad-toperrors">
                    {stats.data.topErrors.map((e, i) => (
                      <li key={i} className="ad-toperrors__item">
                        <span className="ad-toperrors__count">{fmtNumber(e.count)}</span>
                        <code className="ad-toperrors__msg">{e.error}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        ) : null}
      </StateBoundary>

      {/* #7 清單 */}
      <section className="ad-card">
        <div className="ad-card__head">
          <h2 className="ad-card__title">Job 清單{orgId ? "（已篩選單一組織）" : ""}</h2>
        </div>
        <div className="ad-toolbar">
          <DateRangePicker value={range} onChange={(r) => resetAndSet(() => setRange(r))} />
          <select className="ad-select" value={status} onChange={(e) => resetAndSet(() => setStatus(e.target.value))} aria-label="狀態篩選">
            <option value="">全部狀態</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {jobStatusLabel(s)}
              </option>
            ))}
          </select>
          <select className="ad-select" value={mode} onChange={(e) => resetAndSet(() => setMode(e.target.value))} aria-label="模式篩選">
            <option value="">全部模式</option>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {jobModeLabel(m)}
              </option>
            ))}
          </select>
        </div>
        <StateBoundary
          loading={jobs.loading}
          error={jobs.error}
          onRetry={jobs.reload}
          isEmpty={items.length === 0}
          emptyTitle="沒有符合的 Job"
          emptyHint="調整篩選條件或時間範圍。"
        >
          <DataTable
            columns={columns}
            rows={items}
            rowKey={(r) => r.id}
            server={{ total: jobs.data?.total ?? 0, offset, limit: LIMIT, onPage: setOffset }}
          />
        </StateBoundary>
      </section>
    </div>
  );
}

/** 錯誤欄：截斷顯示，點「展開」看全文。 */
function ExpandableError({ error }: { error: string | null }) {
  const [open, setOpen] = useState(false);
  if (!error) return <span className="ad-muted">—</span>;
  const truncated = error.length > 60;
  if (!truncated) return <code className="ad-errcell">{error}</code>;
  return (
    <span className="ad-errcell">
      <code>{open ? error : `${error.slice(0, 60)}…`}</code>{" "}
      <button
        type="button"
        className="ad-linkbtn"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {open ? "收合" : "展開"}
      </button>
    </span>
  );
}
