import type { ChartPoint, ChartType } from "@meetcopilot/shared";

/**
 * 純 CSS/SVG 圖表——長條 / 圓環 / 折線。**完全不生圖**：只吃 series 數據，用 SVG/CSS 畫。
 * 顏色一律走每頁主題的 CSS 變數（--slide-accent 等），故跟著主題色與 logo 一致。
 *
 * v2：與 v1 同（presentational），chartType 型別改用 shared 的 ChartType 單一真相來源。
 */

/**
 * 成對比較（換之前→換之後）的兩色，**必須與 studio-present.css:245-246 的長條實色逐格對應**
 * （s1=--slide-sunk 近底灰、s2=--slide-accent）。圖例若沿用 PALETTE[0]/[1]（accent / accent-2）
 * 會出現「圖例色 ≠ 長條色」的對不上。
 */
const PAIRED_COLORS = ["var(--slide-sunk)", "var(--slide-accent)"];

const PALETTE = [
  "var(--slide-accent)",
  "var(--slide-accent-2)",
  "var(--slide-accent-3)",
  "color-mix(in srgb, var(--slide-accent) 55%, #ffffff)",
  "color-mix(in srgb, var(--slide-accent-2) 55%, #ffffff)",
  "color-mix(in srgb, var(--slide-accent-3) 60%, #ffffff)",
];

export interface SlideChartProps {
  chartType: ChartType;
  series: ChartPoint[];
  caption?: string;
  /** 成對比較的第二序列（換之前→換之後）。省略＝單序列，輸出與擴充前逐字相同。 */
  series2?: ChartPoint[];
  /** 兩序列的名稱（圖例）；只有 series2 有值時才顯示。 */
  seriesNames?: string[];
  /** donut 圓心大數字＋標籤（只對 donut 有意義）。 */
  centerValue?: string;
  centerLabel?: string;
}

export function SlideChart({ chartType, series, caption, series2, seriesNames, centerValue, centerLabel }: SlideChartProps) {
  // 防炸（第二層）：本元件也可能被 SlideRenderer 以外的地方直接掛（編輯器預覽等），
  // 故 filter 之前自己再確認一次是陣列——`series` 為 null／字串時 `.filter` 會 throw 並炸掉整頁。
  // 合法輸入（陣列 ／ series2 為 undefined）走的路徑與加守衛前**逐字相同**，輸出 DOM 不變。
  const pts = (Array.isArray(series) ? series : []).filter((p) => p && typeof p.value === "number" && Number.isFinite(p.value));
  if (pts.length === 0) return null;
  const pts2 = (Array.isArray(series2) ? series2 : []).filter((p) => p && typeof p.value === "number" && Number.isFinite(p.value));
  // 成對比較只在兩序列等長時成立（長度不齊＝資料有誤，退回單序列而非畫錯）。
  const paired = pts2.length === pts.length ? pts2 : undefined;
  return (
    <div className={`slide-block slide-block--chart chart--${chartType}`}>
      {chartType === "bar" ? <BarChart pts={pts} pts2={paired} seriesNames={seriesNames} /> : null}
      {chartType === "donut" ? <DonutChart pts={pts} centerValue={centerValue} centerLabel={centerLabel} /> : null}
      {chartType === "line" ? <LineChart pts={pts} /> : null}
      {caption ? <div className="chart__caption">{caption}</div> : null}
    </div>
  );
}

function BarChart({ pts, pts2, seriesNames }: { pts: ChartPoint[]; pts2?: ChartPoint[]; seriesNames?: string[] }) {
  const max = Math.max(...pts.map((p) => Math.abs(p.value)), ...(pts2 ?? []).map((p) => Math.abs(p.value)), 1);
  // 單序列路徑逐字維持擴充前的 DOM（無 pts2 → 不多一層 group、不加 legend）。
  if (!pts2) {
    return (
      <div className="chart__bars">
        {pts.map((p, i) => (
          <div key={i} className="chart__bar-col">
            <div className="chart__bar-val">{formatNum(p.value)}</div>
            <div className="chart__bar-track">
              <div className="chart__bar" style={{ height: `${(Math.abs(p.value) / max) * 100}%` }} />
            </div>
            <div className="chart__bar-label">{p.label}</div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <>
      {seriesNames?.length ? (
        <ul className="chart__series-legend">
          {seriesNames.slice(0, 2).map((n, i) => (
            <li key={i}>
              <span className="chart__swatch" style={{ background: PAIRED_COLORS[i % PAIRED_COLORS.length] }} />
              {n}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="chart__bars chart__bars--paired">
        {pts.map((p, i) => (
          <div key={i} className="chart__bar-col">
            <div className="chart__bar-pair">
              {[p, pts2[i]!].map((q, j) => (
                <div className="chart__bar-stack" key={j}>
                  <div className="chart__bar-val">{formatNum(q.value)}</div>
                  <div className="chart__bar-track">
                    <div
                      className={`chart__bar chart__bar--s${j + 1}`}
                      style={{ height: `${(Math.abs(q.value) / max) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="chart__bar-label">{p.label}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function DonutChart({ pts, centerValue, centerLabel }: { pts: ChartPoint[]; centerValue?: string; centerLabel?: string }) {
  const total = pts.reduce((s, p) => s + Math.abs(p.value), 0) || 1;
  let offset = 0;
  // 標準環圈技巧：半徑使圓周長=100，用 stroke-dasharray 切段。
  const segments = pts.map((p, i) => {
    const pct = (Math.abs(p.value) / total) * 100;
    const seg = { pct, offset, color: PALETTE[i % PALETTE.length]!, label: p.label, value: p.value };
    offset += pct;
    return seg;
  });
  // 環圈本體只寫一份：兩個分支（有／沒有圓心大數字）用的是逐字相同的 SVG，
  // 分開抄兩份的話改一邊就會兩型走樣。每次 render 只有一個分支會取用它。
  const donut = (
    <svg viewBox="0 0 42 42" className="chart__donut" role="img">
      <circle className="chart__donut-hole" cx="21" cy="21" r="15.9155" />
      {segments.map((s, i) => (
        <circle
          key={i}
          cx="21"
          cy="21"
          r="15.9155"
          fill="transparent"
          stroke={s.color}
          strokeWidth="6"
          strokeDasharray={`${s.pct} ${100 - s.pct}`}
          strokeDashoffset={`${25 - s.offset}`}
        />
      ))}
    </svg>
  );
  return (
    <div className="chart__donut-wrap">
      {/* 圓心大數字：包一層才能絕對定位在環中央；未帶 centerValue 時不多包（DOM 逐字等價）。 */}
      {centerValue ? (
        <div className="chart__donut-slot">
          {donut}
          <span className="chart__donut-center">
            <span className="chart__donut-center-val">{centerValue}</span>
            {centerLabel ? <span className="chart__donut-center-label">{centerLabel}</span> : null}
          </span>
        </div>
      ) : (
        donut
      )}
      <ul className="chart__legend">
        {segments.map((s, i) => (
          <li key={i}>
            <span className="chart__swatch" style={{ background: s.color }} />
            <span className="chart__legend-label">{s.label}</span>
            <span className="chart__legend-val">{formatNum(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LineChart({ pts }: { pts: ChartPoint[] }) {
  const W = 100;
  const H = 42;
  const pad = 3;
  const max = Math.max(...pts.map((p) => p.value));
  const min = Math.min(...pts.map((p) => p.value), 0);
  const span = max - min || 1;
  const stepX = pts.length > 1 ? (W - pad * 2) / (pts.length - 1) : 0;
  const coords = pts.map((p, i) => {
    const x = pad + i * stepX;
    const y = H - pad - ((p.value - min) / span) * (H - pad * 2);
    return { x, y, p };
  });
  const line = coords.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" ");
  const area = `${pad},${H - pad} ${line} ${(pad + (pts.length - 1) * stepX).toFixed(2)},${H - pad}`;
  return (
    <div className="chart__line-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart__line" preserveAspectRatio="none" role="img">
        <polygon className="chart__line-area" points={area} />
        <polyline className="chart__line-path" points={line} />
        {coords.map((c, i) => (
          <circle key={i} className="chart__line-dot" cx={c.x} cy={c.y} r="0.9" />
        ))}
      </svg>
      <div className="chart__line-labels">
        {pts.map((p, i) => (
          <span key={i}>{p.label}</span>
        ))}
      </div>
    </div>
  );
}

/** 大數字精簡：1200 → 1.2K、3400000 → 3.4M；小數保留一位。 */
function formatNum(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${trim(v / 1e9)}B`;
  if (abs >= 1e6) return `${trim(v / 1e6)}M`;
  if (abs >= 1e4) return `${trim(v / 1e3)}K`;
  return `${trim(v)}`;
}
function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
