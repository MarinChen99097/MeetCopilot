/**
 * GenerationService — M2 frozen interface (M234_CONTRACT §M2) + its implementation.
 * The interface is the frozen seam; `createGenerationService` wires the slide-gen core (borrowed v1 generator +
 * auto-QA + DESIGN_PRINCIPLES, rewritten to v2 SlideSpec / append-only) to the DeckRepository for persistence.
 * Analysis/generation use the gemini-3.5-flash tier (config.gemini.extractModel), NOT flash-lite (L15).
 */
import type { CrmCore } from "@meetcopilot/crm";
import type { Deck, GenerateDeckInput, SlideSpec } from "@meetcopilot/shared";
import type { GeminiClient } from "../gemini.js";
import { generateDeckSlides, regenerateOneSlide } from "./slide-gen.js";

export interface GenerationService {
  /** Wizard generate → a persisted Deck (slides written via DeckRepository). */
  generateDeck(orgId: string, input: GenerateDeckInput): Promise<Deck>;
  /** Auto-QA regenerate a single slide (borrows v1 slideQaIssues/reviseSlides); optional steering hint. */
  regenerateSlide(orgId: string, deckId: string, idx: number, hint?: string): Promise<SlideSpec>;
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
): GenerationService {
  return {
    async generateDeck(orgId, input) {
      const slides = await generateDeckSlides(gemini, model, input);
      if (slides.length === 0) throw new GenerationEmptyError();
      return core.decks.create(orgId, {
        title: input.topic,
        language: input.language,
        source: "ai",
        companyId: input.companyId,
        slides,
      });
    },

    async regenerateSlide(orgId, deckId, idx, hint) {
      const found = await core.decks.findWithSlides(orgId, deckId);
      if (!found) throw new Error("deck not found");
      const { deck, slides } = found;
      const anchor = idx > 0 ? slides[idx - 1]?.spec : undefined;
      const current = slides.find((s) => s.idx === idx)?.spec;
      const next = await regenerateOneSlide(gemini, model, deck.language, anchor, current, hint);
      // updateSlide 守 I1（idx ≤ committedIndex → I1ViolationError）；會前 committedIndex=-1 不受限。
      const saved = await core.decks.updateSlide(orgId, deckId, idx, next);
      return saved.spec;
    },
  };
}
