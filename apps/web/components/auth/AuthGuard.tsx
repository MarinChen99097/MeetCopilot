"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "@/i18n/navigation";
import { ApiError, apiMe, getToken, logout, type MeResponse } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";

/**
 * AuthGuard — client-side guard for authed surfaces (/crm). No token → redirect to /login;
 * expired/invalid (401) → clear token + redirect. Exposes the current session via `useMe()`
 * so app chrome (topbar) can show org/user/role. Auth is JWT-in-localStorage (lib/api).
 */
const MeContext = createContext<MeResponse | null>(null);

export function useMe(): MeResponse | null {
  return useContext(MeContext);
}

type Phase = "checking" | "ready" | "redirecting";

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
    apiMe()
      .then((res) => {
        if (!alive) return;
        setMe(res);
        setPhase("ready");
      })
      .catch((err) => {
        if (!alive) return;
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          logout();
        }
        setPhase("redirecting");
        router.replace("/login");
      });
    return () => {
      alive = false;
    };
  }, [router]);

  if (phase !== "ready" || !me) {
    return (
      <div className="mc-auth-checking">
        <Spinner size={22} />
        <span>驗證登入狀態…</span>
      </div>
    );
  }

  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}
