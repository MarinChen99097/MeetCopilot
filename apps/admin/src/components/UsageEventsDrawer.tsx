"use client";

import { useState } from "react";
import { DataTable, type Column } from "./DataTable";
import { StateBoundary } from "./StateBoundary";
import { getUsageEvents } from "@/lib/api";
import type { UsageEvent } from "@/lib/api-types";
import { useAsync } from "@/lib/useAsync";
import { fmtCompact, fmtDateTime, fmtUsd } from "@/lib/format";
import { kindLabel } from "@/lib/labels";

/** #3 用量明細抽屜（分頁；limit 上限 200，此處固定 50）。 */
const LIMIT = 50;

export interface DrawerFilter {
  title: string;
  from: string;
  to: string;
  orgId?: string;
  kind?: string;
}

export function UsageEventsDrawer({ filter, onClose }: { filter: DrawerFilter; onClose: () => void }) {
  const [offset, setOffset] = useState(0);
  const q = useAsync(
    () => getUsageEvents({ from: filter.from, to: filter.to, orgId: filter.orgId, kind: filter.kind, limit: LIMIT, offset }),
    [filter.from, filter.to, filter.orgId, filter.kind, offset],
  );

  const columns: Column<UsageEvent>[] = [
    { key: "createdAt", header: "時間", render: (r) => fmtDateTime(r.createdAt), sortValue: (r) => r.createdAt, width: "150px" },
    { key: "orgName", header: "組織", render: (r) => r.orgName || r.orgId },
    { key: "userEmail", header: "使用者", render: (r) => r.userEmail || r.userId || "—" },
    { key: "kind", header: "項目", render: (r) => kindLabel(r.kind) },
    { key: "model", header: "模型", render: (r) => r.model || "—" },
    { key: "inputTokens", header: "輸入 tok", align: "right", render: (r) => fmtCompact(r.inputTokens), sortValue: (r) => r.inputTokens },
    { key: "outputTokens", header: "輸出 tok", align: "right", render: (r) => fmtCompact(r.outputTokens), sortValue: (r) => r.outputTokens },
    { key: "estCostUsd", header: "花費(估)", align: "right", render: (r) => fmtUsd(r.estCostUsd), sortValue: (r) => r.estCostUsd },
    { key: "meetingId", header: "會議", render: (r) => r.meetingId || "—" },
  ];

  return (
    <div className="ad-drawer-scrim" onClick={onClose}>
      <aside className="ad-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="用量明細">
        <div className="ad-drawer__head">
          <h2 className="ad-drawer__title">用量明細 · {filter.title}</h2>
          <button type="button" className="ad-btn ad-btn--ghost ad-btn--sm" onClick={onClose}>
            關閉
          </button>
        </div>
        <div className="ad-drawer__body">
          <StateBoundary
            loading={q.loading}
            error={q.error}
            onRetry={q.reload}
            isEmpty={(q.data?.items.length ?? 0) === 0}
            emptyTitle="此範圍內無用量事件"
          >
            <DataTable
              columns={columns}
              rows={q.data?.items ?? []}
              rowKey={(r) => r.id}
              server={{ total: q.data?.total ?? 0, offset, limit: LIMIT, onPage: setOffset }}
            />
          </StateBoundary>
        </div>
      </aside>
    </div>
  );
}
