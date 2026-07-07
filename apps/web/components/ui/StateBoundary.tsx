import type { ReactNode } from "react";
import { EmptyState } from "./EmptyState";

/**
 * StateBoundary — every data block's 載入/空/錯誤 three-state wrapper (PROMPT 0 通用元件 #5).
 * Presentational: parent hook supplies `loading`/`error`/`isEmpty`; renders skeleton / error+retry /
 * empty / children accordingly. Keeps every view honest about its state.
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
  if (loading) {
    return <>{skeleton ?? <DefaultSkeleton />}</>;
  }
  if (error) {
    return (
      <div className="mc-errorstate" role="alert">
        <p className="mc-errorstate__msg">發生錯誤：{error}</p>
        {onRetry ? (
          <button type="button" className="mc-btn mc-btn--ghost" onClick={onRetry}>
            重試
          </button>
        ) : null}
      </div>
    );
  }
  if (isEmpty) {
    return <EmptyState title={emptyTitle} hint={emptyHint} action={emptyAction} />;
  }
  return <>{children}</>;
}

function DefaultSkeleton() {
  return (
    <div className="mc-skel" aria-hidden="true">
      <div className="mc-skel__line" style={{ width: "60%" }} />
      <div className="mc-skel__line" style={{ width: "90%" }} />
      <div className="mc-skel__line" style={{ width: "75%" }} />
    </div>
  );
}
