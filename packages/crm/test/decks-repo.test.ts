/**
 * DeckRepository 驗收（vitest, in-memory DB）：007_decks.sql DDL + CRUD + I1（append-only）守門 + image_jobs。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestCore } from "../src/test-helpers.js";
import { I1ViolationError } from "../src/repos-decks.js";
import type { CrmCore } from "../src/ports.js";
import type { SlideSpec } from "@meetcopilot/shared";

let core: CrmCore;
const ORG = "org-decks-test";

function slide(text: string): SlideSpec {
  return { id: "", template: "content", blocks: [{ type: "heading", text }], source: "ai" };
}

beforeEach(async () => {
  core = await makeTestCore();
  await core.migrate();
});
afterEach(() => core.close());

describe("DeckRepository", () => {
  it("creates a deck with initial slides and reads them back in idx order", async () => {
    const deck = await core.decks.create(ORG, {
      title: "My Deck",
      language: "zh-TW",
      source: "ai",
      slides: [slide("one"), slide("two"), slide("three")],
    });
    expect(deck.committedIndex).toBe(-1);
    const found = await core.decks.findWithSlides(ORG, deck.id);
    expect(found?.slides.map((s) => s.idx)).toEqual([0, 1, 2]);
    const summaries = await core.decks.list(ORG);
    expect(summaries.find((s) => s.id === deck.id)?.slideCount).toBe(3);
  });

  it("appendSlide always lands at max(idx)+1 (tail)", async () => {
    const deck = await core.decks.create(ORG, { title: "D", language: "en", source: "ai", slides: [slide("a")] });
    const appended = await core.decks.appendSlide(ORG, deck.id, slide("b"));
    expect(appended.idx).toBe(1);
    const again = await core.decks.appendSlide(ORG, deck.id, slide("c"));
    expect(again.idx).toBe(2);
  });

  it("updateSlide allows editing a pending slide (idx > committedIndex)", async () => {
    const deck = await core.decks.create(ORG, {
      title: "D",
      language: "en",
      source: "ai",
      slides: [slide("a"), slide("b")],
    });
    const saved = await core.decks.updateSlide(ORG, deck.id, 1, slide("b-edited"));
    expect((saved.spec.blocks[0] as { text: string }).text).toBe("b-edited");
  });

  it("I1: updateSlide rejects idx <= committedIndex with I1ViolationError", async () => {
    const deck = await core.decks.create(ORG, {
      title: "D",
      language: "en",
      source: "ai",
      slides: [slide("a"), slide("b"), slide("c")],
    });
    await core.decks.setCommittedIndex(ORG, deck.id, 1); // committed up to idx 1
    await expect(core.decks.updateSlide(ORG, deck.id, 1, slide("x"))).rejects.toBeInstanceOf(I1ViolationError);
    await expect(core.decks.updateSlide(ORG, deck.id, 0, slide("x"))).rejects.toBeInstanceOf(I1ViolationError);
    // idx 2 is still pending → allowed
    await expect(core.decks.updateSlide(ORG, deck.id, 2, slide("ok"))).resolves.toBeTruthy();
  });

  it("setCommittedIndex is monotonic (never regresses)", async () => {
    const deck = await core.decks.create(ORG, { title: "D", language: "en", source: "ai", slides: [slide("a")] });
    await core.decks.setCommittedIndex(ORG, deck.id, 3);
    await core.decks.setCommittedIndex(ORG, deck.id, 1); // regress attempt
    const d = await core.decks.findById(ORG, deck.id);
    expect(d?.committedIndex).toBe(3);
  });

  it("org-scoping: another org cannot read the deck", async () => {
    const deck = await core.decks.create(ORG, { title: "D", language: "en", source: "ai" });
    expect(await core.decks.findById("other-org", deck.id)).toBeNull();
  });

  it("image jobs: create → update → refused status persists", async () => {
    const deck = await core.decks.create(ORG, { title: "D", language: "en", source: "ai" });
    const job = await core.decks.createImageJob(ORG, { deckId: deck.id, slideIdx: 0, kind: "background" });
    expect(job.status).toBe("queued");
    const done = await core.decks.updateImageJob(ORG, job.id, {
      status: "refused",
      error: "moderation",
      finishedAt: Date.now(),
    });
    expect(done.status).toBe("refused");
    expect(done.error).toBe("moderation");
  });

  it("delete removes deck, its slides and image jobs", async () => {
    const deck = await core.decks.create(ORG, { title: "D", language: "en", source: "ai", slides: [slide("a")] });
    await core.decks.createImageJob(ORG, { deckId: deck.id, slideIdx: 0, kind: "full" });
    await core.decks.delete(ORG, deck.id);
    expect(await core.decks.findById(ORG, deck.id)).toBeNull();
    expect(await core.decks.findWithSlides(ORG, deck.id)).toBeNull();
  });
});
