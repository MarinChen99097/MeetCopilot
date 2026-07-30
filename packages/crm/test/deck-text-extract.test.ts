/**
 * C2 setSlideTextExtract / getPageImage 驗收（vitest, in-memory DB）。
 * 契約：docs/MEETING_CHECKLIST_CONTRACT.md §11.4——
 *  - 獨立 UPDATE 只寫 text_extract、不碰 spec_json、不走 updateSlide；
 *  - **對 committed/original 頁照寫成功**（證明繞開 I1/OriginalSlideLocked 守門是刻意且有效——
 *    text_extract 非 deck 內容變更）；
 *  - org 隔離：跨 org 呼叫零副作用（命中 0 列、不 throw）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestCore } from "../src/test-helpers.js";
import type { CrmCore } from "../src/ports.js";
import type { SlideSpec } from "@meetcopilot/shared";

let core: CrmCore;
const ORG = "org-textextract";
const OTHER_ORG = "org-attacker";

function imageFullSpec(assetRef: string): SlideSpec {
  return {
    id: `spec-${assetRef}`,
    template: "image-full",
    blocks: [{ type: "image", dataUri: `asset:${assetRef}` }],
    source: "pptx",
  } as SlideSpec;
}

/** 建一份匯入樣態的 deck：2 張 original 頁＋originalCount=2＋ready；回 deckId。 */
async function makeImportedDeck(): Promise<string> {
  const deck = await core.decks.create(ORG, {
    title: "匯入測試",
    language: "zh-TW",
    source: "pptx",
    sourceKind: "pptx",
    importStatus: "processing",
    originalCount: 0,
  });
  for (let i = 0; i < 2; i++) {
    const assetId = await core.deckAssets.insertAsset({
      deckId: deck.id,
      orgId: ORG,
      kind: "page_image",
      pageIndex: i,
      mime: "image/png",
      bytes: Buffer.from(`png-page-${i}`),
    });
    await core.decks.appendSlide(ORG, deck.id, imageFullSpec(assetId), { kind: "original", assetId });
  }
  await core.decks.setOriginalCount(deck.id, 2);
  await core.decks.setImportStatus(deck.id, "ready");
  return deck.id;
}

beforeEach(async () => {
  core = await makeTestCore();
  await core.migrate();
});
afterEach(() => core.close());

describe("setSlideTextExtract（契約 §11.4）", () => {
  it("對 original 頁照寫成功，且 spec_json 逐位元不動（繞開 OriginalSlideLocked 是刻意且有效）", async () => {
    const deckId = await makeImportedDeck();
    const before = await core.decks.findWithSlides(ORG, deckId);
    const specJsonBefore = JSON.stringify(before!.slides[0]!.spec);

    // original 頁（idx=0 < originalCount=2）——updateSlide 對它必丟 OriginalSlideLockedError，本方法必須照寫。
    await core.decks.setSlideTextExtract(ORG, deckId, 0, "第一頁的逐頁文字");

    const after = await core.decks.findWithSlides(ORG, deckId);
    expect(after!.slides[0]!.textExtract).toBe("第一頁的逐頁文字");
    expect(JSON.stringify(after!.slides[0]!.spec)).toBe(specJsonBefore); // spec_json 完全不動
    expect(after!.slides[1]!.textExtract).toBeUndefined(); // 只動指定 idx
  });

  it("對 committed（已播）頁照寫成功（繞開 I1 守門是刻意且有效——text_extract 非 deck 內容變更）", async () => {
    const deckId = await makeImportedDeck();
    // 把 committedIndex 推到 1 → idx 0/1 都是「已播」，updateSlide 會 I1ViolationError。
    await core.decks.setCommittedIndex(ORG, deckId, 1);

    await core.decks.setSlideTextExtract(ORG, deckId, 1, "已播頁也要能寫");

    const after = await core.decks.findWithSlides(ORG, deckId);
    expect(after!.deck.committedIndex).toBe(1);
    expect(after!.slides[1]!.textExtract).toBe("已播頁也要能寫");
  });

  it("org 隔離：攻擊者 org 寫入 → 命中 0 列、零副作用、不 throw", async () => {
    const deckId = await makeImportedDeck();

    await expect(
      core.decks.setSlideTextExtract(OTHER_ORG, deckId, 0, "跨租戶注入"),
    ).resolves.toBeUndefined(); // 不 throw

    const after = await core.decks.findWithSlides(ORG, deckId);
    expect(after!.slides[0]!.textExtract).toBeUndefined(); // 完全沒被寫
    expect(after!.slides[1]!.textExtract).toBeUndefined();
  });

  it("空字串 ''（讀圖確認無字的負結果標記，§11.1 v1.4 三態）照寫、讀回仍是 ''，不被折回 undefined", async () => {
    const deckId = await makeImportedDeck();
    await core.decks.setSlideTextExtract(ORG, deckId, 0, "");
    const after = await core.decks.findWithSlides(ORG, deckId);
    // rowToSlide 的 `text_extract ?? undefined` 只折 NULL：'' 必須存活整條讀回鏈（'' ?? undefined === ''）。
    expect(after!.slides[0]!.textExtract).toBe("");
    expect(after!.slides[1]!.textExtract).toBeUndefined(); // 未抽過的頁仍是 NULL → undefined（三態可區分）
  });

  it("重寫覆蓋同頁（管線的 fill-empty 冪等在上層；repo 本身是純 setter）", async () => {
    const deckId = await makeImportedDeck();
    await core.decks.setSlideTextExtract(ORG, deckId, 0, "v1");
    await core.decks.setSlideTextExtract(ORG, deckId, 0, "v2");
    const after = await core.decks.findWithSlides(ORG, deckId);
    expect(after!.slides[0]!.textExtract).toBe("v2");
  });
});

describe("getPageImage（契約 §11.5 回填讀圖）", () => {
  it("依 deckId+pageIndex 取回該頁 PNG bytes", async () => {
    const deckId = await makeImportedDeck();
    const png = await core.deckAssets.getPageImage(ORG, deckId, 1);
    expect(png).not.toBeNull();
    expect(Buffer.from(png!).toString()).toBe("png-page-1");
  });

  it("未命中（不存在的頁）回 null；跨 org 回 null（隔離）", async () => {
    const deckId = await makeImportedDeck();
    expect(await core.deckAssets.getPageImage(ORG, deckId, 99)).toBeNull();
    expect(await core.deckAssets.getPageImage(OTHER_ORG, deckId, 0)).toBeNull();
  });

  it("不會誤回原檔 asset（kind 過濾 page_image）", async () => {
    const deckId = await makeImportedDeck();
    // 補一筆原檔 asset（無 pageIndex）——getPageImage(…, 0) 仍必須回 page_image 那筆。
    await core.deckAssets.insertAsset({
      deckId,
      orgId: ORG,
      kind: "source_pptx",
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      bytes: Buffer.from("source-bytes"),
    });
    const png = await core.deckAssets.getPageImage(ORG, deckId, 0);
    expect(Buffer.from(png!).toString()).toBe("png-page-0");
  });
});
