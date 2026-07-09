import type { ReactNode } from "react";
import { EmptyState } from "./EmptyState";

/**
 * StateBoundary — 每個資料區塊的 載入/空/錯誤 三態包裝。
 * Presentational：parent hook 供 loading/error/isEmpty；渲染 skeleton / 錯誤+重試 / 空 / children。
 * 保證任何頁面在任何狀態都有文案，不可白屏。
 */
export function StateBoundary({
  loading,
  error,
  isEmpty,
  onRetry,
  skeleton,
  emptyTitle = "尚無資料",
  emptyHint,
  emptyAction,
  children,
}: {
  loading: boolean;
  error?: string | null;
  isEmpty?: boolean;
  onRetry?: () => void;
  skeleton?: ReactNode;
  emptyTitle?: string;
  emptyHint?: string;
  emptyAction?: ReactNode;
  children: ReactNode;
}) {
  if (loading) return <>{skeleton ?? <DefaultSkeleton />}</>;
  if (error) {
    return (
      <div className="ad-errorstate" role="alert">
        <p className="ad-errorstate__msg">發生錯誤：{error}</p>
        {onRetry ? (
          <button type="button" className="ad-btn ad-btn--ghost" onClick={onRetry}>
            重試
          </button>
        ) : null}
      </div>
    );
  }
  if (isEmpty) return <EmptyState title={emptyTitle} hint={emptyHint} action={emptyAction} />;
  return <>{children}</>;
}

function DefaultSkeleton() {
  return (
    <div className="ad-skel" aria-hidden="true">
      <div className="ad-skel__line" style={{ width: "60%" }} />
      <div className="ad-skel__line" style={{ width: "90%" }} />
      <div className="ad-skel__line" style={{ width: "75%" }} />
    </div>
  );
}
