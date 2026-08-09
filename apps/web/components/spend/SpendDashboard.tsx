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
  getOrgUsageByMeeting,
  getOrgUsageEvents,
  type OrgBudget,
  type OrgMeetingCostRow,
  type OrgUsage,
  type OrgUsageEvent,
  type OrgUsageGroupBy,
} from "@/lib/api";
import { fmtCompact, fmtDate, fmtDateTime, fmtNumber, fmtUsd } from "@/lib/format";
import { StateBoundary } from "@/components/ui/StateBoundary";

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

/**
 * 沒有人話標籤的鍵 → 可讀 fallback。
 * 後端的 kind/model 值若是以定價環境變數命名（`PRICING__<MODEL>__INPUT_PER_M` 這種形狀），
 * 原樣印出等於把 env 變數名端到使用者面前——先剝掉 `PRICING__` 前綴與 `__*_PER_*` 後綴取中間的
 * model 段、底線換連字號並小寫（讀起來就是 model id）；剝不出東西才退「其他」。
 */
function humanizeKey(key: string): string {
  const raw = key.trim();
  if (!raw) return "其他";
  if (!/^PRICING__/i.test(raw)) return raw; // 一般 model id（gemini-3.1-flash-lite…）原樣顯示
  const core = raw.replace(/^PRICING__/i, "").replace(/__[A-Z0-9_]*PER_[A-Z0-9_]+$/i, "");
  const pretty = core.replace(/_/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return pretty || "其他";
}

function rowLabel(key: string, groupBy: OrgUsageGroupBy): string {
  if (groupBy === "kind") return KIND_LABELS[key] ?? humanizeKey(key);
  if (key === "(none)") return "（未標記）";
  return humanizeKey(key);
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
    <div className="mc-spend">
      {/* 2026-07-30 重設計（INVENTORY §B10）：kicker ＋「花了多少錢」大數字。
          2026-07-31 W4-wire：設計稿的「這個月上限 ／ 進度條」在 server 設了 env ORG_MONTHLY_BUDGET_USD
          後**已有真資料**（GET /api/org/usage 的 budget 欄），故補上預算條——env 沒設就整條不出現。
          設計稿的「月底預測」「本週還能查幾次」仍**沒有**任何後端來源（無預測、配額無週期），依契約不渲染。
          「平均一場會議」改以真資料呈現：下方「單場會議成本」表（GET /api/org/usage/by-meeting）。
          設計稿砍掉的區間選擇／分組／逐筆明細是既有能力，**保留**。 */}
      <header className="mc-pagehead">
        <div className="mc-pagehead__id">
          <span className="mc-kicker mc-kicker--page">{`${fmtDate(from)} – ${fmtDate(to)}`}</span>
          {/* 首載（data===null）先給「—」佔位：否則大數字會先閃一格 $0.00，被誤讀成「這區間沒花錢」。
              載完（含空區間）照常顯示 fmtUsd 結果，行為不變。 */}
          <h1 className="mc-pagehead__h1">{data ? fmtUsd(postTaxTotal) : "—"}</h1>
          <p className="mc-pagehead__lead">
            本組織的 AI 用量：花了多少 token、用了哪些模型、成本多少（含稅＝稅前 × {TAX_MULTIPLIER}）。
          </p>
        </div>
      </header>

      {/* 月預算條——只有 server 設了 ORG_MONTHLY_BUDGET_USD 才有 budget 欄；沒設就整條不存在。 */}
      {data?.budget ? <BudgetBar budget={data.budget} /> : null}

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
        {/* `.mc-seg` 在 globals.css 原本零規則、版面靠這裡的 inline style 撐，三顆鈕是各自獨立的
            `.mc-btn` 圓角膠囊；而設計好的 `.mc-seg__btn` 連體分段鈕一個消費端都沒有。改用既有原語，
            onClick／aria-pressed／groupBy 狀態機零變更。 */}
        <div className="mc-seg" role="group" aria-label="分組">
          {GROUP_BY_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`mc-seg__btn ${groupBy === o.value ? "is-on" : ""}`}
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
      <section className="mc-card">
        <h2 style={{ margin: "0 0 0.6rem", fontSize: "1rem" }}>
          花費明細（依{GROUP_BY_OPTIONS.find((o) => o.value === groupBy)?.label}）
        </h2>
        {loading ? (
          <p style={{ color: "var(--mc-text-2)" }}>載入中…</p>
        ) : err ? (
          <p style={{ color: "var(--mc-danger)" }}>⚠ 載入失敗：{err}</p>
        ) : !data || data.rows.length === 0 ? (
          <p style={{ color: "var(--mc-text-2)" }}>此區間沒有 AI 用量紀錄。</p>
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
                      <MeterBar pct={maxCost > 0 ? Math.round((r.costUsd / maxCost) * 100) : 0} />
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
        <p style={{ margin: "0.7rem 0 0", fontSize: "0.76rem", color: "var(--mc-text-2)" }}>
          花費為寫入時凍結的<strong>估算值</strong>（依伺服器端的模型定價表計算，非帳單金額）。含稅欄＝稅前 × {TAX_MULTIPLIER}
          （稅率）。每次 AI 呼叫（文字/研究/生圖/向量/語音/評分）都會於最底層記帳。
        </p>
      </section>

      {/* 單場會議成本（會中用量 top-N） */}
      <ByMeetingSection from={from} to={to} />

      {/* 明細事件（逐筆 AI 呼叫） */}
      <EventsSection from={from} to={to} />
    </div>
  );
}

/**
 * 「佔比」欄的橫條（主明細表與單場會議表共用）。純顯示，無 aria——同列已有稅前/含稅數字，
 * 這條是重複資訊的視覺輔助（預算條那支有 role="progressbar" 的是另一回事，不共用）。
 * `pct` 由呼叫端算好（分母各自不同：總表用 maxCost、會議表用 max）。
 */
function MeterBar({ pct }: { pct: number }) {
  return (
    <div style={{ height: 8, background: "var(--mc-sunk)", borderRadius: 999, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: "var(--mc-accent)" }} />
    </div>
  );
}

function Kpi({ label, value, sub, emphasis }: { label: string; value: string; sub?: string; emphasis?: boolean }) {
  return (
    <div className="mc-card" style={{ padding: "0.8rem 0.9rem" }}>
      <div style={{ fontSize: "0.76rem", color: "var(--mc-text-2)" }}>{label}</div>
      <div style={{ fontSize: emphasis ? "1.7rem" : "1.4rem", fontWeight: 700, color: emphasis ? "var(--mc-accent)" : undefined }}>
        {value}
      </div>
      {sub ? <div style={{ fontSize: "0.74rem", color: "var(--mc-text-2)" }}>{sub}</div> : null}
    </div>
  );
}

/**
 * 月預算條。**只在後端回了 budget 才渲染**（env ORG_MONTHLY_BUDGET_USD 有設）。
 * 窗恆為「本月至今」（UTC 月初 → now），與上方 from/to 查詢區間無關——所以標題必須寫明「本月」，
 * 否則使用者會把它誤讀成所選區間的用量。分子取含稅（使用者眼睛看到的就是含稅）。
 */
function BudgetBar({ budget }: { budget: OrgBudget }) {
  const spent = budget.spentUsdPosttax;
  const cap = budget.monthlyUsd;
  const ratio = cap > 0 ? spent / cap : 0;
  const pct = Math.round(ratio * 100);
  const over = spent > cap;
  const tone = over ? "var(--mc-danger)" : ratio >= 0.8 ? "var(--mc-warn)" : "var(--mc-accent)";
  const monthLabel = new Date(budget.monthStart).toLocaleDateString("zh-TW", { year: "numeric", month: "long" });

  return (
    <section className="mc-card" style={{ marginBottom: "0.9rem" }} aria-label="本月預算">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: "0.5rem" }}>
        <strong style={{ fontSize: "0.92rem" }}>{monthLabel}預算</strong>
        <span style={{ fontFamily: "var(--mc-font-mono)", fontSize: "0.86rem" }}>
          {fmtUsd(spent)} / {fmtUsd(cap)}
        </span>
        <span style={{ fontSize: "0.8rem", color: over ? "var(--mc-danger)" : "var(--mc-text-2)" }}>
          {over ? `已超出 ${fmtUsd(spent - cap)}` : `已用 ${pct}%`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={spent}
        aria-valuetext={`${fmtUsd(spent)} / ${fmtUsd(cap)}`}
        style={{ height: 10, background: "var(--mc-sunk)", borderRadius: 999, overflow: "hidden" }}
      >
        <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: "100%", background: tone }} />
      </div>
      <p style={{ margin: "0.5rem 0 0", fontSize: "0.74rem", color: "var(--mc-text-2)" }}>
        本月至今（{fmtDate(budget.monthStart)} 起）含稅估算，<strong>與上方查詢區間無關</strong>。上限為全平台設定值。
      </p>
    </section>
  );
}

/** 單場會議成本 top-N 的預設筆數（後端上限 50）。 */
const BY_MEETING_LIMIT = 10;

/**
 * 「最貴的 N 場會議」。**涵蓋範圍要誠實**：只含帶 meetingId 的**會中**用量——會前的簡報生成／研究爬蟲／
 * persona 草擬沒有 meetingId，不歸屬任何一場，因此本表加總必然小於上方總花費。文案已寫明，不可改成「拆解」。
 */
function ByMeetingSection({ from, to }: { from: number; to: number }) {
  const [rows, setRows] = useState<OrgMeetingCostRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setErr(null);
    setRows(null);
    getOrgUsageByMeeting({ from, to, limit: BY_MEETING_LIMIT })
      .then((r) => setRows(r.items))
      .catch((e) => setErr((e as Error).message || "載入失敗"));
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const max = Math.max(0, ...(rows ?? []).map((r) => r.costUsd));

  return (
    <section className="mc-card" style={{ marginTop: "0.9rem" }}>
      <h2 style={{ margin: "0 0 0.6rem", fontSize: "1rem" }}>單場會議成本（最貴的 {BY_MEETING_LIMIT} 場）</h2>
      <StateBoundary
        loading={rows === null && !err}
        error={err}
        isEmpty={rows !== null && rows.length === 0}
        onRetry={load}
        emptyTitle="此區間沒有會中 AI 用量"
        emptyHint="只有開會期間（小幫手／HUD／即時建議）產生的用量會歸屬到會議；會前的簡報生成與研究不計入。"
      >
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thL}>會議</th>
                <th style={thR}>AI 呼叫</th>
                <th style={thR}>稅前</th>
                <th style={thR}>含稅</th>
                <th style={{ ...thL, width: "24%" }}>佔比</th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.meetingId}>
                  {/* 標題缺＝會議已被刪除（join 不到）→ 顯示 id 尾碼，不編標題。 */}
                  <td style={{ ...tdL, whiteSpace: "normal" }}>
                    {r.title || <span style={{ color: "var(--mc-text-2)" }}>會議 {r.meetingId.slice(0, 8)}</span>}
                  </td>
                  <td style={tdR}>{fmtNumber(r.events)}</td>
                  <td style={tdR}>{fmtUsd(r.costUsd)}</td>
                  <td style={{ ...tdR, fontWeight: 600 }}>{fmtUsd(r.costUsdPosttax)}</td>
                  <td style={tdL}>
                    <MeterBar pct={max > 0 ? Math.round((r.costUsd / max) * 100) : 0} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ margin: "0.7rem 0 0", fontSize: "0.76rem", color: "var(--mc-text-2)" }}>
          只涵蓋<strong>會中</strong>產生的用量（即時建議／逐字稿／HUD）。會前的簡報生成、研究爬蟲、persona
          草擬沒有綁定會議，因此本表加總會小於上方總花費——這不是漏帳。
        </p>
      </StateBoundary>
    </section>
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
    <section className="mc-card" style={{ marginTop: "0.9rem" }}>
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
          <p style={{ marginTop: "0.6rem", color: "var(--mc-text-2)" }}>載入中…</p>
        ) : err ? (
          <p style={{ marginTop: "0.6rem", color: "var(--mc-danger)" }}>⚠ {err}</p>
        ) : items.length === 0 ? (
          <p style={{ marginTop: "0.6rem", color: "var(--mc-text-2)" }}>此區間沒有明細。</p>
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
                      <td style={tdL}>{KIND_LABELS[e.kind] ?? humanizeKey(e.kind)}</td>
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
              <span style={{ color: "var(--mc-text-2)" }}>
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

/* ── inline style tokens ──
   2026-07-30：原本寫死 rgba(255,255,255,…) 的白色薄膜／`#9aa3b8` fallback 只在深底成立，
   淺色主題下會變成看不見的線與灰字 → 全部改吃 --mc-* token（雙主題自動翻轉）。
   2026-08-09：`cardStyle`（border／radius:14／padding:1rem／background）整個刪除——那四個屬性正是
   globals.css 新補的 `.mc-card` 原語，本檔 5 處 `<section className="mc-card">` 改由 CSS 供樣式
   （radius 14 ＝ `--mc-r-lg`、padding 1rem ＝ 16px，像素等價），各處只保留自己的 margin 增量。 */
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" };
const thBase: React.CSSProperties = {
  padding: "6px 8px",
  borderBottom: "1px solid var(--mc-border)",
  fontFamily: "var(--mc-font-mono)",
  fontWeight: 500,
  fontSize: "0.72rem",
  letterSpacing: "0.08em",
  color: "var(--mc-text-muted)",
  whiteSpace: "nowrap",
};
const thL: React.CSSProperties = { ...thBase, textAlign: "left" };
const thR: React.CSSProperties = { ...thBase, textAlign: "right" };
const tdBase: React.CSSProperties = {
  padding: "6px 8px",
  borderBottom: "1px solid var(--mc-line2)",
  whiteSpace: "nowrap",
};
const tdL: React.CSSProperties = { ...tdBase, textAlign: "left" };
const tdR: React.CSSProperties = { ...tdBase, textAlign: "right", fontFamily: "var(--mc-font-mono)" };
