import type { ReactNode } from "react";

/**
 * EmptyState — friendly icon + one-liner + primary CTA (PROMPT 0 通用元件 #7).
 * Presentational; caller supplies the action.
 */
export function EmptyState({
  icon = "◦",
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mc-empty">
      <div className="mc-empty__icon" aria-hidden="true">
        {icon}
      </div>
      <p className="mc-empty__title">{title}</p>
      {hint ? <p className="mc-empty__hint">{hint}</p> : null}
      {action ? <div className="mc-empty__action">{action}</div> : null}
    </div>
  );
}
