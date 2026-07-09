/**
 * DonutChart — 自繪 inline-SVG 圓環圖（byKind 花費占比用）。不引圖表庫。
 * 標準環圈技巧：半徑使圓周長=100，用 stroke-dasharray 切段。附圖例。
 */
export interface DonutSlice {
  label: string;
  value: number;
}

const PALETTE = ["#3b6cf6", "#12b886", "#f59f00", "#e8590c", "#7048e8", "#e64980", "#15aabf", "#868e96"];

export function DonutChart({
  slices,
  valueFormat = (v) => String(v),
}: {
  slices: DonutSlice[];
  valueFormat?: (v: number) => string;
}) {
  const pts = slices.filter((s) => Number.isFinite(s.value) && s.value > 0);
  if (pts.length === 0) return null;

  const total = pts.reduce((s, p) => s + p.value, 0) || 1;
  let offset = 0;
  const segments = pts.map((p, i) => {
    const pct = (p.value / total) * 100;
    const seg = { pct, offset, color: PALETTE[i % PALETTE.length]!, label: p.label, value: p.value };
    offset += pct;
    return seg;
  });

  return (
    <div className="ad-donut">
      <svg viewBox="0 0 42 42" className="ad-donut__svg" role="img" aria-label="占比圓環圖">
        <circle className="ad-donut__hole" cx="21" cy="21" r="15.9155" />
        {segments.map((s, i) => (
          <circle
            key={i}
            cx="21"
            cy="21"
            r="15.9155"
            fill="transparent"
            stroke={s.color}
            strokeWidth="5"
            strokeDasharray={`${s.pct.toFixed(3)} ${(100 - s.pct).toFixed(3)}`}
            strokeDashoffset={`${(25 - s.offset).toFixed(3)}`}
          >
            <title>{`${s.label}：${valueFormat(s.value)}（${s.pct.toFixed(1)}%）`}</title>
          </circle>
        ))}
      </svg>
      <ul className="ad-donut__legend">
        {segments.map((s, i) => (
          <li key={i} className="ad-donut__legend-item">
            <span className="ad-donut__swatch" style={{ background: s.color }} />
            <span className="ad-donut__legend-label">{s.label}</span>
            <span className="ad-donut__legend-val">{valueFormat(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
