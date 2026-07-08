"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { ApiError, apiGoogleLogin, setToken } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";

/**
 * GoogleSignInButton — renders the official Google Identity Services (GIS) button and, on credential,
 * exchanges the Google ID token for a MeetCopilot JWT (apiGoogleLogin) exactly like the password login
 * does (setToken → /crm). Uses NEXT_PUBLIC_GOOGLE_CLIENT_ID (build-time). When that env is unset the
 * component renders nothing, so local dev falls back to the email/password form.
 *
 * The verified Google email is the shared key with EZpage — same account across both apps.
 */

/** Public client id, baked at build time. Empty when unset → Google login unavailable (dev fallback). */
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
/** Inject the GIS script once (shared across mounts); resolves when window.google.accounts.id is ready. */
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

export function GoogleSignInButton({ onError }: { onError?: (message: string) => void }) {
  const router = useRouter();
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
        setToken(res.token);
        router.replace("/crm");
      } catch (err) {
        setBusy(false);
        onError?.(err instanceof ApiError ? err.message : "Google 登入失敗，請稍後再試");
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
  }, [router, onError]);

  if (!GOOGLE_CLIENT_ID) return null;

  return (
    <div className="mc-google">
      <div ref={containerRef} className="mc-google__btn" aria-busy={busy} />
      {busy ? (
        <p className="mc-google__busy">
          <Spinner size={14} /> 登入中…
        </p>
      ) : null}
    </div>
  );
}
