import type { SlideBlock } from "@meetcopilot/shared";

/**
 * SlideBlock[] 的純運算——受控投影片編輯器（BlockEditor 表單、EditableSlide WYSIWYG）共用單一真相，
 * 不各自複製。皆回傳新陣列，呼叫端自行 `onChange({ ...slide, blocks })`。
 */
export function blockMove(blocks: SlideBlock[], i: number, dir: -1 | 1): SlideBlock[] {
  const j = i + dir;
  if (j < 0 || j >= blocks.length) return blocks;
  const next = blocks.slice();
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

export function blockRemove(blocks: SlideBlock[], i: number): SlideBlock[] {
  return blocks.filter((_, j) => j !== i);
}

export function blockReplace(blocks: SlideBlock[], i: number, next: SlideBlock): SlideBlock[] {
  return blocks.map((b, j) => (j === i ? next : b));
}

/** 新區塊的預設值（type 決定形狀）——新增區塊能力的單一真相。 */
export function newBlock(type: SlideBlock["type"]): SlideBlock {
  switch (type) {
    case "heading":
      return { type: "heading", text: "新標題" };
    case "subheading":
      return { type: "subheading", text: "副標題" };
    case "paragraph":
      return { type: "paragraph", text: "" };
    case "bullets":
      return { type: "bullets", items: [""] };
    case "quote":
      return { type: "quote", text: "" };
    case "stat":
      return { type: "stat", value: "0", label: "" };
    case "features":
      return { type: "features", features: [{ title: "" }] };
    case "chart":
      return { type: "chart", chartType: "bar", series: [{ label: "", value: 0 }] };
    case "table":
      // 預設 1 空欄標題 ＋ 3 方案欄、2 列——直接是「方案比較表」的骨架，使用者只需填字。
      return {
        type: "table",
        headers: ["", "我們", "競品 A", "自己開發"],
        rows: [
          ["", "", "", ""],
          ["", "", "", ""],
        ],
        highlightColumn: 1,
      };
    case "timeline":
      return {
        type: "timeline",
        ticks: [{ name: "第 1–2 週" }, { name: "第 3–4 週" }, { name: "第 5–6 週" }],
        tracks: [{ label: "", startPct: 0, widthPct: 50 }],
      };
    case "steps":
      return { type: "steps", steps: [{ title: "" }, { title: "" }, { title: "" }] };
    case "image":
      return { type: "image", dataUri: "" };
    case "two-col":
      return { type: "two-col", left: [], right: [] };
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}
