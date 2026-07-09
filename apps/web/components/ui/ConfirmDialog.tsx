"use client";

import { useId, type ReactNode } from "react";

/** confirm 按鈕語氣：primary（預設）／accent（次要動作，如生圖）／danger（破壞性動作）。 */
export type ConfirmTone = "primary" | "accent" | "danger";

const TONE_CLASS: Record<ConfirmTone, string> = {
  primary: "mc-btn--primary",
  accent: "mc-btn--accent",
  danger: "mc-btn--danger-solid",
};

/**
 * ConfirmDialog — 共用「確認／取消」對話框。合併原本各自實作、幾乎同構的兩個確認框
 * （SlideEditor 生圖預警 `.mc-confirm` 與 PersonaPicker 對練前確認 `.mc-modal`）。
 * 純本地確認、與 I1/I2/I3 不變量無關。`message` 為 ReactNode，呼叫端放任意內文（段落／清單…）。
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  confirmTone = "primary",
  dismissOnBackdrop = false,
  ariaLabel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** confirm 按鈕語氣（含危險樣式旗標：傳 "danger"）。預設 "primary"。 */
  confirmTone?: ConfirmTone;
  /** 點背景 = 取消。預設 false（點背景不關，維持 SlideEditor 原行為）。 */
  dismissOnBackdrop?: boolean;
  /** 若提供則以 aria-label 命名對話框，取代預設的 aria-labelledby(title)。 */
  ariaLabel?: string;
}) {
  const titleId = useId();
  return (
    <div
      className="mc-confirm"
      role="dialog"
      aria-modal="true"
      {...(ariaLabel ? { "aria-label": ariaLabel } : { "aria-labelledby": titleId })}
    >
      <div
        className="mc-confirm__backdrop"
        aria-hidden="true"
        onClick={dismissOnBackdrop ? onCancel : undefined}
      />
      <div className="mc-confirm__panel">
        <h2 id={titleId} className="mc-confirm__title">
          {title}
        </h2>
        <div className="mc-confirm__body">{message}</div>
        <div className="mc-confirm__acts">
          <button type="button" className="mc-btn mc-btn--ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className={`mc-btn ${TONE_CLASS[confirmTone]}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
