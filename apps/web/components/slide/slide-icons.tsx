import type { ReactNode } from "react";
import type { SlideIcon } from "@meetcopilot/shared";

/**
 * 內建 inline SVG 圖示集（Lucide 風格線條圖，24×24，stroke=currentColor）——自繪、無外部相依，
 * 供 features 區塊使用。關鍵字對應 packages/shared 的 SLIDE_ICONS；未知關鍵字退回中性預設。
 * 用 currentColor，故顏色跟著 CSS 的 color 走（= 每頁主題 accent）。
 *
 * v2：與 v1 逐字相同（純 presentational、已對齊 shared SlideIcon）；隨 SlideRenderer 一起搬進 v2。
 */
const PATHS: Record<SlideIcon, ReactNode> = {
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
    </>
  ),
  "trending-up": (
    <>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M21 7v6h-6" />
    </>
  ),
  zap: <path d="M13 2L4 14h7l-1 8 10-12h-7z" />,
  shield: <path d="M12 3l8 3.5v5c0 5-3.5 8-8 9.5-4.5-1.5-8-4.5-8-9.5v-5z" />,
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.4" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.6 2.6L16 9.5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c0-3.4 2.5-5.5 5.5-5.5s5.5 2.1 5.5 5.5" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 5.8M17 14.7c2.3.5 4 2.5 4 5.3" />
    </>
  ),
  "bar-chart": (
    <>
      <path d="M4 20V4" />
      <rect x="7" y="12" width="3.2" height="8" />
      <rect x="12.4" y="8" width="3.2" height="12" />
      <rect x="17.8" y="14" width="3.2" height="6" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  rocket: (
    <>
      <path d="M12 3c3.5 2 5 5.5 5 9l-3 3H10L7 12c0-3.5 1.5-7 5-9z" />
      <circle cx="12" cy="10" r="1.6" />
      <path d="M9 18c-1.5.5-2.5 2-2.5 3.5C8 21 9.5 20 10 18.5M15 18c1.5.5 2.5 2 2.5 3.5C16 21 14.5 20 14 18.5" />
    </>
  ),
  lightbulb: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.8c.6.5 1 1.3 1 2.2h5c0-.9.4-1.7 1-2.2A6 6 0 0 0 12 3z" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 13l9 5 9-5" />
    </>
  ),
  cpu: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <path d="M10 7V4M14 7V4M10 20v-3M14 20v-3M7 10H4M7 14H4M20 10h-3M20 14h-3" />
    </>
  ),
  dollar: (
    <>
      <path d="M12 3v18" />
      <path d="M16 7.5C16 5.5 14.2 4.5 12 4.5S8 5.6 8 7.5s1.8 2.7 4 3 4 1.3 4 3.2-1.8 3-4 3-4-1-4-3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  "arrow-right": (
    <>
      <path d="M4 12h15" />
      <path d="M13 6l6 6-6 6" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3l9.5 16.5H2.5z" />
      <path d="M12 9v5M12 17.5v.5" />
    </>
  ),
  leaf: (
    <>
      <path d="M4 20c0-9 6-15 16-15 0 10-6 16-14 16-2 0-2-1-2-1z" />
      <path d="M4 20c4-6 8-9 12-10" />
    </>
  ),
  network: (
    <>
      <circle cx="12" cy="5" r="2.4" />
      <circle cx="5" cy="18" r="2.4" />
      <circle cx="19" cy="18" r="2.4" />
      <path d="M12 7.4V14M12 14l-5 2.4M12 14l5 2.4" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z" />
      <path d="M18 15l.7 1.8L20.5 17.5l-1.8.7L18 20l-.7-1.8L15.5 17.5l1.8-.7z" />
    </>
  ),
  "chart-pie": (
    <>
      <path d="M12 3a9 9 0 1 0 9 9h-9z" />
      <path d="M12 3v9h9" />
    </>
  ),
};

const FALLBACK: ReactNode = (
  <>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="2" />
  </>
);

/** 依關鍵字回傳一個 inline SVG；未知關鍵字回傳中性預設。 */
export function SlideGlyph({ name }: { name?: string }) {
  const inner = (name && PATHS[name as SlideIcon]) || FALLBACK;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {inner}
    </svg>
  );
}
