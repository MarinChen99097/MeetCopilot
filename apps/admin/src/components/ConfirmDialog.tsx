"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Spinner } from "./Spinner";

/**
 * ConfirmDialog — 二次確認對話框（停權/復權等破壞性動作）。
 * 原生 <dialog>：Esc 關閉、backdrop、焦點鎖。busy 時鎖住按鈕並顯示 Spinner。
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "確認",
  cancelLabel = "取消",
  tone = "danger",
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      className="ad-dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 className="ad-dialog__title">{title}</h2>
      <div className="ad-dialog__body">{message}</div>
      {error ? (
        <p className="ad-dialog__err" role="alert">
          {error}
        </p>
      ) : null}
      <div className="ad-dialog__actions">
        <button type="button" className="ad-btn ad-btn--ghost" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`ad-btn ${tone === "danger" ? "ad-btn--danger" : "ad-btn--primary"}`}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? <Spinner size={14} /> : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
