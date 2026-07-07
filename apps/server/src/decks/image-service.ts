/**
 * ImageService — M2 frozen interface (M234_CONTRACT §M2) + its implementation.
 * The interface is the frozen seam; `createImageService` wraps the M0 ImageProvider (providers/image.ts,
 * OpenAI gpt-image-2) with job semantics: enqueue (pre-meeting) → 202 {jobId}, background run, persist via
 * DeckRepository.createImageJob/updateImageJob.
 *  - A moderation block ⇒ status 'refused' (frontend fallback gradient; API_CONTRACT §4).
 *  - Any other failure ⇒ 'failed' + error.
 *  - L13 bounded: the external OpenAI call is raced against a hard deadline; overrun ⇒ 'failed' (no hung job).
 * The background job is fire-and-forget; index.ts has an unhandledRejection guard, but we also .catch here.
 */
import type { CrmCore } from "@meetcopilot/crm";
import type { ImageKind } from "@meetcopilot/shared";
import { extractSlideText } from "@meetcopilot/shared";
import { OpenAIImageRefusedError, type ImageProvider } from "../providers/image.js";

export interface ImageService {
  /** Enqueue a pre-meeting image job → { jobId } (202). Runs async; poll via GET /api/image-jobs/:id. */
  enqueue(
    orgId: string,
    deckId: string,
    slideIdx: number,
    kind: ImageKind,
    prompt?: string,
  ): Promise<{ jobId: string }>;
}

/** Hard deadline for a single image generation (empirically ~10–80s; cap well above to avoid a hung job). */
const IMAGE_DEADLINE_MS = 180_000;

/** Compose the final generation prompt: caller prompt wins; else derive from the slide's text. */
function composePrompt(kind: ImageKind, callerPrompt: string | undefined, slideText: string): string {
  const base = callerPrompt?.trim() || slideText.trim() || "an abstract professional presentation visual";
  const styleSuffix =
    kind === "background"
      ? " — subtle, low-contrast abstract background suitable behind slide text, no words, no logos, cinematic soft lighting, 16:9"
      : " — a striking full-slide editorial illustration, no words, no logos, high production value, 16:9";
  return `${base}${styleSuffix}`;
}

export function createImageService(core: CrmCore, provider: ImageProvider): ImageService {
  async function run(orgId: string, jobId: string, deckId: string, slideIdx: number, kind: ImageKind, prompt?: string) {
    try {
      await core.decks.updateImageJob(orgId, jobId, { status: "running" });

      // Derive prompt from the target slide's text when the caller didn't supply one.
      let slideText = "";
      if (!prompt?.trim()) {
        const found = await core.decks.findWithSlides(orgId, deckId);
        const slide = found?.slides.find((s) => s.idx === slideIdx)?.spec;
        if (slide) slideText = extractSlideText(slide);
      }
      const finalPrompt = composePrompt(kind, prompt, slideText);

      // L13: bound the external call — race against a hard deadline so a stuck provider can't hang the job.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("image generation timed out")), IMAGE_DEADLINE_MS);
      });
      let result;
      try {
        result = await Promise.race([
          provider.generate({ prompt: finalPrompt, kind }),
          deadline,
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }

      await core.decks.updateImageJob(orgId, jobId, {
        status: "done",
        dataUri: result.dataUri,
        finishedAt: Date.now(),
      });
    } catch (err) {
      const refused = err instanceof OpenAIImageRefusedError;
      await core.decks
        .updateImageJob(orgId, jobId, {
          status: refused ? "refused" : "failed",
          error: err instanceof Error ? err.message : String(err),
          finishedAt: Date.now(),
        })
        .catch((e) => console.error("[image] failed to persist job failure:", e));
    }
  }

  return {
    async enqueue(orgId, deckId, slideIdx, kind, prompt) {
      const job = await core.decks.createImageJob(orgId, { deckId, slideIdx, kind, prompt });
      // Fire-and-forget background run; errors are captured into the job row, never thrown to the request.
      void run(orgId, job.id, deckId, slideIdx, kind, prompt).catch((e) =>
        console.error("[image] runJob crashed:", e),
      );
      return { jobId: job.id };
    },
  };
}
