/**
 * LivePatchService — approval FSM + reshaping engine, implementing the frozen PatchService seam
 * (realtime/copilot.ts). Borrows v1 deck/patch-service.ts, rewritten for v2's append-only PatchOp (I1).
 *
 * Invariants enforced here (server-authoritative; the client is only a secondary guard):
 *  - I2 (presenter approval): `act` refuses unless `presenterAuth` is true. That flag is computed at the WS
 *    layer as (userId === presenter_user_id AND role === 'present'); it is NEVER read from client payload.
 *  - I1 (append-only, never touch shown slides): only ACCEPT/EDIT reach the deck, always as an APPEND to the
 *    tail. patchMinIndex(APPEND, deckLength) === deckLength, which is always > committedIndex → the guard is
 *    structurally satisfied, and we assert it anyway before writing.
 *  - I3 (HUD isolation): `suggestion`/`suggestion_result` go to hud only; `deck_update` goes to present only.
 */
import { randomUUID } from "node:crypto";
import { patchMinIndex, type PatchOp, type SlideSpec, type Suggestion } from "@meetcopilot/shared";
import type { PatchService } from "./copilot.js";
import type { LiveSessionRuntime } from "./session-runtime.js";
import type { BroadcastSink } from "./types.js";

/** Default approval-queue TTL: a suggestion the presenter never acts on auto-discards after this. */
export const SUGGESTION_TTL_MS = 90_000;

export interface PatchServiceDeps {
  getRuntime(meetingId: string): LiveSessionRuntime | undefined;
  sink: BroadcastSink;
  /** Append a slide to the deck tail (M2 DeckRepository.appendSlide), returning the new idx. */
  appendSlide(orgId: string, deckId: string, spec: SlideSpec): Promise<{ idx: number }>;
  ttlMs?: number;
}

export class LivePatchService implements PatchService {
  private readonly ttlMs: number;

  constructor(private readonly deps: PatchServiceDeps) {
    this.ttlMs = deps.ttlMs ?? SUGGESTION_TTL_MS;
  }

  /** Queue a supplementary slide for presenter approval → HUD approval queue (I3: hud only). */
  suggest(sessionId: string, slide: SlideSpec, reason: string): Suggestion {
    const suggestion: Suggestion = {
      id: randomUUID(),
      slide,
      reason,
      expiresAt: Date.now() + this.ttlMs,
    };
    const runtime = this.deps.getRuntime(sessionId);
    if (!runtime) return suggestion; // session gone; nothing to queue/broadcast
    runtime.enqueueSuggestion(suggestion);
    this.deps.sink.broadcast(sessionId, { type: "suggestion", suggestion }, "hud");
    return suggestion;
  }

  /** Presenter decision on a queued suggestion. `presenterAuth` is the server-verified identity gate (I2). */
  act(
    sessionId: string,
    suggestionId: string,
    action: "accept" | "edit" | "reject",
    presenterAuth: boolean,
    editedSlide?: SlideSpec,
  ): void {
    if (!presenterAuth) return; // I2: non-presenter callers can never mutate the deck
    const runtime = this.deps.getRuntime(sessionId);
    if (!runtime) return;
    const entry = runtime.getSuggestion(suggestionId);
    if (!entry || entry.status !== "suggested") return; // unknown / already decided → ignore

    if (action === "reject") {
      if (runtime.settleSuggestion(suggestionId, "discarded")) {
        this.deps.sink.broadcast(
          sessionId,
          { type: "suggestion_result", suggestionId, status: "discarded" },
          "hud",
        );
      }
      return;
    }

    // accept / edit → append to deck tail (I1).
    const slide = action === "edit" && editedSlide ? editedSlide : entry.suggestion.slide;
    if (!runtime.deckId) {
      // No deck bound → cannot apply; discard so the HUD queue doesn't wedge.
      if (runtime.settleSuggestion(suggestionId, "discarded")) {
        this.deps.sink.broadcast(
          sessionId,
          { type: "suggestion_result", suggestionId, status: "discarded" },
          "hud",
        );
      }
      return;
    }

    const op: PatchOp = { kind: "APPEND", slide };
    // I1 assertion: append index (deckLength) must be strictly ahead of the committed head.
    if (patchMinIndex(op, runtime.deckLength) <= runtime.committedIndex) return;

    this.deps
      .appendSlide(runtime.orgId, runtime.deckId, slide)
      .then(({ idx }) => {
        if (!runtime.settleSuggestion(suggestionId, "applied")) return;
        runtime.deckLength = Math.max(runtime.deckLength, idx + 1);
        // I3: the new page is pushed silently to /present; the outcome is reported to /hud.
        this.deps.sink.broadcast(sessionId, { type: "deck_update", op: { kind: "APPEND", slide }, index: idx }, "present");
        this.deps.sink.broadcast(
          sessionId,
          { type: "suggestion_result", suggestionId, status: "applied", newSlideIndex: idx },
          "hud",
        );
      })
      .catch((err) => {
        console.error(`[patch] appendSlide failed (meeting=${sessionId}): ${(err as Error).message}`);
        if (runtime.settleSuggestion(suggestionId, "discarded")) {
          this.deps.sink.broadcast(
            sessionId,
            { type: "suggestion_result", suggestionId, status: "discarded" },
            "hud",
          );
        }
      });
  }
}
