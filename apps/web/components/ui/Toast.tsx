"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * Toast — transient stackable notifications (PROMPT 0 通用元件 #6).
 * `useToast()` returns `push({ kind, message })`; the provider renders an aria-live viewport.
 * Presentational + injectable: callers fire toasts on confirm/save success/failure.
 */
export type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  push: (t: { kind: ToastKind; message: string }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    ({ kind, message }: { kind: ToastKind; message: string }) => {
      const id = ++seq.current;
      setItems((prev) => [...prev, { id, kind, message }]);
      window.setTimeout(() => remove(id), 4200);
    },
    [remove],
  );

  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="mc-toast-viewport" role="status" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} className={`mc-toast mc-toast--${t.kind}`}>
            <span className="mc-toast__dot" aria-hidden="true" />
            <span className="mc-toast__msg">{t.message}</span>
            <button type="button" className="mc-toast__close" aria-label="關閉通知" onClick={() => remove(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
