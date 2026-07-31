"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { readMeetingCreds, buildHudUrl, type MeetingCreds } from "@/lib/meeting-session";
import { CopilotInner, SetupPanel } from "./CopilotView";
import { HudInner } from "@/components/hud/HudView";

/**
 * /copilot cockpit —「會中副駕」單一視窗（帳號 B，Chrome/Edge 桌面）。
 *
 * 2026-07-30 重設計（DESIGN_APPLY W3，設計稿 :167-289）：從兩欄改成**三欄 Signal Desk**——
 *   左 230px＝擷取控制軌（CopilotInner variant="rail"）
 *   中 1fr ＝主舞台（I2 批准卡＋逐字稿＋深查）
 *   右 372px＝待講清單＋情報 tab
 * 中欄與右欄由 `HudInner layout="desk"` 一起產出（它回傳兩個 `<section>` 當 grid 子節點）。
 *
 * 本頁**掛 AppShell**（copilot/page.tsx）——帳號 B 的分頁永不被螢幕分享，掛側欄不觸及 I3。
 * ToastProvider 由 AppShell 提供，故本檔不再自行包一層。
 *
 * 兩端各自開一條 WS 連到同一場會議（role=capture + role=hud）：hub 沒有 per-user/role 連線上限，
 * 且所有 HUD 內容只推給 hud role——capture 單獨連不會收到任何東西，故需要兩條 socket。
 * 從 hud 連線送出的批准由 server 依身分授權（I2），與 role 無關。
 *
 * creds 由**本檔擁有**：mount 時讀一次 storage/URL，SetupPanel 建會後就地更新 → HUD 立刻連上，不用重整。
 */
export function CockpitView() {
  const t = useTranslations("copilot");
  // Initialize null (not a lazy storage read) so SSR and first client render agree; the effect fills it in.
  const [creds, setCreds] = useState<MeetingCreds | null>(null);
  const [resolved, setResolved] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const c = readMeetingCreds();
    if (c) setCreds(c);
    setResolved(true);
  }, []);

  const onCreds = useCallback((c: MeetingCreds) => setCreds(c), []);

  // Second-device HUD handoff: only exists once a session does (creds != null). buildHudUrl reads window,
  // so it is only ever called on the client after the mount effect populated creds.
  const hudUrl = creds ? buildHudUrl(creds) : null;
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

  const openHandoff = useCallback(() => setHandoffOpen(true), []);

  if (!resolved) return <main className="mc-desk mc-desk--setup" aria-busy="true" />;

  // 還沒有 session：整頁讓給建會表單（三欄舞台在沒有 session 時沒有東西可放）。
  if (!creds) {
    return (
      <main className="mc-desk mc-desk--setup">
        <SetupPanel rootTag="section" onReady={onCreds} />
      </main>
    );
  }

  return (
    <main className="mc-desk">
      <CopilotInner embedded rootTag="section" variant="rail" creds={creds} onCreds={onCreds} onHandoff={openHandoff} />

      <HudInner
        embedded
        rootTag="section"
        layout="desk"
        creds={creds}
        topbarExtra={
          <span className="mc-seg3" role="group" aria-label={t("viewSwitchLabel")}>
            <span className="mc-seg3__btn is-on" aria-current="true">
              {t("viewDesktop")}
            </span>
            <button type="button" className="mc-seg3__btn" onClick={openHandoff}>
              {t("viewPhone")}
            </button>
          </span>
        }
      />

      {handoffOpen && hudUrl ? (
        <div className="mc-handoff" role="dialog" aria-modal="false" aria-label={t("secondDeviceTitle")}>
          <div className="mc-handoff__head">
            <span className="mc-kicker">{t("secondDeviceTitle")}</span>
            <button
              type="button"
              className="mc-handoff__close"
              onClick={() => setHandoffOpen(false)}
              aria-label={t("close")}
            >
              ✕
            </button>
          </div>
          <p className="mc-handoff__desc">{t("secondDeviceDesc")}</p>
          <div className="mc-handoff__row">
            <input
              className="mc-input mc-handoff__link mc-mono"
              type="text"
              readOnly
              value={hudUrl}
              aria-label={t("secondDeviceLinkLabel")}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" className="mc-btn mc-btn--primary mc-btn--sm" onClick={copyHudLink}>
              {copied ? t("secondDeviceCopied") : t("secondDeviceCopy")}
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
