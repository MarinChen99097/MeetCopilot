/**
 * ConfidenceBadge — renders a 0..1 confidence as 高/中/低 + %（PROMPT 0 通用元件 #2）.
 * 低信心用較灰底＋「據公開資訊」語氣提示（tooltip）。
 */
export function ConfidenceBadge({ value }: { value?: number }) {
  if (value === undefined || value === null || Number.isNaN(value)) return null;
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const tier = value >= 0.75 ? "high" : value >= 0.45 ? "mid" : "low";
  const label = tier === "high" ? "高" : tier === "mid" ? "中" : "低";
  const hint = tier === "low" ? "低信心，據公開資訊推測" : `信心 ${label}`;
  return (
    <span className={`mc-conf mc-conf--${tier}`} title={hint}>
      信心 {label} · {pct}%
    </span>
  );
}
