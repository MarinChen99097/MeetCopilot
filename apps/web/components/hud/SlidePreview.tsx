"use client";

import type { SlideBlock, SlideSpec } from "@meetcopilot/shared";

/**
 * Compact textual thumbnail of a proposed slide (suggestion queue). Deliberately self-contained
 * (not the full /studio renderer — that's a parallel M2 line) so the HUD has no cross-line coupling.
 * Summarizes eyebrow + first heading + a short digest of the leading blocks.
 */
export function SlidePreview({ slide }: { slide: SlideSpec }) {
  const heading = firstHeading(slide.blocks);
  const digest = slide.blocks.slice(0, 4).map(describeBlock).filter(Boolean);
  return (
    <div className="mc-slideprev" aria-label="建議的新頁預覽">
      <span className="mc-slideprev__tpl">{slide.template}</span>
      {slide.eyebrow ? <span className="mc-slideprev__eyebrow">{slide.eyebrow}</span> : null}
      <div className="mc-slideprev__title">{heading ?? "（無標題）"}</div>
      <ul className="mc-slideprev__digest">
        {digest.map((d, i) => (
          <li key={i}>{d}</li>
        ))}
      </ul>
    </div>
  );
}

function firstHeading(blocks: SlideBlock[]): string | null {
  for (const b of blocks) {
    if (b.type === "heading" || b.type === "subheading") return b.text;
  }
  return null;
}

function describeBlock(b: SlideBlock): string {
  switch (b.type) {
    case "heading":
    case "subheading":
    case "paragraph":
      return truncate(b.text);
    case "quote":
      return `“${truncate(b.text)}”`;
    case "bullets":
      return `• ${b.items.slice(0, 3).map(truncate).join(" · ")}`;
    case "stat":
      return `${b.value} — ${b.label}`;
    case "features":
      return `功能卡 ×${b.features.length}：${b.features.slice(0, 2).map((f) => f.title).join(" · ")}`;
    case "chart":
      return `圖表（${b.chartType}）· ${b.series.length} 項`;
    case "image":
      return b.alt ? `圖片：${truncate(b.alt)}` : "圖片";
    case "two-col":
      return "雙欄版面";
    default:
      return "";
  }
}

function truncate(s: string, n = 48): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
