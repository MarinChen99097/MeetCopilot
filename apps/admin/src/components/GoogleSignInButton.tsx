"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, apiGoogleLogin } from "@/lib/api";
import { Spinner } from "./Spinner";

/**
 * GoogleSignInButton — 官方 GIS 按鈕；取得 Google 憑證後換 MeetCopilot JWT（apiGoogleLogin），
 * 再把 token 交回 parent（onToken）由 /login 驗證 platformAdmin。用 NEXT_PUBLIC_GOOGLE_CLIENT_ID。
 * 未設該 env → 不渲染（dev 退回 email/密碼）。
 */
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

const GSI_SRC = "https://accounts.google.com/gsi/client";

interface GsiCredentialResponse {
  credential?: string;
}
interface GsiIdApi {
  initialize(config: { client_id: string; callback: (r: GsiCredentialResponse) => void }): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
}
declare global {
  interface Window {
    google?: { accounts?: { id?: GsiIdApi } };
  }
}

let gsiScriptPromise: Promise<void> | null = null;
function loadGsi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gsiScriptPromise) return gsiScriptPromise;
  gsiScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    const script = existing ?? document.createElement("script");
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error("failed to load Google Sign-In")));
    if (!existing) document.head.appendChild(script);
  });
  return gsiScriptPromise;
}

export function GoogleSignInButton({
  onToken,
  onError,
}: {
  onToken: (token: string) => void;
  onError?: (message: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;

    async function onCredential(response: GsiCredentialResponse) {
      const credential = response.credential;
      if (!credential) {
        onError?.("Google 未回傳憑證，請重試");
        return;
      }
      setBusy(true);
      try {
        const res = await apiGoogleLogin(credential);
        if (!cancelled) onToken(res.token);
      } catch (err) {
        if (!cancelled) {
          setBusy(false);
          onError?.(err instanceof ApiError ? err.message : "Google 登入失敗，請稍後再試");
        }
      }
    }

    loadGsi()
      .then(() => {
        if (cancelled) return;
        const idApi = window.google?.accounts?.id;
        const parent = containerRef.current;
        if (!idApi || !parent) return;
        idApi.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onCredential });
        parent.innerHTML = "";
        idApi.renderButton(parent, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "signin_with",
          shape: "rectangular",
          logo_alignment: "left",
          width: 320,
          locale: "zh_TW",
        });
      })
      .catch(() => {
        if (!cancelled) onError?.("無法載入 Google 登入");
      });

    return () => {
      cancelled = true;
    };
  }, [onToken, onError]);

  if (!GOOGLE_CLIENT_ID) return null;

  return (
    <div className="ad-google">
      <div ref={containerRef} className="ad-google__btn" aria-busy={busy} />
      {busy ? (
        <p className="ad-google__busy">
          <Spinner size={14} /> 登入中…
        </p>
      ) : null}
    </div>
  );
}
