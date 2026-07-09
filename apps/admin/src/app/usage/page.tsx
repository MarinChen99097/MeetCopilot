"use client";

import { useMemo, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { DataTable, type Column } from "@/components/DataTable";
import { StateBoundary } from "@/components/StateBoundary";
import { BarChart } from "@/components/charts/BarChart";
import { DateRangePicker, lastNDays, type DateRange } from "@/components/DateRangePicker";
import { UsageEventsDrawer, type DrawerFilter } from "@/components/UsageEventsDrawer";
import { getUsage } from "@/lib/api";
import type { UsageGroupBy, UsageRow } from "@/lib/api-types";
import { useAsync } from "@/lib/useAsync";
import { fmtCompact, fmtDate, fmtUsd } from "@/lib/format";
import { GROUP_BY_LABELS, KIND_LABELS, kindLabel } from "@/lib/labels";

const GROUP_OPTIONS: UsageGroupBy[] = ["day", "org", "kind", "model"];

export default function UsagePage() {
  return (
    <AdminShell title="花費">
      <UsageBody />
    </AdminShell>
  );
}

function UsageBody() {
  const [range, setRange] = useState<DateRange>(() => lastNDays(30));
  const [groupBy, setGroupBy] = useState<UsageGroupBy>("day");
  const [drawer, setDrawer] = useState<DrawerFilter | null>(null);

  const q = useAsync(
    () => getUsage({ from: range.from, to: range.to, groupBy }),
    [range.from, range.to, groupBy],
  );

  /** 依 groupBy 顯示「鍵」欄的人性化標籤。 */
  function keyLabel(row: UsageRow): string {
    if (groupBy === "org") return row.orgName || row.key;
    if (groupBy === "kind") return kindLabel(row.key);
    return row.key;
  }

  /** 點列 → 開明細抽屜（#3 支援 orgId/kind/範圍；day 用單日、model 僅範圍）。 */
  function openDrawer(row: UsageRow) {
    if (groupBy === "org") setDrawer({ title: keyLabel(row), from: range.from, to: range.to, orgId: row.key });
    else if (groupBy === "kind") setDrawer({ title: keyLabel(row), from: range.from, to: range.to, kind: row.key });
    else if (groupBy === "day") setDrawer({ title: row.key, from: row.key, to: row.key });
    else setDrawer({ title: `模型 ${row.key}`, from: range.from, to: range.to });
  }

  const columns: Column<UsageRow>[] = [
    { key: "key", header: GROUP_BY_LABELS[groupBy] ?? "鍵", render: keyLabel, sortValue: (r) => keyLabel(r) },
    { key: "events", header: "事件數", align: "right", render: (r) => fmtCompact(r.events), sortValue: (r) => r.events },
    { key: "inputTokens", header: "輸入 tok", align: "right", render: (r) => fmtCompact(r.inputTokens), sortValue: (r) => r.inputTokens },
    { key: "outputTokens", header: "輸出 tok", align: "right", render: (r) => fmtCompact(r.outputTokens), sortValue: (r) => r.outputTokens },
    { key: "costUsd", header: "花費(估)", align: "right", render: (r) => fmtUsd(r.costUsd), sortValue: (r) => r.costUsd },
  ];

  const rows = q.data?.rows ?? [];
  const barData = useMemo(
    () =>
      [...rows]
        .sort((a, b) => b.costUsd - a.costUsd)
        .map((r) => ({ label: keyLabel(r), value: r.costUsd })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, groupBy],
  );

  return (
    <div className="ad-page">
      <div className="ad-toolbar">
        <DateRangePicker value={range} onChange={setRange} />
        <div className="ad-segment" role="tablist" aria-label="聚合維度">
          {GROUP_OPTIONS.map((g) => (
            <button
              key={g}
              type="button"
              role="tab"
              aria-selected={groupBy === g}
              className={`ad-segment__btn ${groupBy === g ? "ad-segment__btn--active" : ""}`}
              onClick={() => setGroupBy(g)}
            >
              {GROUP_BY_LABELS[g]}
            </button>
          ))}
        </div>
      </div>

      {q.data ? (
        <section className="ad-summary">
          <div className="ad-summary__item">
            <span className="ad-summary__label">總花費(估)</span>
            <strong className="ad-summary__val">{fmtUsd(q.data.totalCostUsd)}</strong>
          </div>
          <div className="ad-summary__item">
            <span className="ad-summary__label">總輸入 token</span>
            <strong className="ad-summary__val">{fmtCompact(q.data.totalInputTokens)}</strong>
          </div>
          <div className="ad-summary__item">
            <span className="ad-summary__label">總輸出 token</span>
            <strong className="ad-summary__val">{fmtCompact(q.data.totalOutputTokens)}</strong>
          </div>
          <div className="ad-summary__item">
            <span className="ad-summary__label">區間</span>
            <strong className="ad-summary__val">
              {fmtDate(q.data.from)} → {fmtDate(q.data.to)}
            </strong>
          </div>
        </section>
      ) : null}

      <div className="ad-grid-2">
        <section className="ad-card">
          <div className="ad-card__head">
            <h2 className="ad-card__title">花費明細（{GROUP_BY_LABELS[groupBy]}）</h2>
            <span className="ad-card__hint">點一列查看事件明細</span>
          </div>
          <StateBoundary
            loading={q.loading}
            error={q.error}
            onRetry={q.reload}
            isEmpty={rows.length === 0}
            emptyTitle="此區間無用量"
            emptyHint="調整日期範圍或稍後再試。"
          >
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.key}
              onRowClick={openDrawer}
              pageSize={20}
            />
          </StateBoundary>
        </section>

        <section className="ad-card">
          <div className="ad-card__head">
            <h2 className="ad-card__title">花費長條圖</h2>
            <span className="ad-card__hint">美元・由高到低</span>
          </div>
          <StateBoundary loading={q.loading} error={q.error} onRetry={q.reload} isEmpty={rows.length === 0} emptyTitle="無資料">
            <BarChart data={barData} valueFormat={fmtUsd} />
          </StateBoundary>
        </section>
      </div>

      <section className="ad-card">
        <div className="ad-card__head">
          <h2 className="ad-card__title">計費項目與定價說明</h2>
        </div>
        <p className="ad-disclaimer">
          所有花費皆為 <strong>寫入時凍結的估算值</strong>（est_cost_usd），非實際帳單金額。各項目單價由後端環境變數
          （<code>PRICING__&lt;MODEL&gt;__INPUT_PER_M</code> 等）設定，前端不持有費率。
        </p>
        <table className="ad-table ad-table--plain">
          <thead>
            <tr>
              <th className="ad-table__th">項目 (kind)</th>
              <th className="ad-table__th">說明</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(KIND_LABELS).map(([kind, label]) => (
              <tr key={kind}>
                <td className="ad-table__td">
                  <code>{kind}</code>
                </td>
                <td className="ad-table__td">{label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {drawer ? <UsageEventsDrawer filter={drawer} onClose={() => setDrawer(null)} /> : null}
    </div>
  );
}
