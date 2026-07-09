"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
import { DataTable, type Column } from "@/components/DataTable";
import { StateBoundary } from "@/components/StateBoundary";
import { AccountStatusBadge, JobStatusBadge } from "@/components/StatusBadge";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DonutChart } from "@/components/charts/DonutChart";
import { getOrg, setOrgStatus, setUserStatus } from "@/lib/api";
import type { JobRow, OrgInviteRow, OrgMemberRow, OrgStatus } from "@/lib/api-types";
import { useAsync } from "@/lib/useAsync";
import { useConfirmAction } from "@/lib/useConfirmAction";
import { fmtDate, fmtDateTime, fmtDuration, fmtUsd } from "@/lib/format";
import { jobModeLabel, kindLabel, roleLabel } from "@/lib/labels";

export default function OrgDetailPage() {
  return (
    <AdminShell title="組織明細">
      <OrgDetailBody />
    </AdminShell>
  );
}

/** 待確認的動作：停權/復權組織或成員。 */
type PendingAction =
  | { kind: "org"; id: string; name: string; next: OrgStatus }
  | { kind: "user"; id: string; name: string; next: OrgStatus };

function OrgDetailBody() {
  const params = useParams<{ id: string }>();
  const orgId = params.id;
  const q = useAsync(() => getOrg(orgId), [orgId]);

  const action = useConfirmAction<PendingAction>(
    (p) => (p.kind === "org" ? setOrgStatus(p.id, p.next) : setUserStatus(p.id, p.next)),
    q.reload,
  );

  const memberColumns: Column<OrgMemberRow>[] = [
    { key: "displayName", header: "姓名", render: (r) => r.displayName || "—", sortValue: (r) => r.displayName },
    { key: "email", header: "Email", render: (r) => r.email, sortValue: (r) => r.email },
    { key: "role", header: "角色", render: (r) => roleLabel(r.role), sortValue: (r) => r.role },
    { key: "status", header: "狀態", render: (r) => <AccountStatusBadge status={r.status} />, sortValue: (r) => r.status },
    {
      key: "_action",
      header: "操作",
      align: "right",
      render: (r) => (
        <button
          type="button"
          className={`ad-btn ad-btn--sm ${r.status === "suspended" ? "ad-btn--primary" : "ad-btn--danger"}`}
          onClick={() => {
            action.request({ kind: "user", id: r.userId, name: r.displayName || r.email, next: r.status === "suspended" ? "active" : "suspended" });
          }}
        >
          {r.status === "suspended" ? "復權" : "停權"}
        </button>
      ),
    },
  ];

  const inviteColumns: Column<OrgInviteRow>[] = [
    { key: "email", header: "Email", render: (r) => r.email, sortValue: (r) => r.email },
    { key: "role", header: "角色", render: (r) => roleLabel(r.role) },
    { key: "acceptedAt", header: "接受於", render: (r) => (r.acceptedAt ? fmtDateTime(r.acceptedAt) : "未接受") },
    { key: "expiresAt", header: "到期", render: (r) => fmtDateTime(r.expiresAt) },
  ];

  const jobColumns: Column<JobRow>[] = [
    { key: "createdAt", header: "建立", render: (r) => fmtDateTime(r.createdAt), sortValue: (r) => r.createdAt },
    { key: "targetName", header: "目標", render: (r) => r.targetName || r.targetId },
    { key: "mode", header: "模式", render: (r) => jobModeLabel(r.mode) },
    { key: "status", header: "狀態", render: (r) => <JobStatusBadge status={r.status} /> },
    { key: "durationMs", header: "耗時", align: "right", render: (r) => fmtDuration(r.durationMs) },
  ];

  const org = q.data?.org;

  return (
    <div className="ad-page">
      <Link href="/orgs" className="ad-back">
        ← 返回組織清單
      </Link>

      <StateBoundary loading={q.loading} error={q.error} onRetry={q.reload}>
        {q.data && org ? (
          <>
            <section className="ad-card ad-orghead">
              <div className="ad-orghead__main">
                <h2 className="ad-orghead__name">{org.name}</h2>
                <div className="ad-orghead__meta">
                  <AccountStatusBadge status={org.status} />
                  <span className="ad-orghead__chip">方案：{org.plan || "—"}</span>
                  <span className="ad-orghead__chip">建立：{fmtDate(org.createdAt)}</span>
                  <span className="ad-orghead__chip">近 30 日花費(估)：{fmtUsd(q.data.usage30d.costUsd)}</span>
                </div>
              </div>
              <button
                type="button"
                className={`ad-btn ${org.status === "suspended" ? "ad-btn--primary" : "ad-btn--danger"}`}
                onClick={() => {
                  action.request({ kind: "org", id: org.id, name: org.name, next: org.status === "suspended" ? "active" : "suspended" });
                }}
              >
                {org.status === "suspended" ? "復權組織" : "停權組織"}
              </button>
            </section>

            <div className="ad-grid-2">
              <section className="ad-card">
                <div className="ad-card__head">
                  <h2 className="ad-card__title">成員（{q.data.members.length}）</h2>
                </div>
                <DataTable
                  columns={memberColumns}
                  rows={q.data.members}
                  rowKey={(r) => r.userId}
                  emptyText="此組織尚無成員"
                />
              </section>

              <section className="ad-card">
                <div className="ad-card__head">
                  <h2 className="ad-card__title">近 30 日花費占比</h2>
                </div>
                <StateBoundary loading={false} isEmpty={q.data.usage30d.byKind.length === 0} emptyTitle="尚無花費">
                  <DonutChart
                    slices={q.data.usage30d.byKind.map((k) => ({ label: kindLabel(k.kind), value: k.costUsd }))}
                    valueFormat={fmtUsd}
                  />
                </StateBoundary>
              </section>
            </div>

            <section className="ad-card">
              <div className="ad-card__head">
                <h2 className="ad-card__title">邀請（{q.data.invites.length}）</h2>
                <span className="ad-card__hint">基於安全，不顯示邀請 token</span>
              </div>
              <DataTable
                columns={inviteColumns}
                rows={q.data.invites}
                rowKey={(r) => r.id}
                emptyText="無邀請紀錄"
              />
            </section>

            <section className="ad-card">
              <div className="ad-card__head">
                <h2 className="ad-card__title">近期研究 Job（{q.data.recentJobs.length}）</h2>
                <Link href={`/jobs?orgId=${org.id}`} className="ad-card__hint">
                  查看全部 →
                </Link>
              </div>
              <DataTable
                columns={jobColumns}
                rows={q.data.recentJobs}
                rowKey={(r) => r.id}
                emptyText="尚無研究 Job"
              />
            </section>
          </>
        ) : null}
      </StateBoundary>

      <ConfirmDialog
        open={action.pending !== null}
        title={
          action.pending
            ? `確認${action.pending.next === "suspended" ? "停權" : "復權"}${action.pending.kind === "org" ? "組織" : "成員"}`
            : ""
        }
        message={
          action.pending ? (
            <>
              確定要{action.pending.next === "suspended" ? "停權" : "復權"} <strong>{action.pending.name}</strong>？
              {action.pending.kind === "user" && action.pending.next === "suspended"
                ? "停權後該成員將無法登入。（無法停權平台管理員本身）"
                : null}
              {action.pending.kind === "org" && action.pending.next === "suspended"
                ? "停權後該組織所有成員將無法登入或使用 API。"
                : null}
            </>
          ) : null
        }
        confirmLabel={action.pending?.next === "suspended" ? "停權" : "復權"}
        tone={action.pending?.next === "suspended" ? "danger" : "primary"}
        busy={action.busy}
        error={action.error}
        onConfirm={action.confirm}
        onCancel={action.cancel}
      />
    </div>
  );
}
