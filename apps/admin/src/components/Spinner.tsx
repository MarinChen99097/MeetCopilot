/** Spinner — 小型 inline 載入指示（respects prefers-reduced-motion via CSS）。 */
export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <span
      className="ad-spinner"
      role="status"
      aria-label={label ?? "載入中"}
      style={{ width: size, height: size }}
    />
  );
}
