"use client";

import { AdminShell } from "@/components/AdminShell";
import { StateBoundary } from "@/components/StateBoundary";
import { StatusBadge, ReadyBadge } from "@/components/StatusBadge";
import { getHealth } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { fmtNumber, fmtUptime } from "@/lib/format";

export default function HealthPage() {
  return (
    <AdminShell title="系統健康">
      <HealthBody />
    </AdminShell>
  );
}

function HealthBody() {
  const q = useAsync(() => getHealth(), []);
  const h = q.data;

  return (
    <div className="ad-page">
      <div className="ad-toolbar ad-toolbar--end">
        <button type="button" className="ad-btn ad-btn--ghost ad-btn--sm" onClick={q.reload}>
          ↻ 重新整理
        </button>
      </div>

      <StateBoundary loading={q.loading} error={q.error} onRetry={q.reload}>
        {h ? (
          <>
            {!h.ready ? (
              <div className="ad-alert ad-alert--danger" role="alert">
                系統目前 <strong>NOT READY</strong>——請立即檢查資料庫與相依服務。
              </div>
            ) : null}

            <section className={`ad-card ad-health-hero ${h.ready ? "" : "ad-health-hero--down"}`}>
              <div>
                <div className="ad-health-hero__label">整體就緒狀態</div>
                <div className="ad-health-hero__badge">
                  <ReadyBadge ready={h.ready} />
                </div>
              </div>
              <div className="ad-health-hero__version">
                版本 <code>{h.version || "dev"}</code>
              </div>
            </section>

            <section className="ad-health-grid">
              <HealthTile label="資料庫" value={h.db.ok ? "正常" : "異常"} tone={h.db.ok ? "ok" : "danger"} sub={`driver：${h.db.driver}`} />
              <HealthTile label="Gemini 金鑰" value={h.providers.gemini ? "已設定" : "未設定"} tone={h.providers.gemini ? "ok" : "warn"} sub="僅檢查金鑰存在，不驗即時連通" />
              <HealthTile label="OpenAI 金鑰" value={h.providers.openai ? "已設定" : "未設定"} tone={h.providers.openai ? "ok" : "warn"} sub="僅檢查金鑰存在，不驗即時連通" />
              <HealthTile label="進行中會議" value={fmtNumber(h.liveMeetings)} tone="info" sub="即時 live meetings" />
              <HealthTile label="運行時間" value={fmtUptime(h.uptimeSec)} tone="muted" sub="自上次啟動" />
            </section>
          </>
        ) : null}
      </StateBoundary>
    </div>
  );
}

function HealthTile({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone: "ok" | "danger" | "warn" | "info" | "muted";
  sub?: string;
}) {
  return (
    <div className="ad-htile">
      <div className="ad-htile__label">{label}</div>
      <div className="ad-htile__value">
        <StatusBadge tone={tone}>{value}</StatusBadge>
      </div>
      {sub ? <div className="ad-htile__sub">{sub}</div> : null}
    </div>
  );
}
