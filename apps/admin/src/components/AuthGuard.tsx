"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiMe, getHealth } from "@/lib/api";
import type { MeResponse } from "@/lib/api-types";
import { getToken, logout } from "@/lib/auth";
import { Spinner } from "./Spinner";

/**
 * AuthGuard — admin surface 的 client 端守衛（ADMIN_CONTRACT §5 + A1）。
 *  - 無 token → 導向 /login。
 *  - 呼叫 /api/auth/me 取身分（topbar 顯示 email）＋探測 /api/admin/health 確認 platformAdmin。
 *  - 探測回 403 → 非平台管理員：清 token、顯示提示、導回 /login（A1 前端側呼應）。
 *  - 401 → token 失效：清 token、導回 /login。
 */
const MeContext = createContext<MeResponse | null>(null);

export function useMe(): MeResponse | null {
  return useContext(MeContext);
}

type Phase = "checking" | "ready" | "denied" | "redirecting";

export function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    let alive = true;
    const token = getToken();
    if (!token) {
      setPhase("redirecting");
      router.replace("/login");
      return;
    }
    // 身分 + admin 探測並行；探測（getHealth）成功即確認 platformAdmin。
    Promise.all([apiMe(), getHealth()])
      .then(([meRes]) => {
        if (!alive) return;
        setMe(meRes);
        setPhase("ready");
      })
      .catch((err) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 403) {
          // 合法登入但非平台管理員。
          logout();
          setPhase("denied");
          return;
        }
        // 401 / 其他 → 清 token 導回登入。
        logout();
        setPhase("redirecting");
        router.replace("/login");
      });
    return () => {
      alive = false;
    };
  }, [router]);

  if (phase === "denied") {
    return (
      <div className="ad-gate">
        <div className="ad-gate__card">
          <h1 className="ad-gate__title">此帳號非平台管理員</h1>
          <p className="ad-gate__msg">你的帳號沒有平台後台權限。請以獲授權的管理員帳號登入。</p>
          <button
            type="button"
            className="ad-btn ad-btn--primary"
            onClick={() => router.replace("/login")}
          >
            回登入頁
          </button>
        </div>
      </div>
    );
  }

  if (phase !== "ready" || !me) {
    return (
      <div className="ad-gate ad-gate--checking">
        <Spinner size={22} />
        <span>驗證管理員權限…</span>
      </div>
    );
  }

  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}
