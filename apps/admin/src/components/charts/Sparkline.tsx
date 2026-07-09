import { projectPolyline } from "./geometry";

/**
 * Sparkline — KPI 卡內嵌的極簡趨勢線（自繪 inline-SVG，不引圖表庫）。
 * 只吃 number[]；空/單點時退化為平線。preserveAspectRatio=none 讓它填滿容器寬度。
 */
export function Sparkline({
  data,
  width = 120,
  height = 32,
  tone = "accent",
}: {
  data: number[];
  width?: number;
  height?: number;
  tone?: "accent" | "ok" | "danger" | "muted";
}) {
  const pts = data.filter((v) => Number.isFinite(v));
  const pad = 2;
  const w = 100;
  const h = 30;
  let path = "";
  let areaPath = "";
  if (pts.length >= 2) {
    const proj = projectPolyline(pts, (v) => v, { x0: pad, spanX: w - pad * 2, yTop: pad, yBase: h - pad });
    path = proj.line;
    areaPath = proj.area;
  }
  return (
    <svg
      className={`ad-spark ad-spark--${tone}`}
      viewBox={`0 0 ${w} ${h}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-hidden="true"
    >
      {pts.length >= 2 ? <polygon className="ad-spark__area" points={areaPath} /> : null}
      {pts.length >= 2 ? <polyline className="ad-spark__line" points={path} /> : null}
    </svg>
  );
}
