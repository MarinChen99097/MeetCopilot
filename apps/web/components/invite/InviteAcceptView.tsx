"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { ApiError, acceptOrgInvite, apiMe, getToken, logout, type MeResponse } from "@/lib/api";
import { inviteErrorKey } from "@/lib/error-i18n";
import { Spinner } from "@/components/ui/Spinner";

/**
 * InviteAcceptView — the receiving end of the invite flow (P0-1). Reached at `/{locale}/invite?token=…`
 * (the link the server hands the inviter). Deliberately OUTSIDE AppShell/AuthGuard so a logged-out
 * invitee can land here without being bounced to /login:
 *  - no token            → human error + back to app.
 *  - not logged in       → prompt to sign in / register, carrying `next` so we return here after auth.
 *  - logged in           → show who we are + "accept", POST /api/org/invites/accept.
 *  - accepted            → confirmation, then route into /crm.
 *  - server error        → mapped zh-TW/en message (invalid/expired/mismatch/…) + recovery links.
 */
type Phase = "checking" | "guest" | "authed" | "accepting" | "accepted" | "error";

export function InviteAcceptView({ token }: { token: string | null }) {
  const t = useTranslations("org.invite");
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(token ? "checking" : "error");
  const [errKey, setErrKey] = useState<string>(token ? "generic" : "missingToken");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [orgName, setOrgName] = useState<string>("");

  // Where auth should send the user back to (token preserved so accept can proceed on return).
  const nextPath = token ? `/invite?token=${encodeURIComponent(token)}` : "/invite";
  const loginHref = { pathname: "/login", query: { next: nextPath } };
  const registerHref = { pathname: "/register", query: { next: nextPath } };

  useEffect(() => {
    if (!token) return;
    let alive = true;
    if (!getToken()) {
      setPhase("guest");
      return;
    }
    apiMe()
      .then((res) => {
        if (!alive) return;
        setMe(res);
        setPhase("authed");
      })
      .catch(() => {
        if (!alive) return;
        // Token missing/expired/invalid → drop it and treat as a guest.
        logout();
        setPhase("guest");
      });
    return () => {
      alive = false;
    };
  }, [token]);

  const onAccept = useCallback(async () => {
    if (!token) return;
    setPhase("accepting");
    try {
      const res = await acceptOrgInvite(token);
      setOrgName(res.org.name);
      setPhase("accepted");
      setTimeout(() => router.replace("/crm"), 1400);
    } catch (err) {
      setErrKey(inviteErrorKey(err));
      setPhase("error");
    }
  }, [token, router]);

  const onUseAnotherAccount = useCallback(() => {
    logout();
    router.replace(loginHref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextPath, router]);

  let body: React.ReactNode;
  if (phase === "checking" || phase === "accepting") {
    body = (
      <div className="mc-authcard__actions" aria-live="polite">
        <Spinner size={18} />
        <span className="mc-authcard__sub">{phase === "checking" ? t("checking") : t("accepting")}</span>
      </div>
    );
  } else if (phase === "guest") {
    body = (
      <>
        <p className="mc-authcard__sub">{t("guestLead")}</p>
        <div className="mc-authcard__actions">
          <Link href={loginHref} className="mc-btn mc-btn--primary">
            {t("signIn")}
          </Link>
          <Link href={registerHref} className="mc-btn mc-btn--ghost">
            {t("register")}
          </Link>
        </div>
      </>
    );
  } else if (phase === "authed") {
    body = (
      <>
        <p className="mc-authcard__sub">{t("authedLead", { email: me?.user.email ?? "" })}</p>
        <div className="mc-authcard__actions">
          <button type="button" className="mc-btn mc-btn--primary" onClick={onAccept}>
            {t("accept")}
          </button>
          <button type="button" className="mc-btn mc-btn--ghost" onClick={onUseAnotherAccount}>
            {t("useAnotherAccount")}
          </button>
        </div>
      </>
    );
  } else if (phase === "accepted") {
    body = (
      <>
        <h1 className="mc-authcard__title">{t("acceptedTitle")}</h1>
        <p className="mc-authcard__sub">{t("acceptedLead", { org: orgName })}</p>
        <div className="mc-authcard__actions">
          <Link href="/crm" className="mc-btn mc-btn--primary">
            {t("goToCrm")}
          </Link>
        </div>
      </>
    );
  } else {
    // error
    body = (
      <>
        <h1 className="mc-authcard__title">{t("errorTitle")}</h1>
        <p className="mc-authcard__err" role="alert">
          {t(`errors.${errKey}`)}
        </p>
        <div className="mc-authcard__actions">
          {errKey === "emailMismatch" ? (
            <button type="button" className="mc-btn mc-btn--primary" onClick={onUseAnotherAccount}>
              {t("useAnotherAccount")}
            </button>
          ) : null}
          <Link href="/crm" className="mc-btn mc-btn--ghost">
            {t("backToApp")}
          </Link>
        </div>
      </>
    );
  }

  return (
    <main className="mc-authpage">
      <div className="mc-authcard">
        <div className="mc-authcard__brand">MeetCopilot</div>
        {phase !== "accepted" && phase !== "error" ? <h1 className="mc-authcard__title">{t("title")}</h1> : null}
        {body}
      </div>
    </main>
  );
}
