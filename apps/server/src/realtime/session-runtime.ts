/**
 * LiveSessionRuntime — per-meeting in-process state, implementing the frozen SessionRuntime seam
 * (realtime/copilot.ts). Held in the RealtimeHub's Map<meetingId, LiveSessionRuntime>.
 *
 * Owns: committedIndex mirror (I1 guard reads this), consent gate, the per-session ASR + AnalysisEngine
 * instances, the approval queue (Suggestion + TTL timers), and the research quota counter.
 *
 * Cleanup (v1 gap: sessions grew monotonically): `dispose()` clears every timer/buffer so a hub that reclaims
 * a session on end / disconnect-timeout leaves nothing behind (bounded teardown, L13).
 */
import type { SignalItem, Suggestion, WsRole } from "@meetcopilot/shared";
import type { SessionRuntime } from "./copilot.js";
import type { AsrProvider } from "../asr/asr-provider.js";
import type { AnalysisEngine } from "../analysis/analysis-engine.js";

export type SuggestionStatus = "suggested" | "applied" | "discarded";

interface QueuedSuggestion {
  suggestion: Suggestion;
  status: SuggestionStatus;
  timer: NodeJS.Timeout;
}

export interface SessionRuntimeDeps {
  meetingId: string;
  orgId: string;
  presenterUserId: string;
  /** Optional bound deck (present/append only make sense with a deck). */
  deckId?: string;
  /** Counterpart context for CRM retrieval whitelist (CRM_SCHEMA §9). */
  companyId?: string;
  dealId?: string;
  initialCommittedIndex: number;
  /**
   * Ephemeral-by-default privacy flag (M5 §A). false (default) → transcript segments stay in SessionRuntime
   * memory and are NEVER written to meeting_transcript_segments (gone on dispose). true → segments persist
   * (redacted). Loaded from meetings.persist_transcript by the hub when the runtime is materialized.
   */
  persistTranscript?: boolean;
  researchQuota: number;
  asr: AsrProvider;
  engine: AnalysisEngine;
  /** Reads currently-connected roles from the hub's room (session_state sync). */
  rolesProvider: () => WsRole[];
  /** Fired when a queued suggestion hits its TTL → hub broadcasts suggestion_result discarded. */
  onSuggestionExpire: (meetingId: string, suggestionId: string) => void;
}

export class LiveSessionRuntime implements SessionRuntime {
  readonly meetingId: string;
  readonly orgId: string;
  readonly presenterUserId: string;
  readonly deckId?: string;
  readonly companyId?: string;
  readonly dealId?: string;
  committedIndex: number;
  consent = false;
  /** Ephemeral-by-default (M5 §A): only persist transcript segments to DB when this is true. */
  readonly persistTranscript: boolean;
  readonly asr: AsrProvider;
  readonly engine: AnalysisEngine;

  /** Deck length mirror (grows on append) — needed for the I1 patchMinIndex(op, deckLength) guard. */
  deckLength: number;

  private research: number;
  private readonly queue = new Map<string, QueuedSuggestion>();
  private disposed = false;

  constructor(private readonly deps: SessionRuntimeDeps) {
    this.meetingId = deps.meetingId;
    this.orgId = deps.orgId;
    this.presenterUserId = deps.presenterUserId;
    this.deckId = deps.deckId;
    this.companyId = deps.companyId;
    this.dealId = deps.dealId;
    this.committedIndex = deps.initialCommittedIndex;
    this.persistTranscript = deps.persistTranscript ?? false;
    this.deckLength = Math.max(0, deps.initialCommittedIndex + 1);
    this.research = deps.researchQuota;
    this.asr = deps.asr;
    this.engine = deps.engine;
  }

  connectedRoles(): WsRole[] {
    return this.deps.rolesProvider();
  }

  remainingResearchQuota(): number {
    return this.research;
  }

  /** Decrement the research quota if any remains; returns false when exhausted (auto + manual share it). */
  consumeResearchQuota(): boolean {
    if (this.research <= 0) return false;
    this.research -= 1;
    return true;
  }

  // ── approval queue (I2) ────────────────────────────────────────────────
  enqueueSuggestion(suggestion: Suggestion): void {
    if (this.disposed) return;
    const ttl = Math.max(0, suggestion.expiresAt - Date.now());
    const timer = setTimeout(() => {
      const entry = this.queue.get(suggestion.id);
      if (!entry || entry.status !== "suggested") return;
      entry.status = "discarded";
      this.deps.onSuggestionExpire(this.meetingId, suggestion.id);
    }, ttl);
    // Do not keep the event loop alive solely for a suggestion timer.
    if (typeof timer.unref === "function") timer.unref();
    this.queue.set(suggestion.id, { suggestion, status: "suggested", timer });
  }

  getSuggestion(id: string): QueuedSuggestion | undefined {
    return this.queue.get(id);
  }

  /** Transition a suggestion out of `suggested`; clears its TTL timer. No-op if already decided/unknown. */
  settleSuggestion(id: string, status: "applied" | "discarded"): boolean {
    const entry = this.queue.get(id);
    if (!entry || entry.status !== "suggested") return false;
    clearTimeout(entry.timer);
    entry.status = status;
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.queue.values()) clearTimeout(entry.timer);
    this.queue.clear();
    // Drop any buffered audio in the ASR chunker (never transcribe post-teardown).
    const asr = this.asr as { reset?: () => void };
    if (typeof asr.reset === "function") asr.reset();
  }
}
