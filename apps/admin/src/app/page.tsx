"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { KpiCard } from "@/components/KpiCard";
import { ReadyBadge } from "@/components/StatusBadge";
import { StateBoundary } from "@/components/StateBoundary";
import { LineChart } from "@/components/charts/LineChart";
import { DonutChart } from "@/components/charts/DonutChart";
import { lastNDays } from "@/components/DateRangePicker";
import { getOverview, getUsage } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { fmtNumber, fmtUsd } from "@/lib/format";
import { kindLabel } from "@/lib/labels";

export default function OverviewPage() {
  return (
    <AdminShell title="總覽">
      <OverviewBody />
    </AdminShell>
  );
}

function OverviewBody() {
  const range = useMemo(() => lastNDays(30), []);
  const ov = useAsync(() => getOverview(), []);
  const byDay = useAsync(() => getUsage({ from: range.from, to: range.to, groupBy: "day" }), [range.from, range.to]);
  const byKind = useAsync(() => getUsage({ from: range.from, to: range.to, groupBy: "kind" }), [range.from, range.to]);

  const spark7 = sparkFromDays(byDay.data?.rows ?? [], 7);

  return (
    <div className="ad-page">
      <StateBoundary loading={ov.loading} error={ov.error} onRetry={ov.reload}>
        {ov.data ? (
          <section className="ad-kpi-row">
            <KpiCard
              label="今日花費"
              value={fmtUsd(ov.data.costUsd.today)}
              tone="accent"
              spark={spark7}
            />
            <KpiCard
              label="近 7 日花費"
              value={fmtUsd(ov.data.costUsd.last7d)}
              tone="accent"
              spark={spark7}
            />
            <KpiCard
              label="近 30 日花費"
              value={fmtUsd(ov.data.costUsd.last30d)}
              tone="accent"
              spark={sparkFromDays(byDay.data?.rows ?? [], 30)}
            />
            <KpiCard
              label="組織 / 已停權"
              value={fmtNumber(ov.data.orgs.total)}
              sub={<Link href="/orgs?status=suspended">已停權 {fmtNumber(ov.data.orgs.suspended)}</Link>}
              tone="muted"
              emphasis={ov.data.orgs.suspended > 0}
            />
            <KpiCard label="使用者總數" value={fmtNumber(ov.data.users.total)} tone="muted" />
            <KpiCard
              label="Job（近 7 日失敗）"
              value={fmtNumber(ov.data.jobs.failedLast7d)}
              sub={
                <Link href="/jobs?status=failed">
                  執行中 {fmtNumber(ov.data.jobs.running)}・完成 {fmtNumber(ov.data.jobs.doneLast7d)}
                </Link>
              }
              tone={ov.data.jobs.failedLast7d > 0 ? "danger" : "ok"}
              emphasis={ov.data.jobs.failedLast7d > 0}
            />
            <KpiCard
              label="系統狀態"
              value={<ReadyBadge ready={ov.data.health.ready} />}
              sub={<Link href="/health">系統健康詳情</Link>}
              tone={ov.data.health.ready ? "ok" : "danger"}
              emphasis={!ov.data.health.ready}
            />
          </section>
        ) : null}
      </StateBoundary>

      <div className="ad-grid-2">
        <section className="ad-card">
          <div className="ad-card__head">
            <h2 className="ad-card__title">近 30 日花費趨勢</h2>
            <span className="ad-card__hint">美元・估算值</span>
          </div>
          <StateBoundary
            loading={byDay.loading}
            error={byDay.error}
            onRetry={byDay.reload}
            isEmpty={(byDay.data?.rows.length ?? 0) === 0}
            emptyTitle="尚無花費資料"
            emptyHint="此區間內沒有記錄任何用量事件。"
          >
            <LineChart
              points={(byDay.data?.rows ?? []).map((r) => ({ label: shortDay(r.key), value: r.costUsd }))}
              valueFormat={fmtUsd}
            />
          </StateBoundary>
        </section>

        <section className="ad-card">
          <div className="ad-card__head">
            <h2 className="ad-card__title">近 30 日花費占比（依項目）</h2>
          </div>
          <StateBoundary
            loading={byKind.loading}
            error={byKind.error}
            onRetry={byKind.reload}
            isEmpty={(byKind.data?.rows.length ?? 0) === 0}
            emptyTitle="尚無花費資料"
          >
            <DonutChart
              slices={(byKind.data?.rows ?? []).map((r) => ({ label: kindLabel(r.key), value: r.costUsd }))}
              valueFormat={fmtUsd}
            />
          </StateBoundary>
        </section>
      </div>

      <p className="ad-disclaimer">花費為寫入時凍結的估算值（est_cost_usd），非帳單金額；單價由後端 PRICING 設定。</p>
    </div>
  );
}

/** 取 by-day rows 最後 n 天的 costUsd 序列給 sparkline（rows 已按日排序，UTC key）。 */
function sparkFromDays(rows: { key: string; costUsd: number }[], n: number): number[] {
  return rows.slice(-n).map((r) => r.costUsd);
}

/** UTC YYYY-MM-DD → MM/DD。 */
function shortDay(key: string): string {
  const parts = key.split("-");
  return parts.length === 3 ? `${parts[1]}/${parts[2]}` : key;
}
