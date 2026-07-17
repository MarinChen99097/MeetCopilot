"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { readMeetingCreds, type MeetingCreds } from "@/lib/meeting-session";
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

  return (
    <ToastProvider>
      <main className="mc-cockpit">
        <header className="mc-cockpit__bar">
          <span className="mc-kicker mc-kicker--live">{t("copilot.cockpitKicker")}</span>
          <h1 className="mc-cockpit__title">{t("copilot.title")}</h1>
          <p className="mc-cockpit__lead">{t("copilot.cockpitLead")}</p>
        </header>

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
