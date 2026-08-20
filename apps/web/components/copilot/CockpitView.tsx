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
  /** 會議已結束、正在導回首頁的過渡旗標（見 `onMeetingEnded`）。creds 已是 null，但**還不能**顯示建會表單。 */
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    const c = readMeetingCreds();
    if (c) setCreds(c);
    setResolved(true);
  }, []);

  const onCreds = useCallback((c: MeetingCreds) => {
    setEnded(false);
    setCreds(c);
  }, []);

  // 會議已在 server 端結束 → 清掉本檔擁有的 creds。**必要**：HudInner 那條 socket 的 `enabled: !!creds`
  // 與 rail 的 phase 無關，只有這裡設 null 才會斷；順帶把交接面板收起來（那條 hudUrl 已失效）。
  // `ended` 旗標：呼叫端清完 creds 後會 `router.push("/")`，但那個 navigation transition 不是同步的——
  // 這中間 `!creds` 會讓下面渲染 SetupPanel，剛結束會議的人會看到、甚至能操作一個「建立新會議」表單。
  // 立旗標讓那一段改成明確的過渡畫面。
  const onMeetingEnded = useCallback(() => {
    setEnded(true);
    setCreds(null);
    setHandoffOpen(false);
  }, []);

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

  // 剛結束會議、導航還沒完成：只顯示過渡狀態。**不可以**在這裡落到下面的建會表單。
  if (ended) {
    return (
      <main className="mc-desk mc-desk--setup">
        {/* 文案刻意只講「正在離開」——這個畫面也會由 end-failed 的「離開這場會議」帶出來，那條路上
            「會議已結束」正是我們**不能**斷言的事（結果如何由 toast 說）。 */}
        <div className="mc-hudm__note" role="status">
          <span className="mc-hudm__spinner" aria-hidden="true" />
          <p className="mc-hudm__notetitle">{t("meetingEndedReturning")}</p>
        </div>
      </main>
    );
  }

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
      <CopilotInner
        embedded
        rootTag="section"
        variant="rail"
        creds={creds}
        onCreds={onCreds}
        onHandoff={openHandoff}
        onMeetingEnded={onMeetingEnded}
      />

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
