/**
 * sanitizeChecklist 的 slideIdx 守衛（契約 §6.2）。
 *
 * 核心回歸：`buildDeckOutline` 預設 **跳過沒有文字的頁但保留原始頁碼**（deck-outline.test.ts:97-101），
 * 所以大綱的 idx 集合可能不連號（5 頁 deck → `[0,1,3,4]`，length=4）。而 `formatDeckOutline` 輸出 `#${idx}`、
 * CHECKLIST_SYSTEM 明令模型「填該頁的 #編號」→ **模型回的是原始頁碼**。
 * 若守衛拿「列數」當上限（`rawIdx < deckOutline.length`），模型正確回的 `slideIdx:4` 會被判 4<4=false → 靜默丟成
 * undefined → 落庫 slide_idx=NULL → hub 的翻頁勾稽與 HUD「正在講」高亮對該項永久失效（且無任何 log）。
 * 本檔鎖住「以大綱實際存在的頁碼集合為權威」的行為。
 */
import { describe, it, expect } from "vitest";
import type { SlideSpec } from "@meetcopilot/shared";
import { buildDeckOutline } from "./slide-gen.js";
import { sanitizeChecklist } from "./checklist-gen.js";

function textPage(id: string, text: string): SlideSpec {
  return { id, template: "content", source: "ai", blocks: [{ type: "heading", text }] };
}

/** 5 頁 deck，第 3 頁（idx=2）＝無 alt 的 image-full（兩個來源都沒字）→ 預設會被跳過。 */
const SLIDES: SlideSpec[] = [
  textPage("s0", "公司概述與本次議程"),
  textPage("s1", "現況痛點與量化損失"),
  { id: "s2", template: "image-full", source: "pptx", blocks: [{ type: "image", dataUri: "data:image/png;base64,AA" }] },
  textPage("s3", "導入時程與里程碑"),
  textPage("s4", "報價與方案比較"),
];

const OUTLINE = buildDeckOutline(SLIDES.map((spec) => ({ spec })));

describe("sanitizeChecklist — slideIdx 守衛以「大綱實際頁碼集合」為權威", () => {
  it("前提：5 頁 deck 跳過純圖頁 → 大綱 idx=[0,1,3,4]、length=4（頁碼 ≠ 列數）", () => {
    expect(OUTLINE.map((r) => r.idx)).toEqual([0, 1, 3, 4]);
    expect(OUTLINE).toHaveLength(4);
  });

  it("talk 項的 slideIdx=4 必須保留（等於列數 4，用列數當上限的舊寫法會誤丟）", () => {
    const items = sanitizeChecklist(
      { items: [{ category: "talk", title: "說明報價與方案差異", slideIdx: 4, keywords: ["報價"], priority: "must" }] },
      OUTLINE,
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.slideIdx).toBe(4);
  });

  it("被跳過的空頁頁碼（idx=2）丟成 undefined——不把 talk 項綁到純圖頁", () => {
    const items = sanitizeChecklist(
      { items: [{ category: "talk", title: "講那張純圖", slideIdx: 2, keywords: ["圖"], priority: "must" }] },
      OUTLINE,
    );
    expect(items[0]!.slideIdx).toBeUndefined();
  });

  it("真的超出 deck 的頁碼（5）與負數／非整數一律丟成 undefined", () => {
    const items = sanitizeChecklist(
      {
        items: [
          { category: "talk", title: "超出範圍", slideIdx: 5, keywords: ["a"], priority: "must" },
          { category: "talk", title: "負數", slideIdx: -1, keywords: ["b"], priority: "must" },
          { category: "talk", title: "非整數", slideIdx: 1.5, keywords: ["c"], priority: "must" },
          { category: "talk", title: "非數字", slideIdx: "3", keywords: ["d"], priority: "must" },
        ],
      },
      OUTLINE,
    );
    expect(items.map((i) => i.slideIdx)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("ask／address 的 slideIdx 恆 undefined（契約 §6.2），即使模型硬填了合法頁碼", () => {
    const items = sanitizeChecklist(
      {
        items: [
          { category: "ask", title: "問預算區間", slideIdx: 1, keywords: ["預算"], priority: "must" },
          { category: "address", title: "回應資安疑慮", slideIdx: 3, keywords: ["資安"], priority: "must" },
          { category: "talk", title: "說明導入時程", slideIdx: 3, keywords: ["時程"], priority: "must" },
        ],
      },
      OUTLINE,
    );
    expect(items[0]!.slideIdx).toBeUndefined();
    expect(items[1]!.slideIdx).toBeUndefined();
    expect(items[2]!.slideIdx).toBe(3); // talk 同頁碼則保留 → 證明上面兩條是被 category 擋掉的
  });

  it("沒綁 deck（大綱為空）→ 任何 slideIdx 都丟棄，且項目本身仍保留", () => {
    const items = sanitizeChecklist(
      { items: [{ category: "talk", title: "無簡報也要講", slideIdx: 0, keywords: ["x"], priority: "must" }] },
      [],
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.slideIdx).toBeUndefined();
  });
});
