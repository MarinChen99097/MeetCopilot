import type { ChartPoint, ChartType } from "@meetcopilot/shared";

/**
 * 純 CSS/SVG 圖表——長條 / 圓環 / 折線。**完全不生圖**：只吃 series 數據，用 SVG/CSS 畫。
 * 顏色一律走每頁主題的 CSS 變數（--slide-accent 等），故跟著主題色與 logo 一致。
 *
 * v2：與 v1 同（presentational），chartType 型別改用 shared 的 ChartType 單一真相來源。
 */

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
}

export function SlideChart({ chartType, series, caption }: SlideChartProps) {
  const pts = series.filter((p) => p && typeof p.value === "number" && Number.isFinite(p.value));
  if (pts.length === 0) return null;
  return (
    <div className={`slide-block slide-block--chart chart--${chartType}`}>
      {chartType === "bar" ? <BarChart pts={pts} /> : null}
      {chartType === "donut" ? <DonutChart pts={pts} /> : null}
      {chartType === "line" ? <LineChart pts={pts} /> : null}
      {caption ? <div className="chart__caption">{caption}</div> : null}
    </div>
  );
}

function BarChart({ pts }: { pts: ChartPoint[] }) {
  const max = Math.max(...pts.map((p) => Math.abs(p.value)), 1);
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

function DonutChart({ pts }: { pts: ChartPoint[] }) {
  const total = pts.reduce((s, p) => s + Math.abs(p.value), 0) || 1;
  let offset = 0;
  // 標準環圈技巧：半徑使圓周長=100，用 stroke-dasharray 切段。
  const segments = pts.map((p, i) => {
    const pct = (Math.abs(p.value) / total) * 100;
    const seg = { pct, offset, color: PALETTE[i % PALETTE.length]!, label: p.label, value: p.value };
    offset += pct;
    return seg;
  });
  return (
    <div className="chart__donut-wrap">
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
