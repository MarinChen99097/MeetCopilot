"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
import { DataTable, type Column } from "@/components/DataTable";
import { StateBoundary } from "@/components/StateBoundary";
import { AccountStatusBadge } from "@/components/StatusBadge";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { listOrgs, setOrgStatus } from "@/lib/api";
import type { OrgRow, OrgStatus } from "@/lib/api-types";
import { useAsync } from "@/lib/useAsync";
import { useConfirmAction } from "@/lib/useConfirmAction";
import { fmtDate, fmtNumber, fmtUsd } from "@/lib/format";

export default function OrgsPage() {
  return (
    <AdminShell title="組織管理">
      <Suspense fallback={null}>
        <OrgsBody />
      </Suspense>
    </AdminShell>
  );
}

function OrgsBody() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawStatus = searchParams.get("status");
  const initialStatus: OrgStatus | "" =
    rawStatus === "suspended" || rawStatus === "active" ? rawStatus : "";

  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<OrgStatus | "">(initialStatus);

  const q = useAsync(() => listOrgs({ query, status }), [query, status]);

  // 停權/復權確認狀態
  const action = useConfirmAction<OrgRow>(
    (r) => setOrgStatus(r.id, r.status === "suspended" ? "active" : "suspended"),
    q.reload,
  );

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setQuery(queryInput.trim());
  }

  const columns: Column<OrgRow>[] = [
    { key: "name", header: "組織", render: (r) => <span className="ad-strong">{r.name}</span>, sortValue: (r) => r.name },
    { key: "status", header: "狀態", render: (r) => <AccountStatusBadge status={r.status} />, sortValue: (r) => r.status },
    { key: "plan", header: "方案", render: (r) => r.plan || "—", sortValue: (r) => r.plan },
    { key: "memberCount", header: "成員", align: "right", render: (r) => fmtNumber(r.memberCount), sortValue: (r) => r.memberCount },
    { key: "costUsd30d", header: "近 30 日花費", align: "right", render: (r) => fmtUsd(r.costUsd30d), sortValue: (r) => r.costUsd30d },
    { key: "createdAt", header: "建立", render: (r) => fmtDate(r.createdAt), sortValue: (r) => r.createdAt },
    {
      key: "_action",
      header: "操作",
      align: "right",
      render: (r) => (
        <button
          type="button"
          className={`ad-btn ad-btn--sm ${r.status === "suspended" ? "ad-btn--primary" : "ad-btn--danger"}`}
          onClick={(e) => {
            e.stopPropagation();
            action.request(r);
          }}
        >
          {r.status === "suspended" ? "復權" : "停權"}
        </button>
      ),
    },
  ];

  const items = q.data?.items ?? [];

  return (
    <div className="ad-page">
      <form className="ad-toolbar" onSubmit={onSearch}>
        <input
          className="ad-input"
          placeholder="搜尋組織名稱…"
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          aria-label="搜尋組織"
        />
        <select
          className="ad-select"
          value={status}
          onChange={(e) => setStatus(e.target.value as OrgStatus | "")}
          aria-label="狀態篩選"
        >
          <option value="">全部狀態</option>
          <option value="active">啟用中</option>
          <option value="suspended">已停權</option>
        </select>
        <button type="submit" className="ad-btn ad-btn--primary ad-btn--sm">
          搜尋
        </button>
      </form>

      <section className="ad-card">
        <StateBoundary
          loading={q.loading}
          error={q.error}
          onRetry={q.reload}
          isEmpty={items.length === 0}
          emptyTitle="沒有符合的組織"
          emptyHint="調整搜尋或狀態篩選。"
        >
          <DataTable
            columns={columns}
            rows={items}
            rowKey={(r) => r.id}
            onRowClick={(r) => router.push(`/orgs/${r.id}`)}
            pageSize={25}
          />
        </StateBoundary>
      </section>

      <ConfirmDialog
        open={action.pending !== null}
        title={action.pending?.status === "suspended" ? "確認復權組織" : "確認停權組織"}
        message={
          action.pending ? (
            <>
              確定要{action.pending.status === "suspended" ? "復權" : "停權"} <strong>{action.pending.name}</strong>？
              {action.pending.status !== "suspended" ? "停權後該組織所有成員將無法登入或使用 API。" : "復權後成員即可恢復存取。"}
            </>
          ) : null
        }
        confirmLabel={action.pending?.status === "suspended" ? "復權" : "停權"}
        tone={action.pending?.status === "suspended" ? "primary" : "danger"}
        busy={action.busy}
        error={action.error}
        onConfirm={action.confirm}
        onCancel={action.cancel}
      />
    </div>
  );
}
