/**
 * CrmCopilotOrchestrator — implements the frozen CopilotOrchestrator seam (realtime/copilot.ts).
 * signals → CRM retrieval (whitelist §9) → info_card; auto + manual research (deep_research); LLM speaker
 * inference (v2 decision: no dual-track diarization — speaker is inferred from content/tone after transcription).
 *
 * Everything here is async-callback territory: every path is guarded so a failure logs and returns rather than
 * rejecting into the pipeline (index.ts also installs an unhandledRejection guard). External calls are bounded.
 *
 * Concrete class exposes two extra methods beyond the frozen interface (inferSpeaker) — an internal M3 seam the
 * hub wires directly (M234 gap #4 permits refining under-specified internal seams within the single M3 line).
 */
import { randomUUID } from "node:crypto";
import { Type } from "@google/genai";
import type {
  InfoCard,
  ResearchJobStatus,
  SignalItem,
  TranscriptSegment,
  TranscriptSpeaker,
} from "@meetcopilot/shared";
import type { CrmCore } from "@meetcopilot/crm";
import type { CopilotOrchestrator } from "./copilot.js";
import type { LiveSessionRuntime } from "./session-runtime.js";
import { retrieveInfoCards, type RetrievalDeps } from "./retrieval.js";
import type { GeminiClient } from "../gemini.js";
import type { Meter } from "../ops/meter.js";
import { withDeadline } from "./util.js";

const TRANSCRIPT_CONTEXT_MAX = 12;
const SPEAKER_DEADLINE_MS = 8_000;
const GROUND_DEADLINE_MS = 20_000;
const RESEARCH_BODY_MAX = 500;
/** Signal kinds that auto-trigger a background deep-research (bounded by the per-meeting quota). */
const AUTO_RESEARCH_KINDS = new Set(["competitor_mention", "objection"]);

const SPEAKER_SCHEMA = {
  type: Type.OBJECT,
  properties: { speaker: { type: Type.STRING, enum: ["presenter", "client", "unknown"] } },
  required: ["speaker"],
};

export interface OrchestratorDeps {
  core: CrmCore;
  gemini: GeminiClient;
  /** Analysis-tier model (3.5-flash) for speaker inference. */
  inferenceModel: string;
  getRuntime(meetingId: string): LiveSessionRuntime | undefined;
  /** 計費（M5 §B，可選）：會中檢索的 query embedding 記為 embedding。 */
  meter?: Meter;
}

export class CrmCopilotOrchestrator implements CopilotOrchestrator {
  private infoCardCb: ((sessionId: string, card: InfoCard) => void) | null = null;
  private researchCb: ((sessionId: string, jobId: string, status: ResearchJobStatus, remainingQuota: number) => void) | null = null;
  private readonly context = new Map<string, string[]>();
  private readonly retrieval: RetrievalDeps;

  constructor(private readonly deps: OrchestratorDeps) {
    this.retrieval = { core: deps.core, gemini: deps.gemini, meter: deps.meter };
  }

  onInfoCard(cb: (sessionId: string, card: InfoCard) => void): void {
    this.infoCardCb = cb;
  }

  /** Hub sink for research_status frames (extra internal seam; not in the frozen interface). */
  onResearchStatus(cb: (sessionId: string, jobId: string, status: ResearchJobStatus, remainingQuota: number) => void): void {
    this.researchCb = cb;
  }

  onTranscript(sessionId: string, seg: TranscriptSegment): void {
    const ctx = this.context.get(sessionId) ?? [];
    ctx.push(`[${seg.speaker}] ${seg.text}`);
    this.context.set(sessionId, ctx.slice(-TRANSCRIPT_CONTEXT_MAX));
  }

  onSignals(sessionId: string, items: SignalItem[]): void {
    const runtime = this.deps.getRuntime(sessionId);
    if (!runtime) return;

    // 1) CRM retrieval → info_card(s) for the HUD.
    retrieveInfoCards(
      this.retrieval,
      {
        orgId: runtime.orgId,
        companyId: runtime.companyId,
        dealId: runtime.dealId,
        meetingId: sessionId,
        userId: runtime.presenterUserId,
      },
      items,
    )
      .then((cards) => {
        for (const card of cards) this.infoCardCb?.(sessionId, card);
      })
      .catch((err) => console.warn(`[copilot] retrieval error (meeting=${sessionId}): ${(err as Error).message}`));

    // 2) Auto research on high-value signals (competitor/objection), bounded by the shared quota.
    const trigger = items.find((s) => AUTO_RESEARCH_KINDS.has(s.kind));
    if (trigger) {
      void this.triggerResearch(sessionId, trigger.label).catch((err) =>
        console.warn(`[copilot] auto-research error (meeting=${sessionId}): ${(err as Error).message}`),
      );
    }
  }

  /** Manual (hud deep_research) or auto research; consumes one unit of the per-meeting quota (I: bounded). */
  async triggerResearch(sessionId: string, query: string): Promise<void> {
    const runtime = this.deps.getRuntime(sessionId);
    if (!runtime) return;
    const jobId = randomUUID();

    if (!this.deps.gemini.isConfigured() || !runtime.consumeResearchQuota()) {
      this.researchCb?.(sessionId, jobId, "failed", runtime.remainingResearchQuota());
      return;
    }
    this.researchCb?.(sessionId, jobId, "running", runtime.remainingResearchQuota());

    try {
      const contextText = (this.context.get(sessionId) ?? []).slice(-4).join("\n");
      const grounded = await withDeadline(
        this.deps.gemini.generateGrounded({
          prompt:
            `會議即時查詢：${query}\n` +
            (contextText ? `對話脈絡：\n${contextText}\n` : "") +
            "請用繁體中文簡短回答（要點式），並附上來源。",
        }),
        GROUND_DEADLINE_MS,
        "copilot.ground",
      );
      const card: InfoCard = {
        id: randomUUID(),
        kind: "research",
        title: `深查：${query}`.slice(0, 60),
        body: grounded.answer.slice(0, RESEARCH_BODY_MAX),
        sourceUrl: grounded.citations[0]?.url,
        trust: "live",
      };
      this.infoCardCb?.(sessionId, card);
      this.researchCb?.(sessionId, jobId, "done", runtime.remainingResearchQuota());
    } catch (err) {
      console.warn(`[copilot] ground failed (meeting=${sessionId}): ${(err as Error).message}`);
      this.researchCb?.(sessionId, jobId, "failed", runtime.remainingResearchQuota());
    }
  }

  /**
   * Infer the speaker of a finalized ASR segment from content/tone + recent context (LLM; v2 has no clean
   * diarization). Best-effort: unconfigured Gemini or any failure → 'unknown'. (Not in the frozen interface —
   * the hub calls this before building the TranscriptSegment it then passes to onTranscript.)
   */
  async inferSpeaker(sessionId: string, text: string): Promise<TranscriptSpeaker> {
    if (!this.deps.gemini.isConfigured()) return "unknown";
    const contextText = (this.context.get(sessionId) ?? []).slice(-6).join("\n");
    try {
      const out = await withDeadline(
        this.deps.gemini.generateJson<{ speaker?: TranscriptSpeaker }>({
          model: this.deps.inferenceModel,
          system:
            "你在判斷一句會議逐字稿是『報告者(presenter，銷售方)』還是『客戶(client)』說的。" +
            "依內容與語氣判斷；無法判斷時回 unknown。只輸出 schema JSON。",
          prompt: `對話脈絡：\n${contextText}\n\n這一句：${text}`,
          schema: SPEAKER_SCHEMA,
          maxOutputTokens: 64,
          attempts: 1,
        }),
        SPEAKER_DEADLINE_MS,
        "copilot.inferSpeaker",
      );
      const s = out?.speaker;
      return s === "presenter" || s === "client" ? s : "unknown";
    } catch {
      return "unknown";
    }
  }

  /** Drop per-session transcript context (called on session teardown). */
  disposeSession(sessionId: string): void {
    this.context.delete(sessionId);
  }
}
