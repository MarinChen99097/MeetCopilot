"use client";

import { useCallback, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiLogin, errMessage, getHealth } from "@/lib/api";
import { setToken } from "@/lib/auth";
import { Spinner } from "@/components/Spinner";
import { GoogleSignInButton, GOOGLE_CLIENT_ID } from "@/components/GoogleSignInButton";

/**
 * /login — 平台管理後台登入（ADMIN_CONTRACT §5）。
 * Email+密碼 ＋（若 NEXT_PUBLIC_GOOGLE_CLIENT_ID 有設）Google 登入。
 * 登入取得 token 後 **探測 /api/admin/health 確認 platformAdmin**：
 *  - 成功 → 進 /（總覽）。
 *  - 403 → 「此帳號非平台管理員」並登出（清 token）。
 */
export default function LoginPage() {
  const router = useRouter();
  const googleOn = Boolean(GOOGLE_CLIENT_ID);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(!googleOn);

  /** 共用：拿到 token 後驗證是否平台管理員，是則進站，否則登出並提示。 */
  const verifyAndEnter = useCallback(
    async (token: string) => {
      setBusy(true);
      setError(null);
      setToken(token);
      try {
        await getHealth(); // admin 探測：403 = 非 platformAdmin
        router.replace("/");
      } catch (err) {
        setToken(null); // 探測失敗一律清 token
        setBusy(false);
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiLogin({ email, password });
      await verifyAndEnter(res.token);
    } catch (err) {
      setBusy(false);
      setError(errMessage(err, "連線失敗，請稍後再試。"));
    }
  }

  return (
    <main className="ad-authpage">
      <div className="ad-authcard">
        <div className="ad-authcard__brand">
          <span className="ad-authcard__logo">MC</span>
          MeetCopilot
        </div>
        <h1 className="ad-authcard__title">平台管理後台</h1>
        <p className="ad-authcard__sub">
          僅限平台管理員登入。{googleOn ? "使用 Google 帳號或 Email 登入。" : "使用你的 Email 與密碼登入。"}
        </p>

        {googleOn ? <GoogleSignInButton onToken={verifyAndEnter} onError={setError} /> : null}

        {googleOn && !showPassword ? (
          <>
            {error ? (
              <p className="ad-authcard__err" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="button"
              className="ad-authcard__alt"
              onClick={() => {
                setError(null);
                setShowPassword(true);
              }}
            >
              用密碼登入
            </button>
          </>
        ) : (
          <form className="ad-authform" onSubmit={onSubmit}>
            {googleOn ? (
              <div className="ad-authdivider">
                <span>或用密碼</span>
              </div>
            ) : null}
            <label className="ad-field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </label>
            <label className="ad-field">
              <span>密碼</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </label>

            {error ? (
              <p className="ad-authcard__err" role="alert">
                {error}
              </p>
            ) : null}

            <button type="submit" className="ad-btn ad-btn--primary ad-authcard__submit" disabled={busy}>
              {busy ? <Spinner size={15} /> : "登入"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
