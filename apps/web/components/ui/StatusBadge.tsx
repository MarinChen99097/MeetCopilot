import type { CrawlJobStatus, VerifiedStatus, AccountStatus } from "@meetcopilot/shared";

/**
 * StatusBadge — generic small pill for enum-ish states (PROMPT 0 通用元件 #1).
 * Colour never the sole signal:每個 tone 都帶文字 label（WCAG）。
 */
export type StatusTone = "ok" | "warn" | "danger" | "info" | "muted" | "accent";

export function StatusBadge({
  tone = "muted",
  children,
  title,
}: {
  tone?: StatusTone;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span className={`mc-badge mc-badge--${tone}`} title={title}>
      {children}
    </span>
  );
}

const JOB_TONE: Record<CrawlJobStatus, StatusTone> = {
  queued: "muted",
  running: "info",
  done: "ok",
  failed: "danger",
};
const JOB_LABEL: Record<CrawlJobStatus, string> = {
  queued: "排隊中",
  running: "研究中",
  done: "完成",
  failed: "失敗",
};
export function JobStatusBadge({ status }: { status: CrawlJobStatus }) {
  return <StatusBadge tone={JOB_TONE[status]}>{JOB_LABEL[status]}</StatusBadge>;
}

const VERIFIED_TONE: Record<VerifiedStatus, StatusTone> = {
  none: "muted",
  partial: "warn",
  verified: "ok",
};
const VERIFIED_LABEL: Record<VerifiedStatus, string> = {
  none: "未驗證",
  partial: "部分驗證",
  verified: "已驗證",
};
export function VerifiedBadge({ status }: { status: VerifiedStatus }) {
  return (
    <StatusBadge tone={VERIFIED_TONE[status]} title={`整列驗證：${VERIFIED_LABEL[status]}`}>
      {status === "verified" ? "✓ " : ""}
      {VERIFIED_LABEL[status]}
    </StatusBadge>
  );
}

const ACCOUNT_LABEL: Record<AccountStatus, string> = {
  prospect: "潛在客戶",
  active: "洽談中",
  customer: "既有客戶",
  churned: "已流失",
};
const ACCOUNT_TONE: Record<AccountStatus, StatusTone> = {
  prospect: "info",
  active: "accent",
  customer: "ok",
  churned: "danger",
};
export function AccountStatusBadge({ status }: { status?: AccountStatus }) {
  if (!status) return null;
  return <StatusBadge tone={ACCOUNT_TONE[status]}>{ACCOUNT_LABEL[status]}</StatusBadge>;
}
