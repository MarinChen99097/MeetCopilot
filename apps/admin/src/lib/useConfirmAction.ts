"use client";

import { useState } from "react";
import { errMessage } from "./api";

/**
 * useConfirmAction — 「確認後執行」的小狀態機（停權/復權等破壞性操作共用）。
 * 持有 pending（待確認項）/busy/error；request 開啟確認、confirm 執行 perform、cancel 關閉。
 * perform 失敗轉 zh-TW 訊息；成功後清 pending 並呼叫 onDone（通常 reload）。
 */
export function useConfirmAction<T>(perform: (item: T) => Promise<unknown>, onDone: () => void) {
  const [pending, setPending] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function request(item: T) {
    setError(null);
    setPending(item);
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await perform(pending);
      setPending(null);
      setBusy(false);
      onDone();
    } catch (err) {
      setBusy(false);
      setError(errMessage(err, "操作失敗，請稍後再試"));
    }
  }

  function cancel() {
    if (!busy) {
      setPending(null);
      setError(null);
    }
  }

  return { pending, busy, error, request, confirm, cancel };
}
