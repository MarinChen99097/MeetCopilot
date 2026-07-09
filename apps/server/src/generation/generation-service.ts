/**
 * GenerationService — M2 frozen interface (M234_CONTRACT §M2) + its implementation.
 * The interface is the frozen seam; `createGenerationService` wires the slide-gen core (borrowed v1 generator +
 * auto-QA + DESIGN_PRINCIPLES, rewritten to v2 SlideSpec / append-only) to the DeckRepository for persistence.
 * Analysis/generation use the gemini-3.5-flash tier (config.gemini.extractModel), NOT flash-lite (L15).
 */
import { randomUUID } from "node:crypto";
import type { CrmCore } from "@meetcopilot/crm";
import type { Deck, GenerateDeckInput, SlideSpec } from "@meetcopilot/shared";
import type { GeminiClient } from "../gemini.js";
import type { Meter } from "../ops/meter.js";
import { meteredGeminiClient } from "../ops/metered-gemini.js";
import { generateDeckSlides, regenerateOneSlide } from "./slide-gen.js";

export interface GenerationService {
  /** Wizard generate → a persisted Deck (slides written via DeckRepository). userId 為 ADMIN_CONTRACT §2 的
   *  request-scoped 使用者歸屬（可選，回填 usage_events.user_id；既有呼叫不傳 → 行為不變）。 */
  generateDeck(orgId: string, input: GenerateDeckInput, userId?: string): Promise<Deck>;
  /** Auto-QA regenerate a single slide (borrows v1 slideQaIssues/reviseSlides); optional steering hint. */
  regenerateSlide(orgId: string, deckId: string, idx: number, hint?: string, userId?: string): Promise<SlideSpec>;
}

/** Thrown when the model produced nothing usable (all slides filtered to 0 blocks). Route → 502. */
export class GenerationEmptyError extends Error {
  constructor(message = "generation produced no usable slides") {
    super(message);
    this.name = "GenerationEmptyError";
  }
}

export function createGenerationService(
  core: CrmCore,
  gemini: GeminiClient,
  model: string,
  meter?: Meter,
): GenerationService {
  /** 有 meter 就現包一個 per-request metered client（記為 gemini_text）；否則透傳原 client。 */
  const forOrg = (orgId: string, userId?: string): GeminiClient =>
    meter
      ? meteredGeminiClient(gemini, meter, { orgId, kind: "gemini_text", userId, idemPrefix: `gen:${randomUUID()}` })
      : gemini;

  return {
    async generateDeck(orgId, input, userId) {
      const slides = await generateDeckSlides(forOrg(orgId, userId), model, input);
      if (slides.length === 0) throw new GenerationEmptyError();
      return core.decks.create(orgId, {
        title: input.topic,
        language: input.language,
        source: "ai",
        companyId: input.companyId,
        slides,
      });
    },

    async regenerateSlide(orgId, deckId, idx, hint, userId) {
      const found = await core.decks.findWithSlides(orgId, deckId);
      if (!found) throw new Error("deck not found");
      const { deck, slides } = found;
      const anchor = idx > 0 ? slides[idx - 1]?.spec : undefined;
      const current = slides.find((s) => s.idx === idx)?.spec;
      const next = await regenerateOneSlide(forOrg(orgId, userId), model, deck.language, anchor, current, hint);
      // updateSlide 守 I1（idx ≤ committedIndex → I1ViolationError）；會前 committedIndex=-1 不受限。
      const saved = await core.decks.updateSlide(orgId, deckId, idx, next);
      return saved.spec;
    },
  };
}
