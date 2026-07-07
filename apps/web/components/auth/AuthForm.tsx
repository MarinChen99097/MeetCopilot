"use client";

import { useState, type FormEvent } from "react";
import { useRouter, Link } from "@/i18n/navigation";
import { ApiError, apiLogin, apiRegister, setToken } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";

/**
 * AuthForm — minimal login/register (API_CONTRACT §1). Stores the returned JWT in localStorage
 * (lib/api setToken) then routes to /crm. `mode` toggles the register-only fields.
 */
export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRegister = mode === "register";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = isRegister
        ? await apiRegister({ email, password, displayName, orgName })
        : await apiLogin({ email, password });
      setToken(res.token);
      router.replace("/crm");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "連線失敗，請稍後再試");
      setBusy(false);
    }
  }

  return (
    <main className="mc-authpage">
      <form className="mc-authcard" onSubmit={onSubmit}>
        <div className="mc-authcard__brand">MeetCopilot</div>
        <h1 className="mc-authcard__title">{isRegister ? "建立帳號與組織" : "登入"}</h1>
        <p className="mc-authcard__sub">
          {isRegister ? "註冊後即進入 CRM 工作台。" : "使用你的 Email 與密碼登入。"}
        </p>

        {isRegister ? (
          <label className="mc-field">
            <span>顯示名稱</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required autoComplete="name" />
          </label>
        ) : null}
        {isRegister ? (
          <label className="mc-field">
            <span>組織名稱</span>
            <input value={orgName} onChange={(e) => setOrgName(e.target.value)} required autoComplete="organization" />
          </label>
        ) : null}
        <label className="mc-field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label className="mc-field">
          <span>密碼</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete={isRegister ? "new-password" : "current-password"}
          />
        </label>

        {error ? (
          <p className="mc-authcard__err" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="mc-btn mc-btn--primary mc-authcard__submit" disabled={busy}>
          {busy ? <Spinner size={15} /> : isRegister ? "註冊並進入" : "登入"}
        </button>

        <p className="mc-authcard__switch">
          {isRegister ? (
            <>
              已有帳號？<Link href="/login">登入</Link>
            </>
          ) : (
            <>
              還沒有帳號？<Link href="/register">建立組織</Link>
            </>
          )}
        </p>
      </form>
    </main>
  );
}
