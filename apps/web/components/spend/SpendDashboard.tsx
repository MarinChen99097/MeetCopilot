"use client";

/**
 * AI 花費 dashboard（apps/web，owner/admin）——本 org 自己的 AI 用量：花了多少 token、用了哪些 model、成本多少。
 * 資料＝GET /api/org/usage（依 kind/model/day 分組）＋ /api/org/usage/events（明細）。org 由 JWT 推導、租戶隔離。
 *
 * 稅率：後端記的 est_cost_usd 是「稅前」估算值（供應商定價凍結於寫入時）；本頁以 TAX_MULTIPLIER=1.25 顯示「含稅」欄
 * （稅前 → ×1.25 → 含稅），比照 ezpage admin console 的雙價欄呈現。花費為估算值、非帳單金額。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getOrgUsage,
  getOrgUsageEvents,
  type OrgUsage,
  type OrgUsageEvent,
  type OrgUsageGroupBy,
} from "@/lib/api";
import { fmtCompact, fmtDate, fmtDateTime, fmtNumber, fmtUsd } from "@/lib/format";

/** 稅率倍率（稅前 → 含稅）。集中一處，改這裡即改全頁。 */
const TAX_MULTIPLIER = 1.25;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 6 種計費項目（USAGE_KINDS）的 zh-TW 標籤。 */
const KIND_LABELS: Record<string, string> = {
  gemini_text: "文字生成（會中/簡報/評分）",
  gemini_extract: "研究抽取",
  gemini_live: "語音對練（Live）",
  openai_image: "AI 生圖",
  embedding: "向量檢索",
  asr: "語音辨識（ASR）",
};

const GROUP_BY_OPTIONS: { value: OrgUsageGroupBy; label: string }[] = [
  { value: "kind", label: "項目" },
  { value: "model", label: "模型" },
  { value: "day", label: "日期" },
];

/** YYYY-MM-DD（本地）→ epoch ms（start=當日 00:00；end=當日 23:59:59.999）。 */
function dayToEpoch(d: string, end: boolean): number {
  return new Date(`${d}T${end ? "23:59:59.999" : "00:00:00.000"}`).getTime();
}
/** epoch ms → YYYY-MM-DD（本地，供 <input type=date>）。 */
function epochToDay(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function rowLabel(key: string, groupBy: OrgUsageGroupBy): string {
  if (groupBy === "kind") return KIND_LABELS[key] ?? key;
  if (key === "(none)") return "（未標記）";
  return key;
}

export function SpendDashboard() {
  const now = Date.now();
  const [fromDay, setFromDay] = useState(() => epochToDay(now - 30 * DAY_MS));
  const [toDay, setToDay] = useState(() => epochToDay(now));
  const [groupBy, setGroupBy] = useState<OrgUsageGroupBy>("kind");

  const [data, setData] = useState<OrgUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const from = dayToEpoch(fromDay, false);
  const to = dayToEpoch(toDay, true);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    getOrgUsage({ from, to, groupBy })
      .then((d) => setData(d))
      .catch((e) => setErr((e as Error).message || "載入失敗"))
      .finally(() => setLoading(false));
  }, [from, to, groupBy]);

  useEffect(() => {
    load();
  }, [load]);

  function quickRange(days: number) {
    setFromDay(epochToDay(Date.now() - days * DAY_MS));
    setToDay(epochToDay(Date.now()));
  }

  const maxCost = useMemo(() => Math.max(0, ...(data?.rows ?? []).map((r) => r.costUsd)), [data]);
  const preTaxTotal = data?.totalCostUsd ?? 0;
  // 含稅由後端以每列稅率快照加總（019）；退回 ×預設稅率僅為缺值兜底。
  const postTaxTotal = data?.totalCostUsdPosttax ?? preTaxTotal * TAX_MULTIPLIER;
  const totalTokens = (data?.totalInputTokens ?? 0) + (data?.totalOutputTokens ?? 0);
  const totalEvents = (data?.rows ?? []).reduce((s, r) => s + r.events, 0);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "1.25rem 1rem 3rem" }}>
      <header style={{ marginBottom: "1rem" }}>
        <span className="mc-kicker">管理</span>
        <h1 style={{ margin: "0.2rem 0 0.3rem", fontSize: "1.5rem" }}>AI 花費</h1>
        <p style={{ margin: 0, color: "var(--mc-text-dim, #9aa3b8)", fontSize: "0.9rem" }}>
          本組織的 AI 用量：花了多少 token、用了哪些模型、成本多少（含稅＝稅前 × {TAX_MULTIPLIER}）。
        </p>
      </header>

      {/* 工具列 */}
      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.9rem" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {[7, 30, 90].map((d) => (
            <button key={d} type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={() => quickRange(d)}>
              近 {d} 天
            </button>
          ))}
        </div>
        <label style={{ fontSize: "0.82rem" }}>
          從{" "}
          <input type="date" className="mc-input" value={fromDay} max={toDay} onChange={(e) => setFromDay(e.target.value)} />
        </label>
        <label style={{ fontSize: "0.82rem" }}>
          到{" "}
          <input type="date" className="mc-input" value={toDay} min={fromDay} onChange={(e) => setToDay(e.target.value)} />
        </label>
        <span style={{ flex: 1 }} />
        <div className="mc-seg" role="group" aria-label="分組" style={{ display: "flex", gap: 2 }}>
          {GROUP_BY_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`mc-btn mc-btn--sm ${groupBy === o.value ? "mc-btn--primary" : "mc-btn--ghost"}`}
              aria-pressed={groupBy === o.value}
              onClick={() => setGroupBy(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI 摘要 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "0.7rem",
          marginBottom: "1rem",
        }}
      >
        <Kpi label="含稅總花費" value={fmtUsd(postTaxTotal)} sub={`稅前 ${fmtUsd(preTaxTotal)}`} emphasis />
        <Kpi label="總 tokens" value={fmtCompact(totalTokens)} sub={`輸入 ${fmtCompact(data?.totalInputTokens)} · 輸出 ${fmtCompact(data?.totalOutputTokens)}`} />
        <Kpi label="AI 呼叫次數" value={fmtNumber(totalEvents)} sub={`${fmtDate(from)} – ${fmtDate(to)}`} />
      </div>

      {/* 明細表 */}
      <section className="mc-card" style={cardStyle}>
        <h2 style={{ margin: "0 0 0.6rem", fontSize: "1rem" }}>
          花費明細（依{GROUP_BY_OPTIONS.find((o) => o.value === groupBy)?.label}）
        </h2>
        {loading ? (
          <p style={{ color: "var(--mc-text-dim, #9aa3b8)" }}>載入中…</p>
        ) : err ? (
          <p style={{ color: "#e5657f" }}>⚠ 載入失敗：{err}</p>
        ) : !data || data.rows.length === 0 ? (
          <p style={{ color: "var(--mc-text-dim, #9aa3b8)" }}>此區間沒有 AI 用量紀錄。</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thL}>{GROUP_BY_OPTIONS.find((o) => o.value === groupBy)?.label}</th>
                  <th style={thR}>呼叫次數</th>
                  <th style={thR}>輸入 tok</th>
                  <th style={thR}>輸出 tok</th>
                  <th style={thR}>稅前</th>
                  <th style={thR}>含稅 ×{TAX_MULTIPLIER}</th>
                  <th style={{ ...thL, width: "24%" }}>佔比</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.key}>
                    <td style={tdL}>{rowLabel(r.key, groupBy)}</td>
                    <td style={tdR}>{fmtNumber(r.events)}</td>
                    <td style={tdR}>{fmtCompact(r.inputTokens)}</td>
                    <td style={tdR}>{fmtCompact(r.outputTokens)}</td>
                    <td style={tdR}>{fmtUsd(r.costUsd)}</td>
                    <td style={{ ...tdR, fontWeight: 600 }}>{fmtUsd(r.costUsdPosttax)}</td>
                    <td style={tdL}>
                      <div style={{ height: 8, background: "rgba(255,255,255,0.07)", borderRadius: 4, overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${maxCost > 0 ? Math.round((r.costUsd / maxCost) * 100) : 0}%`,
                            height: "100%",
                            background: "var(--mc-accent, #7c6cff)",
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ ...tdL, fontWeight: 700 }}>合計</td>
                  <td style={tdR}>{fmtNumber(totalEvents)}</td>
                  <td style={tdR}>{fmtCompact(data.totalInputTokens)}</td>
                  <td style={tdR}>{fmtCompact(data.totalOutputTokens)}</td>
                  <td style={tdR}>{fmtUsd(preTaxTotal)}</td>
                  <td style={{ ...tdR, fontWeight: 700 }}>{fmtUsd(postTaxTotal)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p style={{ margin: "0.7rem 0 0", fontSize: "0.76rem", color: "var(--mc-text-dim, #9aa3b8)" }}>
          花費為寫入時凍結的<strong>估算值</strong>（依伺服器定價 PRICING__… 計，非帳單金額）。含稅欄＝稅前 × {TAX_MULTIPLIER}
          （稅率）。每次 AI 呼叫（文字/研究/生圖/向量/語音/評分）都會於最底層記帳。
        </p>
      </section>

      {/* 明細事件（逐筆 AI 呼叫） */}
      <EventsSection from={from} to={to} />
    </div>
  );
}

function Kpi({ label, value, sub, emphasis }: { label: string; value: string; sub?: string; emphasis?: boolean }) {
  return (
    <div className="mc-card" style={{ ...cardStyle, padding: "0.8rem 0.9rem" }}>
      <div style={{ fontSize: "0.76rem", color: "var(--mc-text-dim, #9aa3b8)" }}>{label}</div>
      <div style={{ fontSize: emphasis ? "1.7rem" : "1.4rem", fontWeight: 700, color: emphasis ? "var(--mc-accent, #7c6cff)" : undefined }}>
        {value}
      </div>
      {sub ? <div style={{ fontSize: "0.74rem", color: "var(--mc-text-dim, #9aa3b8)" }}>{sub}</div> : null}
    </div>
  );
}

const EVENTS_PAGE = 50;

function EventsSection({ from, to }: { from: number; to: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<OrgUsageEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchPage = useCallback(
    (off: number) => {
      setLoading(true);
      setErr(null);
      getOrgUsageEvents({ from, to, limit: EVENTS_PAGE, offset: off })
        .then((res) => {
          setItems(res.items);
          setTotal(res.total);
          setOffset(off);
        })
        .catch((e) => setErr((e as Error).message || "載入失敗"))
        .finally(() => setLoading(false));
    },
    [from, to],
  );

  // 展開時（或區間變動且已展開時）載第一頁。
  useEffect(() => {
    if (open) fetchPage(0);
  }, [open, fetchPage]);

  return (
    <section className="mc-card" style={{ ...cardStyle, marginTop: "0.9rem" }}>
      <button
        type="button"
        className="mc-btn mc-btn--ghost mc-btn--sm"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "▾ 收合逐筆明細" : "▸ 查看逐筆 AI 呼叫明細"}
      </button>
      {open ? (
        loading ? (
          <p style={{ marginTop: "0.6rem", color: "var(--mc-text-dim, #9aa3b8)" }}>載入中…</p>
        ) : err ? (
          <p style={{ marginTop: "0.6rem", color: "#e5657f" }}>⚠ {err}</p>
        ) : items.length === 0 ? (
          <p style={{ marginTop: "0.6rem", color: "var(--mc-text-dim, #9aa3b8)" }}>此區間沒有明細。</p>
        ) : (
          <>
            <div style={{ overflowX: "auto", marginTop: "0.6rem" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thL}>時間</th>
                    <th style={thL}>項目</th>
                    <th style={thL}>模型</th>
                    <th style={thR}>輸入</th>
                    <th style={thR}>輸出</th>
                    <th style={thR} title="reasoning / thinking tokens">reasoning</th>
                    <th style={thR} title="cached input tokens（較便宜）">cached</th>
                    <th style={thR}>重試</th>
                    <th style={thR}>稅前</th>
                    <th style={thR}>含稅</th>
                    <th style={thL}>會議</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((e) => (
                    <tr key={e.id}>
                      <td style={tdL}>{fmtDateTime(e.createdAt)}</td>
                      <td style={tdL}>{KIND_LABELS[e.kind] ?? e.kind}</td>
                      <td style={tdL}>{e.model ?? "—"}</td>
                      <td style={tdR}>{fmtCompact(e.inputTokens)}</td>
                      <td style={tdR}>{fmtCompact(e.outputTokens)}</td>
                      <td style={tdR}>{e.reasoningTokens != null ? fmtCompact(e.reasoningTokens) : "—"}</td>
                      <td style={tdR}>{e.cachedInputTokens != null ? fmtCompact(e.cachedInputTokens) : "—"}</td>
                      <td style={tdR}>{e.retryCount > 0 ? e.retryCount : "—"}</td>
                      <td style={tdR}>{fmtUsd(e.estCostUsd)}</td>
                      <td style={{ ...tdR, fontWeight: 600 }}>{fmtUsd(e.estCostUsd * e.costTaxMultiplier)}</td>
                      <td style={tdL}>{e.meetingId ? e.meetingId.slice(0, 8) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: "0.6rem", fontSize: "0.8rem" }}>
              <button
                type="button"
                className="mc-btn mc-btn--ghost mc-btn--sm"
                disabled={offset === 0}
                onClick={() => fetchPage(Math.max(0, offset - EVENTS_PAGE))}
              >
                上一頁
              </button>
              <span style={{ color: "var(--mc-text-dim, #9aa3b8)" }}>
                {offset + 1}–{Math.min(offset + EVENTS_PAGE, total)} / {total}
              </span>
              <button
                type="button"
                className="mc-btn mc-btn--ghost mc-btn--sm"
                disabled={offset + EVENTS_PAGE >= total}
                onClick={() => fetchPage(offset + EVENTS_PAGE)}
              >
                下一頁
              </button>
            </div>
          </>
        )
      ) : null}
    </section>
  );
}

/* ── inline style tokens ── */
const cardStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  padding: "1rem",
  background: "rgba(255,255,255,0.02)",
};
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" };
const thBase: React.CSSProperties = {
  padding: "6px 8px",
  borderBottom: "1px solid rgba(255,255,255,0.1)",
  fontWeight: 600,
  fontSize: "0.78rem",
  color: "var(--mc-text-dim, #9aa3b8)",
  whiteSpace: "nowrap",
};
const thL: React.CSSProperties = { ...thBase, textAlign: "left" };
const thR: React.CSSProperties = { ...thBase, textAlign: "right" };
const tdBase: React.CSSProperties = { padding: "6px 8px", borderBottom: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap" };
const tdL: React.CSSProperties = { ...tdBase, textAlign: "left" };
const tdR: React.CSSProperties = { ...tdBase, textAlign: "right" };
