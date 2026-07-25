"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, getHealth } from "@/lib/api";
import { setToken } from "@/lib/auth";
import { GoogleSignInButton, GOOGLE_CLIENT_ID } from "@/components/GoogleSignInButton";

/**
 * /login — 平台管理後台登入（ADMIN_CONTRACT §5），**純 Google 登入**。
 * 取得 Google 憑證換到 token 後 **探測 /api/admin/health 確認 platformAdmin**：
 *  - 成功 → 進 /（總覽）。
 *  - 403 → 「此帳號非平台管理員」並登出（清 token）。
 * Email/密碼登入 UI 已自前端移除（後端 /api/auth/login 仍在）。
 */
export default function LoginPage() {
  const router = useRouter();
  const googleOn = Boolean(GOOGLE_CLIENT_ID);
  const [error, setError] = useState<string | null>(null);

  /** 拿到 token 後驗證是否平台管理員，是則進站，否則登出並提示。 */
  const verifyAndEnter = useCallback(
    async (token: string) => {
      setError(null);
      setToken(token);
      try {
        await getHealth(); // admin 探測：403 = 非 platformAdmin
        router.replace("/");
      } catch (err) {
        setToken(null); // 探測失敗一律清 token
        if (err instanceof ApiError && err.status === 403) {
          setError("此帳號非平台管理員，無法登入後台。");
        } else if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("連線失敗，請稍後再試。");
        }
      }
    },
    [router],
  );

  return (
    <main className="ad-authpage">
      <div className="ad-authcard">
        <div className="ad-authcard__brand">
          <span className="ad-authcard__logo">MC</span>
          MeetCopilot
        </div>
        <h1 className="ad-authcard__title">平台管理後台</h1>
        <p className="ad-authcard__sub">僅限平台管理員登入。使用 Google 帳號登入。</p>

        {googleOn ? (
          <GoogleSignInButton onToken={verifyAndEnter} onError={setError} />
        ) : (
          <p className="ad-authcard__hint" role="alert">
            Google 登入尚未設定，請設定 NEXT_PUBLIC_GOOGLE_CLIENT_ID。
          </p>
        )}

        {error ? (
          <p className="ad-authcard__err" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
