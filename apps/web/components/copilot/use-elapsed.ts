"use client";

import { useEffect, useState } from "react";

/**
 * 設計稿在 cockpit 左欄與 HUD 頂列都有一個 mono 時鐘（原稿 :173、:310）。
 * 設計稿是假資料；這裡改成**真的經過時間**（從傳入的起點算起），沒有起點就回 null → 呼叫端不渲染。
 *
 * 刻意不用「牆上時鐘」：SSR 與首次 client render 的當下時間必然不同 → hydration mismatch。
 * 起點永遠來自 client 事件（開始聆聽／首次連上），首次 render 一律 0 或 null，兩端一致。
 */
export function useElapsedLabel(startedAt: number | null): string | null {
  const [now, setNow] = useState(startedAt ?? 0);

  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  if (startedAt === null) return null;
  return formatElapsed(Math.max(0, now - startedAt));
}

/** ms → `m:ss`（超過一小時 → `h:mm:ss`）。純函式，方便測。 */
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
