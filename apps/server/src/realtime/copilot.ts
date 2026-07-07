/**
 * M3 realtime frozen interfaces (M234_CONTRACT §M3). NO IMPLEMENTATION here — the M3 build agent
 * implements against these signatures. Covers the per-meeting runtime, the CRM-retrieval orchestrator,
 * and the approval FSM (PatchService). Invariants: I1 append-only, I2 presenter-only approval, I3 HUD isolation.
 */
import type {
  InfoCard,
  SignalItem,
  SlideSpec,
  Suggestion,
  TranscriptSegment,
  WsRole,
} from "@meetcopilot/shared";

/**
 * SessionRuntime — per-meeting live state (in-memory + persisted). Held in a Map<meetingId, SessionRuntime>.
 * MUST support per-session cleanup (v1 gap: sessions grew monotonically) — reclaimed on end or disconnect timeout.
 */
export interface SessionRuntime {
  readonly meetingId: string;
  /** Monotonic; advanced by present's page_commit (I1 guard reads this). */
  committedIndex: number;
  /** consent gate — analysis does not start until true (capture consent). */
  consent: boolean;
  /** Currently connected roles (session_state sync on connect/reconnect). */
  connectedRoles(): WsRole[];
  /** Remaining per-meeting research quota (auto + manual deep_research). */
  remainingResearchQuota(): number;
  /** Release timers / buffers / sockets for this session (bounded teardown, L13). */
  dispose(): void;
}

/**
 * CopilotOrchestrator — signals → CRM retrieval (CRM_SCHEMA §9 whitelist, trust-gated) → info_card;
 * research trigger (auto + manual). Speaker inference: after transcription, an LLM infers presenter/client
 * from content/tone (decision: no dual-track diarization).
 */
export interface CopilotOrchestrator {
  /** A finalized transcript segment arrived (speaker already inferred). */
  onTranscript(sessionId: string, seg: TranscriptSegment): void;
  /** New signals arrived → may retrieve CRM context and emit info_card(s). */
  onSignals(sessionId: string, items: SignalItem[]): void;
  /** Manual "deep research" (hud deep_research) — bounded by the per-meeting quota. */
  triggerResearch(sessionId: string, query: string): Promise<void>;
  /** Register the HUD info_card sink (hud role only; never /present — I3). */
  onInfoCard(cb: (sessionId: string, card: InfoCard) => void): void;
}

/**
 * PatchService — reshaping engine + approval FSM (borrows v1 patch-service).
 * I2: only ACCEPT/EDIT append to the deck tail (I1). Only the presenter connection may act.
 */
export interface PatchService {
  /** Queue a suggested supplementary slide into the HUD approval queue. */
  suggest(sessionId: string, slide: SlideSpec, reason: string): Suggestion;
  /**
   * Presenter decision on a queued suggestion. `presenterAuth` = server-verified presenter identity
   * (attacker credentials must be rejected). ACCEPT/EDIT → append to deck tail; REJECT/expiry → discarded.
   */
  act(
    sessionId: string,
    suggestionId: string,
    action: "accept" | "edit" | "reject",
    presenterAuth: boolean,
    editedSlide?: SlideSpec,
  ): void;
}
