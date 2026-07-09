/**
 * LineChart — 自繪 inline-SVG 折線圖（30 日花費趨勢用）。不引圖表庫。
 * points: { label, value }[]。含面積填色、資料點、X 軸稀疏標籤、Y 軸最大值刻度。
 */
import { projectPolyline } from "./geometry";

export interface LinePoint {
  label: string;
  value: number;
}

export function LineChart({
  points,
  valueFormat = (v) => String(v),
}: {
  points: LinePoint[];
  valueFormat?: (v: number) => string;
}) {
  const pts = points.filter((p) => Number.isFinite(p.value));
  if (pts.length === 0) return null;

  const W = 600;
  const H = 220;
  const padL = 8;
  const padR = 8;
  const padT = 14;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const { coords, line, area, max } = projectPolyline(pts, (p) => p.value, {
    x0: padL,
    spanX: plotW,
    yTop: padT,
    yBase: padT + plotH,
    maxFloor: 1,
  });

  // X 軸稀疏標籤：最多約 6 個，避免擁擠。
  const labelEvery = Math.max(1, Math.ceil(pts.length / 6));

  return (
    <div className="ad-linechart">
      <svg viewBox={`0 0 ${W} ${H}`} className="ad-linechart__svg" role="img" aria-label="趨勢折線圖">
        {/* 基準線 */}
        <line
          className="ad-linechart__baseline"
          x1={padL}
          y1={padT + plotH}
          x2={W - padR}
          y2={padT + plotH}
        />
        <polygon className="ad-linechart__area" points={area} />
        <polyline className="ad-linechart__line" points={line} />
        {coords.map((c, i) => (
          <circle key={i} className="ad-linechart__dot" cx={c.x} cy={c.y} r="2.5">
            <title>{`${c.item.label}：${valueFormat(c.item.value)}`}</title>
          </circle>
        ))}
        {coords.map((c, i) =>
          i % labelEvery === 0 || i === coords.length - 1 ? (
            <text key={i} className="ad-linechart__xlabel" x={c.x} y={H - 8} textAnchor="middle">
              {c.item.label}
            </text>
          ) : null,
        )}
      </svg>
      <div className="ad-linechart__peak">尖峰：{valueFormat(max)}</div>
    </div>
  );
}
