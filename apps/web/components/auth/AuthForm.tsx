"use client";

import { useState } from "react";
import { GoogleSignInButton, GOOGLE_CLIENT_ID } from "./GoogleSignInButton";

/**
 * AuthForm — login/register (API_CONTRACT §1), **Google-only**.
 * The single auth path is Google Sign-In (same Google identity as EZpage); GoogleSignInButton
 * stores the returned JWT and routes to the home dashboard ("/"). Email/password UI has been
 * removed from the frontend (the /api/auth/login|register endpoints still exist server-side).
 * `mode` only toggles the title/subtitle copy; the `next?` prop is kept in the signature so the
 * login/register pages can keep passing it without a compile break.
 */
export function AuthForm({ mode }: { mode: "login" | "register"; next?: string }) {
  const [error, setError] = useState<string | null>(null);
  const googleOn = Boolean(GOOGLE_CLIENT_ID);

  const isRegister = mode === "register";

  const errorBlock = error ? (
    <p className="mc-authcard__err" role="alert">
      {error}
    </p>
  ) : null;

  return (
    <main className="mc-authpage">
      <div className="mc-authcard">
        <div className="mc-authcard__brand">MeetCopilot</div>
        <h1 className="mc-authcard__title">{isRegister ? "建立帳號與組織" : "登入"}</h1>
        <p className="mc-authcard__sub">使用 Google 帳號登入即可進入 CRM 工作台。</p>

        {googleOn ? (
          <>
            <GoogleSignInButton onError={setError} />
            {errorBlock}
          </>
        ) : (
          <p className="mc-authcard__hint" role="alert">
            Google 登入尚未設定，請設定 NEXT_PUBLIC_GOOGLE_CLIENT_ID。
          </p>
        )}
      </div>
    </main>
  );
}
