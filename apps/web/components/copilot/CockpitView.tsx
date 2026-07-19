"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { readMeetingCreds, buildHudUrl, type MeetingCreds } from "@/lib/meeting-session";
import { ToastProvider } from "@/components/ui/Toast";
import { CopilotInner } from "./CopilotView";
import { HudInner } from "@/components/hud/HudView";

/**
 * /copilot cockpit — the in-meeting copilot single-window surface (account B, Chrome/Edge desktop). Renders NO
 * AppShell chrome on purpose (I3 convention: this browser tab is reached from the meeting flow and is NEVER
 * screen-shared). Two panes under ONE ToastProvider and ONE <main>: left = capture control (CopilotInner),
 * right = the live suggestion stream (HudInner — the main event).
 *
 * Both panes connect to the SAME meeting over TWO WebSockets (role=capture + role=hud): the hub imposes no
 * per-user/role connection cap, and all HUD-bound content (transcript/signals/cards/suggestions) is pushed only
 * to the hud role — so capture alone would receive nothing, hence the two sockets. Presenter approval from the
 * hud connection is authorized server-side by identity (I2), not by role.
 *
 * Creds are owned HERE: read once from storage/URL on mount, then updated when CopilotInner's SetupPanel creates
 * the meeting (onCreds) — so HudInner receives creds and connects the instant the session exists, no page reload.
 */
export function CockpitView() {
  const t = useTranslations();
  // Initialize null (not a lazy storage read) so SSR and first client render agree; the effect fills it in.
  const [creds, setCreds] = useState<MeetingCreds | null>(null);

  useEffect(() => {
    const c = readMeetingCreds();
    if (c) setCreds(c);
  }, []);

  const onCreds = useCallback((c: MeetingCreds) => setCreds(c), []);

  // Second-device HUD handoff: only exists once a session does (creds != null). buildHudUrl reads window,
  // so it is only ever called on the client after the mount effect populated creds (null on SSR/first render).
  const hudUrl = creds ? buildHudUrl(creds) : null;
  const [copied, setCopied] = useState(false);
  const copyHudLink = useCallback(async () => {
    if (!hudUrl) return;
    try {
      await navigator.clipboard.writeText(hudUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the link stays visible/selectable in the read-only field as a manual fallback */
    }
  }, [hudUrl]);

  return (
    <ToastProvider>
      <main className="mc-cockpit">
        <header className="mc-cockpit__bar">
          <span className="mc-kicker mc-kicker--live">{t("copilot.cockpitKicker")}</span>
          <h1 className="mc-cockpit__title">{t("copilot.title")}</h1>
          <p className="mc-cockpit__lead">{t("copilot.cockpitLead")}</p>
          <p className="mc-cockpit__accountb">{t("copilot.cockpitAccountB")}</p>
        </header>

        {/* Collapsible "view the HUD on another device" affordance. Outer-shell only — it lives above the
            two-column grid and does NOT touch the capture/hud panes or their sockets. When there is no session
            yet (creds == null) there is no HUD link to hand off, so we show the empty-state copy instead.
            QR NOTE: no QR-encoder dependency is bundled (see package.json), so per the approved fallback we
            render the copyable link plus a non-scannable inline-SVG placeholder frame rather than adding a dep. */}
        <details className="mc-cockpit__second">
          <summary className="mc-cockpit__second-toggle">{t("copilot.secondDeviceTitle")}</summary>
          <div className="mc-cockpit__second-body">
            <p className="mc-cockpit__second-desc">{t("copilot.secondDeviceDesc")}</p>
            {hudUrl ? (
              <div className="mc-cockpit__second-share">
                <div
                  className="mc-cockpit__second-qr"
                  role="img"
                  aria-label={t("copilot.secondDeviceQrAlt")}
                >
                  {/* Placeholder QR frame (corner finder marks only) — intentionally NOT a scannable code:
                      no encoder is bundled. Users hand off via the copyable link beside it. */}
                  <svg viewBox="0 0 48 48" width="88" height="88" aria-hidden="true" focusable="false">
                    <g fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M4 12V4h8" />
                      <path d="M44 12V4h-8" />
                      <path d="M4 36v8h8" />
                      <path d="M44 36v8h-8" />
                    </g>
                    <rect x="21" y="21" width="6" height="6" rx="1" fill="currentColor" opacity="0.35" />
                  </svg>
                </div>
                <div className="mc-cockpit__second-linkrow">
                  <input
                    className="mc-cockpit__second-link"
                    type="text"
                    readOnly
                    value={hudUrl}
                    aria-label={t("copilot.secondDeviceQrAlt")}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button
                    type="button"
                    className="mc-btn mc-btn--primary mc-btn--sm"
                    onClick={copyHudLink}
                  >
                    {copied ? t("copilot.secondDeviceCopied") : t("copilot.secondDeviceCopy")}
                  </button>
                </div>
              </div>
            ) : (
              <p className="mc-cockpit__second-empty">{t("copilot.secondDeviceEmpty")}</p>
            )}
          </div>
        </details>

        <div className="mc-cockpit__grid">
          <section className="mc-cockpit__cap" aria-label={t("copilot.captureLabel")}>
            <span className="mc-cockpit__collabel">{t("copilot.captureLabel")}</span>
            <CopilotInner embedded rootTag="section" creds={creds} onCreds={onCreds} />
          </section>

          <section className="mc-cockpit__hud" aria-label={t("copilot.hudLabel")}>
            <span className="mc-cockpit__collabel">{t("copilot.hudLabel")}</span>
            <HudInner embedded rootTag="section" creds={creds} />
          </section>
        </div>
      </main>
    </ToastProvider>
  );
}
