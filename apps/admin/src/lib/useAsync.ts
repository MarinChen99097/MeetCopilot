"use client";

import { useCallback, useEffect, useState } from "react";
import { errMessage } from "./api";

/**
 * useAsync — 極簡資料抓取 hook：跑 async fn，追蹤 loading/error/data，附 reload。
 * deps 變更時自動重抓；race 用 alive flag 防護。錯誤一律轉成 zh-TW 訊息字串。
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fn()
      .then((res) => {
        if (!alive) return;
        setData(res);
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setError(errMessage(err, "連線失敗，請稍後再試"));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, reload };
}
