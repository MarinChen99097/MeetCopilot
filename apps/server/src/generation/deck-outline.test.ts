/**
 * buildDeckOutline 回歸鎖定（MEETING_CHECKLIST_CONTRACT §6.4／§10 第 7 項）。
 *
 * 契約要求把 `slide-gen.ts` 內 reviseSlides 的 outline 組裝抽成共用函式，且**輸出逐字不變**。
 * 本檔的第一支測試在測試檔內重寫「抽出前」那一行 golden 公式，對一組刻意刁鑽的 slides
 * （>70 字截斷、換行/多空白折疊、eyebrow 併入、文字全空頁、two-col 嵌套）做逐字比對——
 * 任何人日後動 buildDeckOutline 的默認行為，這支就會紅。
 */
import { describe, it, expect } from "vitest";
import type { SlideSpec } from "@meetcopilot/shared";
import { extractSlideText } from "@meetcopilot/shared";
import {
  buildDeckOutline,
  capDeckOutlineTotal,
  formatDeckOutline,
  DECK_OUTLINE_TOTAL_MAX_CHARS,
  REVISE_OUTLINE_OPTIONS,
} from "./slide-gen.js";

/** 抽出前的 outline 公式（slide-gen.ts:346-348 原文），逐字保留當作 golden。 */
function goldenOutline(slides: SlideSpec[]): string {
  return slides
    .map((s, i) => `#${i} [${s.template}] ${extractSlideText(s).replace(/\s+/g, " ").slice(0, 70)}`)
    .join("\n");
}

/** 刁鑽 fixture：每一頁都針對一種容易在重寫時漂掉的行為。 */
const SLIDES: SlideSpec[] = [
  {
    id: "s0",
    template: "content",
    source: "ai",
    eyebrow: "序章",
    blocks: [
      {
        type: "heading",
        text:
          "這是一個刻意寫得非常長的標題用來觸發七十字截斷邏輯以確保切點完全一致不差一個字" +
          "後面再補一大段廢話讓整頁文字明顯超過七十個字元好讓截斷真的被執行到而不是剛好沒超過",
      },
      { type: "paragraph", text: "第二段" },
    ],
  },
  {
    id: "s1",
    template: "section",
    source: "ai",
    blocks: [{ type: "heading", text: "  前後有空白\n\n中間有換行\t與 tab  " }],
  },
  // 文字全空的頁（image 無 alt）：抽出前會產出一行「#2 [image-full] 」（尾端空白），行為必須保留。
  { id: "s2", template: "image-full", source: "pptx", blocks: [{ type: "image", dataUri: "data:image/png;base64,AA" }] },
  {
    id: "s3",
    template: "content",
    source: "ai",
    blocks: [
      {
        type: "two-col",
        left: [{ type: "bullets", items: ["左一", "左二"] }],
        right: [{ type: "stat", label: "成長", value: "38%" }],
      },
    ],
  },
  {
    id: "s4",
    template: "stats",
    source: "ai",
    blocks: [
      {
        type: "features",
        features: [
          { title: "整合", desc: "兩天上線" },
          { title: "稽核" },
        ],
      },
    ],
  },
];

describe("buildDeckOutline — reviseSlides 逐字等價（契約 §6.4 回歸鎖定）", () => {
  it("以 REVISE_OUTLINE_OPTIONS 呼叫時，輸出與抽出前的 golden 公式逐字相同", () => {
    const rebuilt = formatDeckOutline(buildDeckOutline(SLIDES.map((spec) => ({ spec })), REVISE_OUTLINE_OPTIONS));
    expect(rebuilt).toBe(goldenOutline(SLIDES));
    // 空文字頁必須仍在（抽出前不跳頁）；且頁碼與原索引一致。
    expect(rebuilt.split("\n")).toHaveLength(SLIDES.length);
    expect(rebuilt.split("\n")[2]).toBe("#2 [image-full] ");
  });

  it("70 字截斷點逐字一致（長標題頁）", () => {
    const [row] = buildDeckOutline([{ spec: SLIDES[0]! }], REVISE_OUTLINE_OPTIONS);
    expect(row!.text).toBe(extractSlideText(SLIDES[0]!).replace(/\s+/g, " ").slice(0, 70));
    expect(row!.text.length).toBe(70);
  });
});

describe("buildDeckOutline — checklist 用預設行為（契約 §6.4）", () => {
  it("預設跳過兩個來源都沒字的頁，但保留原始頁碼", () => {
    const rows = buildDeckOutline(SLIDES.map((spec) => ({ spec })));
    expect(rows.map((r) => r.idx)).toEqual([0, 1, 3, 4]); // #2 被跳過
    expect(rows.find((r) => r.idx === 2)).toBeUndefined();
  });

  it("spec 無文字時退用 textExtract（C2 匯入 deck 餵料）；兩者皆空才跳過", () => {
    const rows = buildDeckOutline([
      { spec: SLIDES[2]!, textExtract: "  匯入頁的\n純文字  " },
      { spec: SLIDES[2]!, textExtract: "   " },
      { spec: SLIDES[2]! },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.idx).toBe(0);
    expect(rows[0]!.text).toBe(" 匯入頁的 純文字 ");
  });

  it("spec 有文字時不會被 textExtract 蓋掉", () => {
    const [row] = buildDeckOutline([{ spec: SLIDES[1]!, textExtract: "不該出現" }]);
    expect(row!.text).not.toContain("不該出現");
  });

  it("整份超過 12,000 字上限 → 逐頁等比截斷，頁序與頁碼不變", () => {
    const long = (n: number, ch: string): SlideSpec => ({
      id: `L${n}`,
      template: "content",
      source: "ai",
      blocks: [{ type: "paragraph", text: ch.repeat(n) }],
    });
    const rows = buildDeckOutline([{ spec: long(9_000, "甲") }, { spec: long(9_000, "乙") }]);
    const total = rows.reduce((n, r) => n + r.text.length, 0);
    expect(rows.map((r) => r.idx)).toEqual([0, 1]);
    expect(total).toBeLessThanOrEqual(DECK_OUTLINE_TOTAL_MAX_CHARS);
    expect(rows[0]!.text.length).toBe(rows[1]!.text.length); // 等比 → 同長度
    expect(rows[0]!.text.startsWith("甲")).toBe(true);
    expect(rows[1]!.text.startsWith("乙")).toBe(true);
  });

  it("capDeckOutlineTotal 未超限時原樣回傳；每頁至少留 1 字", () => {
    const rows = [
      { idx: 0, template: "content", text: "短" },
      { idx: 1, template: "content", text: "也短" },
    ];
    expect(capDeckOutlineTotal(rows, 100)).toEqual(rows);
    const squeezed = capDeckOutlineTotal(rows, 1);
    expect(squeezed.every((r) => r.text.length >= 1)).toBe(true);
  });
});
