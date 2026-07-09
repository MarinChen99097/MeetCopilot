/**
 * RealtimeHub — the per-process orchestration center for M3 live meetings.
 *
 * Owns:
 *  - the meeting registry (Map<meetingId, LiveSessionRuntime>) and rooms (connections + roles),
 *  - role-filtered broadcast (BroadcastSink) that ENFORCES I3: HUD content (transcript/signals/info_card/
 *    suggestion/suggestion_result/research_status) is only ever delivered to 'hud'; 'deck_update' only to
 *    'present'; 'session_state' to all,
 *  - the ASR→speaker→transcript→analysis→signals→retrieval wiring per session,
 *  - bounded per-session cleanup (v1 gap): dispose on meeting-end AND on a disconnect-idle timeout, so runtimes
 *    never accumulate. dispose() clears every timer/buffer (L13).
 *
 * The meeting↔deck/company/deal binding is registered by POST /api/meetings (same process) and consumed when a
 * runtime is lazily created on first connect.
 */
import type { WebSocket } from "ws";
import type { CrmCore } from "@meetcopilot/crm";
import type { ServerMessage, SignalItem, TranscriptSegment, WsRole } from "@meetcopilot/shared";
import { redactPii } from "@meetcopilot/shared";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { GeminiClient } from "../gemini.js";
import type { Meter } from "../ops/meter.js";
import { GeminiAsrProvider } from "../asr/gemini-asr.js";
import { RollingWindowAnalysisEngine } from "../analysis/gemini-analysis.js";
import type { AsrSegment } from "../asr/asr-provider.js";
import { LiveSessionRuntime } from "./session-runtime.js";
import { CrmCopilotOrchestrator } from "./orchestrator.js";
import { LivePatchService } from "./patch-service.js";
import { MeetingStore } from "./meeting-store.js";
import { routeTranscriptSegment } from "./transcript-privacy.js";
import type { BroadcastSink, BroadcastTarget, ConnMeta } from "./types.js";

/** Binding captured at meeting creation, consumed when the runtime is first materialized. */
export interface MeetingBinding {
  orgId: string;
  presenterUserId: string;
  companyId?: string;
  dealId?: string;
  deckId?: string;
}

interface Conn {
  ws: WebSocket;
  meta: ConnMeta;
}

/** Idle grace period after the last socket drops before a session is reclaimed (reconnect cancels it). */
const DISCONNECT_GRACE_MS = 5 * 60_000;

export class RealtimeHub implements BroadcastSink {
  readonly store: MeetingStore;
  readonly patch: LivePatchService;
  private readonly orchestrator: CrmCopilotOrchestrator;

  private readonly rooms = new Map<string, Set<Conn>>();
  private readonly sessions = new Map<string, LiveSessionRuntime>();
  private readonly bindings = new Map<string, MeetingBinding>();
  private readonly graceTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly core: CrmCore,
    private readonly config: AppConfig,
    private readonly gemini: GeminiClient,
    private readonly meter?: Meter,
  ) {
    this.store = new MeetingStore(core.db);
    this.orchestrator = new CrmCopilotOrchestrator({
      core,
      gemini,
      inferenceModel: config.gemini.extractModel,
      getRuntime: (id) => this.sessions.get(id),
      meter,
    });
    this.patch = new LivePatchService({
      getRuntime: (id) => this.sessions.get(id),
      sink: this,
      appendSlide: async (orgId, deckId, spec) => {
        const slide = await core.decks.appendSlide(orgId, deckId, spec);
        return { idx: slide.idx };
      },
    });
    // I3: HUD content sinks route to 'hud' only.
    this.orchestrator.onInfoCard((sid, card) => this.broadcast(sid, { type: "info_card", card }, "hud"));
    this.orchestrator.onResearchStatus((sid, jobId, status, remainingQuota) =>
      this.broadcast(sid, { type: "research_status", jobId, status, remainingQuota }, "hud"),
    );
  }

  /** Called by POST /api/meetings (same process) to record the live binding for lazy runtime creation. */
  registerMeeting(meetingId: string, binding: MeetingBinding): void {
    this.bindings.set(meetingId, binding);
  }

  // ── connection lifecycle ────────────────────────────────────────────────
  attach(ws: WebSocket, meta: ConnMeta): void {
    // Defensive against the WS pre-attach account-check race (ws-server.ts): if the socket already closed during
    // that async window, its 'close' event has already fired and no future close will detach it. Enrolling it now
    // would leave a ghost entry that keeps the room Set above size 0 forever → scheduleReclaim/disposeSession
    // never fire → the LiveSessionRuntime + Gemini ASR provider leak. Refuse to enroll a non-open socket.
    if (ws.readyState !== ws.OPEN) return;

    const timer = this.graceTimers.get(meta.meetingId);
    if (timer) {
      clearTimeout(timer);
      this.graceTimers.delete(meta.meetingId);
    }
    let set = this.rooms.get(meta.meetingId);
    if (!set) {
      set = new Set();
      this.rooms.set(meta.meetingId, set);
    }
    set.add({ ws, meta });
    // Materialize the runtime (loads deck head) THEN sync state, so the joiner's first session_state reflects
    // the real committedIndex rather than a transient default.
    void this.ensureRuntime(meta).then(() => {
      this.sendState(meta.meetingId, ws);
      this.broadcastState(meta.meetingId);
    });
  }

  detach(ws: WebSocket): void {
    for (const [meetingId, set] of this.rooms) {
      for (const conn of set) {
        if (conn.ws !== ws) continue;
        set.delete(conn);
        if (set.size === 0) {
          this.rooms.delete(meetingId);
          this.scheduleReclaim(meetingId);
        } else {
          this.broadcastState(meetingId);
        }
        return;
      }
    }
  }

  private scheduleReclaim(meetingId: string): void {
    const existing = this.graceTimers.get(meetingId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.graceTimers.delete(meetingId);
      if (!this.rooms.has(meetingId)) this.disposeSession(meetingId);
    }, DISCONNECT_GRACE_MS);
    if (typeof timer.unref === "function") timer.unref();
    this.graceTimers.set(meetingId, timer);
  }

  getRuntime(meetingId: string): LiveSessionRuntime | undefined {
    return this.sessions.get(meetingId);
  }

  /** Manual HUD deep_research → orchestrator (quota-bounded). */
  triggerResearch(meetingId: string, query: string): void {
    void this.orchestrator
      .triggerResearch(meetingId, query)
      .catch((err) => console.warn(`[hub] triggerResearch error (meeting=${meetingId}): ${(err as Error).message}`));
  }

  /** Persist the deck's committed_index (present page_commit). Best-effort; M2 DeckRepository owns it. */
  async setDeckCommitted(orgId: string, deckId: string, index: number): Promise<void> {
    await this.core.decks.setCommittedIndex(orgId, deckId, index);
  }

  /** End a meeting: mark completed, tear down the runtime, close its sockets. */
  async endMeeting(orgId: string, meetingId: string): Promise<boolean> {
    const ok = await this.store.end(orgId, meetingId);
    // Ownership is proven ONLY by the org-scoped store.end. The rooms/sessions maps are keyed by meetingId
    // alone, so tearing them down unconditionally would let an org-A caller kill org-B's live session by
    // guessing its meetingId (cross-tenant DoS). Only tear down when this org actually owned & ended it.
    if (!ok) return false;
    this.disposeSession(meetingId);
    const set = this.rooms.get(meetingId);
    if (set) {
      for (const conn of set) {
        if (conn.ws.readyState === conn.ws.OPEN) conn.ws.close(1000, "meeting ended");
      }
      this.rooms.delete(meetingId);
    }
    return ok;
  }

  /**
   * Graceful shutdown: tear down every live runtime (clears all timers/buffers — L13) and close all
   * open sockets, so SIGTERM leaves no dangling ASR/analysis work or leaked handles. Idempotent.
   */
  disposeAll(): void {
    for (const meetingId of [...this.sessions.keys()]) this.disposeSession(meetingId);
    for (const set of this.rooms.values()) {
      for (const conn of set) {
        if (conn.ws.readyState === conn.ws.OPEN) conn.ws.close(1001, "server shutting down");
      }
    }
    this.rooms.clear();
    for (const timer of this.graceTimers.values()) clearTimeout(timer);
    this.graceTimers.clear();
  }

  private disposeSession(meetingId: string): void {
    const runtime = this.sessions.get(meetingId);
    if (runtime) {
      runtime.dispose();
      this.sessions.delete(meetingId);
    }
    this.orchestrator.disposeSession(meetingId);
    this.bindings.delete(meetingId);
    const timer = this.graceTimers.get(meetingId);
    if (timer) {
      clearTimeout(timer);
      this.graceTimers.delete(meetingId);
    }
  }

  private async ensureRuntime(meta: ConnMeta): Promise<LiveSessionRuntime> {
    const existing = this.sessions.get(meta.meetingId);
    if (existing) return existing;

    const binding = this.bindings.get(meta.meetingId);
    const presenterUserId = binding?.presenterUserId ?? meta.userId;

    // Ephemeral-by-default (M5 §A): read the meeting's persist_transcript flag; default false (in-memory only).
    let persistTranscript = false;
    try {
      persistTranscript = (await this.store.privacySettings(meta.orgId, meta.meetingId)).persistTranscript;
    } catch (err) {
      console.warn(`[hub] privacy settings load failed (meeting=${meta.meetingId}): ${(err as Error).message}`);
    }

    // Best-effort load of deck head (M2 repo; may throw as a stub during parallel build → tolerate).
    let committedIndex = -1;
    let deckLength = 0;
    if (binding?.deckId) {
      try {
        const found = await this.core.decks.findWithSlides(meta.orgId, binding.deckId);
        if (found) {
          committedIndex = found.deck.committedIndex;
          deckLength = found.slides.length;
        }
      } catch (err) {
        console.warn(`[hub] deck load failed (deck=${binding.deckId}): ${(err as Error).message}`);
      }
    }

    const asr = new GeminiAsrProvider(this.config.gemini, meta.meetingId);
    // 會中分析記帳（ADMIN_CONTRACT §3.3）：有 meter 時，analysis 的 gemini_text 呼叫改走 metered client
    // （歸屬 orgId + meetingId）；不傳則沿用未計費行為。
    const engine = new RollingWindowAnalysisEngine(
      this.gemini,
      this.config.gemini.extractModel,
      meta.meetingId,
      this.meter ? { meter: this.meter, orgId: meta.orgId } : undefined,
    );

    const runtime = new LiveSessionRuntime({
      meetingId: meta.meetingId,
      orgId: meta.orgId,
      presenterUserId,
      deckId: binding?.deckId,
      companyId: binding?.companyId,
      dealId: binding?.dealId,
      initialCommittedIndex: committedIndex,
      persistTranscript,
      researchQuota: this.config.researchAutoLimitPerMeeting,
      asr,
      engine,
      rolesProvider: () => this.rolesOf(meta.meetingId),
      onSuggestionExpire: (mId, sId) =>
        this.broadcast(mId, { type: "suggestion_result", suggestionId: sId, status: "discarded" }, "hud"),
    });
    runtime.deckLength = Math.max(deckLength, runtime.deckLength);

    // ASR final → speaker inference → transcript (hud/I3) + persist + analysis feed.
    asr.onFinal((seg) => void this.onAsrFinal(runtime, seg));
    // Genuine ASR outage (transcribe threw/exhausted — NOT blank audio) → notify the presenter's HUD once
    // per outage so they know live transcription/analysis is degraded (contract C3; dedup lives in the
    // provider, cleared on the next successful transcribe). I3: hud only, and the payload carries no
    // transcript content.
    asr.onUnavailable(() =>
      this.broadcast(
        runtime.meetingId,
        { type: "error", code: "asr_unavailable", message: "語音辨識暫時中斷，系統會自動嘗試恢復" },
        "hud",
      ),
    );
    // Analysis threshold met → signals (hud/I3) + persist + orchestrator retrieval.
    engine.onSignals((items) => this.onSignals(runtime, items));

    this.sessions.set(meta.meetingId, runtime);
    return runtime;
  }

  private async onAsrFinal(runtime: LiveSessionRuntime, seg: AsrSegment): Promise<void> {
    // Consent gate (M5 §A): no analysis, no persistence, no LLM egress before consent — drop the segment.
    if (!runtime.consent) return;
    // ASR 記帳（ADMIN_CONTRACT §3.1）：每個成功轉寫的 final 逐字段記一筆 asr（chunk 計費，無 token）。
    // 冪等 key = meetingId + 單調 chunk 序號（同一段重試不重複計費）。fire-and-forget 副作用，
    // 絕不阻塞逐字稿遞送（meter 內部已吞 record 錯誤）。
    if (this.meter) {
      const seq = runtime.asrChunkSeq++;
      void this.meter.meter(
        runtime.orgId,
        "asr",
        async () => ({ result: undefined, meetingId: runtime.meetingId }),
        `asr:${runtime.meetingId}:${seq}`,
      );
    }
    // Redact PII before ANY LLM egress; speaker inference is an LLM call, so it sees redacted text too.
    const redactedText = redactPii(seg.text);
    const speaker = await this.orchestrator.inferSpeaker(runtime.meetingId, redactedText);
    // Re-check: consent may have been revoked during the async speaker inference above.
    if (!runtime.consent) return;
    const ts: TranscriptSegment = { id: randomUUID(), t: seg.t, speaker, text: seg.text, final: true };

    const route = routeTranscriptSegment({
      consent: runtime.consent,
      persistTranscript: runtime.persistTranscript,
      segment: ts,
    });
    // I3: raw transcript only to the presenter's private HUD (account B, isolated).
    if (route.hud) this.broadcast(runtime.meetingId, { type: "transcript", segment: route.hud }, "hud");
    // Ephemeral-by-default: persist (redacted) only when the meeting opted in.
    if (route.persist) this.store.saveSegment(runtime.orgId, runtime.meetingId, route.persist).catch(() => {});
    if (route.contextSegment) this.orchestrator.onTranscript(runtime.meetingId, route.contextSegment);
    if (route.analysisText != null) runtime.engine.ingest(runtime.meetingId, { ...seg, text: route.analysisText });
  }

  private onSignals(runtime: LiveSessionRuntime, items: SignalItem[]): void {
    this.broadcast(runtime.meetingId, { type: "signals", items }, "hud"); // I3: hud only
    for (const it of items) this.store.saveSignal(runtime.orgId, runtime.meetingId, it).catch(() => {});
    this.orchestrator.onSignals(runtime.meetingId, items);
  }

  // ── audio ingest (capture role, consent-gated) ──────────────────────────
  pushAudio(meta: ConnMeta, pcm: Buffer): void {
    const runtime = this.sessions.get(meta.meetingId);
    if (!runtime || !runtime.consent) return; // consent gate: no analysis until granted
    runtime.asr.pushAudio(meta.meetingId, pcm);
  }

  // ── broadcast (I3 role targeting) ───────────────────────────────────────
  broadcast(meetingId: string, msg: ServerMessage, target: BroadcastTarget): void {
    const set = this.rooms.get(meetingId);
    if (!set) return;
    const payload = JSON.stringify(msg);
    for (const conn of set) {
      if (target !== "all" && conn.meta.role !== target) continue;
      if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(payload);
    }
  }

  rolesOf(meetingId: string): WsRole[] {
    const set = this.rooms.get(meetingId);
    if (!set) return [];
    const roles = new Set<WsRole>();
    for (const conn of set) roles.add(conn.meta.role);
    return [...roles];
  }

  private buildState(meetingId: string): ServerMessage {
    const runtime = this.sessions.get(meetingId);
    return {
      type: "session_state",
      consent: runtime?.consent ?? false,
      committedIndex: runtime?.committedIndex ?? -1,
      connectedRoles: this.rolesOf(meetingId),
    };
  }

  private sendState(meetingId: string, ws: WebSocket): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(this.buildState(meetingId)));
  }

  broadcastState(meetingId: string): void {
    this.broadcast(meetingId, this.buildState(meetingId), "all");
  }
}
