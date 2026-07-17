import type { ReactNode } from "react";

/** Default glyph: a clean inbox/tray outline (22px, stroke currentColor) that reads as "nothing here yet". */
const DEFAULT_ICON = (
  <svg
    viewBox="0 0 24 24"
    width={22}
    height={22}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 13l2.4-6.6A2 2 0 0 1 8.3 5h7.4a2 2 0 0 1 1.9 1.4L20 13" />
    <path d="M4 13v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    <path d="M4 13h4l1.4 2.2h5.2L16 13h4" />
  </svg>
);

/**
 * EmptyState — friendly icon + one-liner + primary CTA (PROMPT 0 通用元件 #7).
 * Presentational; caller supplies the action.
 */
export function EmptyState({
  icon = DEFAULT_ICON,
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
