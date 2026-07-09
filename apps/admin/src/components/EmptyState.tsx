import type { ReactNode } from "react";

/** EmptyState — icon + 一句話 +（選用）CTA。Presentational；不可白屏。 */
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
    <div className="ad-empty">
      <div className="ad-empty__icon" aria-hidden="true">
        {icon}
      </div>
      <p className="ad-empty__title">{title}</p>
      {hint ? <p className="ad-empty__hint">{hint}</p> : null}
      {action ? <div className="ad-empty__action">{action}</div> : null}
    </div>
  );
}
