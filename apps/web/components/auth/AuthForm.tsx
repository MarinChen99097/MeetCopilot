"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { apiLogin, apiRegister, setToken } from "@/lib/api";
import { authErrorKey } from "@/lib/error-i18n";
import { Spinner } from "@/components/ui/Spinner";
import { GoogleSignInButton, GOOGLE_CLIENT_ID } from "./GoogleSignInButton";

/**
 * A post-auth redirect target. Only same-origin, absolute paths are honoured (open-redirect guard);
 * a query string (e.g. an invite `?token=…`) is split out so next-intl keeps it while adding the locale.
 */
function redirectTarget(next: string | undefined): string | { pathname: string; query: Record<string, string> } {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/crm";
  const q = next.indexOf("?");
  if (q === -1) return next;
  return { pathname: next.slice(0, q), query: Object.fromEntries(new URLSearchParams(next.slice(q + 1))) };
}

/**
 * AuthForm — login/register (API_CONTRACT §1). Two paths:
 *  - Google Sign-In (primary when NEXT_PUBLIC_GOOGLE_CLIENT_ID is set) — same Google identity as EZpage.
 *  - Email/password (always present; primary when Google is not configured, e.g. local dev).
 * Both store the returned JWT (setToken) then route to /crm. `mode` toggles the register-only fields.
 */
export function AuthForm({ mode, next }: { mode: "login" | "register"; next?: string }) {
  const router = useRouter();
  const t = useTranslations("auth");
  const googleOn = Boolean(GOOGLE_CLIENT_ID);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Google is the primary path when configured → keep the password form behind a "用密碼登入" toggle.
  const [showPassword, setShowPassword] = useState(!googleOn);

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
      router.replace(redirectTarget(next));
    } catch (err) {
      setError(t(`errors.${authErrorKey(err)}`));
      setBusy(false);
    }
  }

  const errorBlock = error ? (
    <p className="mc-authcard__err" role="alert">
      {error}
    </p>
  ) : null;

  const switchLink = (
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
  );

  return (
    <main className="mc-authpage">
      <div className="mc-authcard">
        <div className="mc-authcard__brand">MeetCopilot</div>
        <h1 className="mc-authcard__title">{isRegister ? "建立帳號與組織" : "登入"}</h1>
        <p className="mc-authcard__sub">
          {googleOn
            ? "使用 Google 帳號登入即可進入 CRM 工作台。"
            : isRegister
              ? "註冊後即進入 CRM 工作台。"
              : "使用你的 Email 與密碼登入。"}
        </p>

        <GoogleSignInButton onError={setError} />

        {googleOn && !showPassword ? (
          <>
            {errorBlock}
            <button
              type="button"
              className="mc-authcard__alt"
              onClick={() => {
                setError(null);
                setShowPassword(true);
              }}
            >
              用密碼登入
            </button>
          </>
        ) : (
          <form className="mc-authform" onSubmit={onSubmit}>
            {googleOn ? (
              <div className="mc-authdivider">
                <span>或用密碼</span>
              </div>
            ) : null}

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

            {errorBlock}

            <button type="submit" className="mc-btn mc-btn--primary mc-authcard__submit" disabled={busy}>
              {busy ? <Spinner size={15} /> : isRegister ? "註冊並進入" : "登入"}
            </button>
          </form>
        )}

        {switchLink}
      </div>
    </main>
  );
}
