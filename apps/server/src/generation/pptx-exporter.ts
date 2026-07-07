/**
 * PptxExporter — M2 frozen interface (M234_CONTRACT §M2) + its implementation.
 * The interface is the frozen seam; `createPptxExporter` wraps the designed renderer (pptx-render.ts,
 * borrowed v1 export/pptx.ts: designed layout + native charts), giving screen↔export design parity.
 * Route: GET /api/decks/:id/export.pptx (RFC5987 filename handled at the route layer).
 */
import type { Deck, SlideSpec } from "@meetcopilot/shared";
import { exportDeckToPptx } from "./pptx-render.js";

export interface PptxExporter {
  /** Render a deck + its slides to a .pptx Buffer (screen↔export design parity). */
  export(deck: Deck, slides: SlideSpec[]): Promise<Buffer>;
}

export function createPptxExporter(): PptxExporter {
  return {
    export(deck, slides) {
      return exportDeckToPptx({ title: deck.title, language: deck.language }, slides);
    },
  };
}
