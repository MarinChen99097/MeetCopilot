/** Spinner — small inline loading indicator (respects prefers-reduced-motion via CSS). */
export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <span
      className="mc-spinner"
      role="status"
      aria-label={label ?? "載入中"}
      style={{ width: size, height: size }}
    />
  );
}
