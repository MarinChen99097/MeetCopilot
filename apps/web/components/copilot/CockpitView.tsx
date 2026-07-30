"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { readMeetingCreds, buildHudUrl, type MeetingCreds } from "@/lib/meeting-session";
import { CopilotInner } from "./CopilotView";
import { HudInner } from "@/components/hud/HudView";

/**
 * /copilot cockpit — the in-meeting copilot single-window surface (account B, Chrome/Edge desktop).
 * Two panes under ONE <main>: left = capture control (CopilotInner), right = the live suggestion stream
 * (HudInner — the main event).
 *
 * 2026-07-28：本頁改為**掛 AppShell**（copilot/page.tsx）——帳號 B 的分頁永不被螢幕分享，掛側欄不觸及 I3，
 * 且解決「開新分頁進來後沒有回 App 路徑」。ToastProvider 由 AppShell 提供，故本檔不再自行包一層
 * （嵌套 provider 會多渲染一個 toast viewport）。
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
          2026-07-28：**這是整個「會中進行」流程裡唯一會開新分頁的地方**，而且只在使用者主動點連結時才開。
          前一版在這裡畫了一個裝飾性的假 QR（註解自承 "intentionally NOT a scannable code"）——那是誤導，
          已移除；改為誠實呈現「複製連結」這個真實的交付方式（無 QR encoder 依賴，真 QR 記為技術債）。 */}
      <details className="mc-cockpit__second">
        <summary className="mc-cockpit__second-toggle">{t("copilot.secondDeviceTitle")}</summary>
        <div className="mc-cockpit__second-body">
          <p className="mc-cockpit__second-desc">{t("copilot.secondDeviceDesc")}</p>
          {hudUrl ? (
            <div className="mc-cockpit__second-share">
              <div className="mc-cockpit__second-linkrow">
                <input
                  className="mc-cockpit__second-link"
                  type="text"
                  readOnly
                  value={hudUrl}
                  aria-label={t("copilot.secondDeviceLinkLabel")}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button type="button" className="mc-btn mc-btn--primary mc-btn--sm" onClick={copyHudLink}>
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
  );
}
