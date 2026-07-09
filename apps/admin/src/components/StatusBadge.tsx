import type { ReactNode } from "react";
import type { AdminJobStatus, OrgStatus, UserStatus } from "@/lib/api-types";
import { accountStatusLabel, jobStatusLabel } from "@/lib/labels";

/**
 * StatusBadge — enum 狀態小藥丸。顏色從不為唯一訊號：每個 tone 都帶文字 label（WCAG）。
 */
export type StatusTone = "ok" | "warn" | "danger" | "info" | "muted" | "accent";

export function StatusBadge({
  tone = "muted",
  children,
}: {
  tone?: StatusTone;
  children: ReactNode;
}) {
  return <span className={`ad-badge ad-badge--${tone}`}>{children}</span>;
}

/** 帳號（org/user）狀態：active/suspended。 */
export function AccountStatusBadge({ status }: { status: OrgStatus | UserStatus }) {
  const tone: StatusTone = status === "suspended" ? "danger" : "ok";
  return <StatusBadge tone={tone}>{accountStatusLabel(status)}</StatusBadge>;
}

const JOB_TONE: Record<AdminJobStatus, StatusTone> = {
  queued: "muted",
  running: "info",
  done: "ok",
  failed: "danger",
};

/** 研究 job 狀態（未知值走 muted）。 */
export function JobStatusBadge({ status }: { status: string }) {
  const tone = JOB_TONE[status as AdminJobStatus] ?? "muted";
  return <StatusBadge tone={tone}>{jobStatusLabel(status)}</StatusBadge>;
}

/** 系統 ready 燈。 */
export function ReadyBadge({ ready }: { ready: boolean }) {
  return (
    <StatusBadge tone={ready ? "ok" : "danger"}>{ready ? "● Ready" : "● Not Ready"}</StatusBadge>
  );
}
