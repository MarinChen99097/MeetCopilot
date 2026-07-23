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
  ContactSummary,
  InfoCard,
  ResearchJobStatus,
  SignalItem,
  TranscriptSegment,
  TranscriptSpeaker,
} from "@meetcopilot/shared";
import type { CrmCore } from "@meetcopilot/crm";
import type { CopilotOrchestrator } from "./copilot.js";
import type { LiveSessionRuntime } from "./session-runtime.js";
import { retrieveInfoCards, collectWhitelist, type RetrievalDeps, type MeetingContext } from "./retrieval.js";
import type { GeminiClient } from "../gemini.js";
import type { Meter } from "../ops/meter.js";
import { withDeadline } from "./util.js";
import { generateSupplementSlide } from "../generation/slide-gen.js";
import { meteredGeminiClient } from "../ops/metered-gemini.js";
import type { SlideSpec, UsageKind } from "@meetcopilot/shared";

const TRANSCRIPT_CONTEXT_MAX = 12;
const SPEAKER_DEADLINE_MS = 8_000;
const GROUND_DEADLINE_MS = 20_000;
const RESEARCH_BODY_MAX = 500;
/** Recent transcript lines folded into the CRM-retrieval query (§4.2 「signal label＋近期逐字稿要點」). */
const RETRIEVAL_CONTEXT_MAX = 6;
/** Recent transcript lines fed into the speaker-inference prompt (distinct purpose from RETRIEVAL_CONTEXT_MAX). */
const SPEAKER_CONTEXT_MAX = 6;
/** Max CRM contacts injected into the speaker-inference prompt (bounds the prompt; §4.2 multi-speaker labeling). */
const CONTACTS_ROSTER_MAX = 20;
/** Cap on an inferred speakerLabel (chars). */
const SPEAKER_LABEL_MAX = 40;
/**
 * Signal kinds that auto-trigger a background deep-research (bounded by the per-meeting quota).
 * NOTE (§4.2): person_mention/topic_shift are deliberately NOT here — they trigger CRM retrieval only,
 * never a research job (auto-research conditions are unchanged).
 */
const AUTO_RESEARCH_KINDS = new Set(["competitor_mention", "objection"]);

/**
 * DynamicSlide 補充頁橋接（此前生產缺失的一段：signals→生成一張補充頁→patch.suggest→I2 批准佇列）。
 * 只在出現「值得補一頁」的實質訊號時觸發；person_mention/landmine 排除（前者只做檢索、後者是警示非簡報素材）。
 */
const SUPPLEMENT_TRIGGER_KINDS = new Set<string>([
  "interest",
  "objection",
  "pain",
  "competitor_mention",
  "buying_signal",
  "risk",
  "pricing",
  "next_step",
  "topic_shift",
]);
/** 兩次自動補充頁建議的最小間隔（節流；env SUPPLEMENT_THROTTLE_MS 覆寫）。 */
const SUPPLEMENT_THROTTLE_MS = Number(process.env.SUPPLEMENT_THROTTLE_MS ?? 40_000);
/** 餵進補充頁生成 prompt 的近期逐字行數。 */
const SUPPLEMENT_CONTEXT_MAX = 8;
/** 補充頁生成硬上限（含 Gemini 兩次嘗試）。 */
const SUPPLEMENT_DEADLINE_MS = 20_000;

const SPEAKER_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    speaker: { type: Type.STRING, enum: ["presenter", "client", "unknown"] },
    // 選填細分標籤（雙方可能各不只一位）；不在 required，模型無把握時省略。
    speakerLabel: { type: Type.STRING },
  },
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
  /** DynamicSlide 補充頁：每場自動「建議一頁」的上限（config.supplementAutoLimitPerMeeting；0 = 關閉）。 */
  supplementAutoLimitPerMeeting: number;
  /** 兩次補充頁建議的最小間隔 ms（可選；預設 SUPPLEMENT_THROTTLE_MS。僅測試會覆寫）。 */
  supplementThrottleMs?: number;
}

/** 說話者推斷結果（§4.2）：wire 枚舉 speaker 不變＋選填細分 speakerLabel（缺席即舊行為）。 */
export interface SpeakerInference {
  speaker: TranscriptSpeaker;
  speakerLabel?: string;
}

export class CrmCopilotOrchestrator implements CopilotOrchestrator {
  private infoCardCb: ((sessionId: string, card: InfoCard) => void) | null = null;
  private researchCb: ((sessionId: string, jobId: string, status: ResearchJobStatus, remainingQuota: number) => void) | null = null;
  /** DynamicSlide 補充頁橋接 sink（hub 接到 patch.suggest → HUD 批准佇列，I2 手動批准才 append）。 */
  private suggestSlideCb: ((sessionId: string, slide: SlideSpec, reason: string) => void) | null = null;
  /** 每場上次自動補充頁建議的時戳（節流用）。 */
  private readonly lastSuggestAt = new Map<string, number>();
  /** 每場已自動建議的補充頁數（配額用）。 */
  private readonly suggestCount = new Map<string, number>();
  private readonly context = new Map<string, string[]>();
  /** 每場已出過卡的實體集合（`entityType:entityId`）：同場同 entity 去重（§4.2）。 */
  private readonly cardedEntities = new Map<string, Set<string>>();
  /** 每場對方公司 CRM 聯絡人名冊（姓名/職稱字串）快取：供 speaker 推斷 prompt，避免每段重查（§4.2）。 */
  private readonly contactRoster = new Map<string, string>();
  /** 每場對方公司 CRM 聯絡人清單（ContactSummary）快取：roster 與檢索白名單共用同一份讀（§4.2）。 */
  private readonly contactsCache = new Map<string, ContactSummary[]>();
  /** 每場檢索白名單 entityIds 快取（整場靜態，會前研究後才開會）：免每分析窗重跑 collectWhitelist 多筆讀（§4.2）。 */
  private readonly whitelist = new Map<string, string[]>();
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

  /**
   * Hub sink for the DynamicSlide supplement-slide bridge (extra internal seam). The hub wires this to
   * `patch.suggest(...)`, which enqueues the slide for presenter approval and broadcasts it to the HUD only (I3).
   * The slide is NEVER appended here — I2 (presenter approval) still gates every page.
   */
  onSuggestSlide(cb: (sessionId: string, slide: SlideSpec, reason: string) => void): void {
    this.suggestSlideCb = cb;
  }

  onTranscript(sessionId: string, seg: TranscriptSegment): void {
    const ctx = this.context.get(sessionId) ?? [];
    ctx.push(`[${seg.speaker}] ${seg.text}`);
    this.context.set(sessionId, ctx.slice(-TRANSCRIPT_CONTEXT_MAX));
  }

  onSignals(sessionId: string, items: SignalItem[]): void {
    const runtime = this.deps.getRuntime(sessionId);
    if (!runtime) return;

    // 1) CRM retrieval → info_card(s) for the HUD. Query folds in recent transcript points (§4.2); the
    //    per-session `seen` set dedups so a given CRM entity surfaces at most once per meeting.
    let seen = this.cardedEntities.get(sessionId);
    if (!seen) {
      seen = new Set();
      this.cardedEntities.set(sessionId, seen);
    }
    const contextText = (this.context.get(sessionId) ?? []).slice(-RETRIEVAL_CONTEXT_MAX).join("\n");
    const ctx: MeetingContext = {
      orgId: runtime.orgId,
      companyId: runtime.companyId,
      dealId: runtime.dealId,
      meetingId: sessionId,
      userId: runtime.presenterUserId,
    };
    // 白名單整場靜態 → per-session 快取 entityIds，免每個分析窗重跑 collectWhitelist 的多筆 org-scoped 讀。
    this.whitelistFor(sessionId, ctx)
      .then((entityIds) => retrieveInfoCards(this.retrieval, ctx, items, { contextText, seen, entityIds }))
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

    // 3) DynamicSlide 補充頁橋接（此前生產缺失）：實質訊號 → 生成一張補充頁 → patch.suggest（HUD 批准佇列）。
    //    節流＋每場配額 bound；I2 不變（只送建議，報告者手動批准才 append）。
    void this.maybeSuggestSlide(sessionId, items).catch((err) =>
      console.warn(`[copilot] supplement-slide error (meeting=${sessionId}): ${(err as Error).message}`),
    );
  }

  /**
   * DynamicSlide 對話→補充頁橋接。合格訊號（SUPPLEMENT_TRIGGER_KINDS）出現且通過節流＋配額時，用 Gemini 針對當下
   * 對話焦點生成「一張」補充頁，交給 suggestSlideCb（hub → patch.suggest → HUD 批准佇列）。
   * 只送「建議」——不 append、不動 committedIndex；I2（報告者批准）仍是唯一進 deck 的門。best-effort、bounded。
   */
  private async maybeSuggestSlide(sessionId: string, items: SignalItem[]): Promise<void> {
    if (!this.suggestSlideCb) return; // 未接線（測試/舊路徑）
    const limit = this.deps.supplementAutoLimitPerMeeting;
    if (!(limit > 0)) return; // 關閉
    if (!this.deps.gemini.isConfigured()) return;

    const runtime = this.deps.getRuntime(sessionId);
    if (!runtime) return;

    const triggers = items.filter((s) => SUPPLEMENT_TRIGGER_KINDS.has(s.kind));
    if (triggers.length === 0) return;

    // 配額（每場上限）＋節流（最小間隔），皆在觸發前檢查。
    if ((this.suggestCount.get(sessionId) ?? 0) >= limit) return;
    const now = Date.now();
    const throttleMs = this.deps.supplementThrottleMs ?? SUPPLEMENT_THROTTLE_MS;
    if (now - (this.lastSuggestAt.get(sessionId) ?? 0) < throttleMs) return;
    // 樂觀佔用節流窗，避免同時多個分析窗並發重複生成（成功才真正計入配額）。
    this.lastSuggestAt.set(sessionId, now);

    const transcriptContext = (this.context.get(sessionId) ?? []).slice(-SUPPLEMENT_CONTEXT_MAX).join("\n");
    const signalSummary = triggers.map((s) => `${s.label}（${s.kind}）`).join("；");
    const companyName = await this.companyName(sessionId);
    // anchor＝deck 目前最後一張，讓補充頁「繼承匯入 deck 的配色（theme）」——否則 theme=undefined → 前端退 app 深色，
    // 與淺色匯入簡報格格不入。best-effort：撈不到就不帶 anchor（渲染器退預設），不阻斷生成。
    const anchorSlide = await this.deckTailSlide(runtime.orgId, runtime.deckId);

    // 記帳（洞 A）：走 metered client，補充頁生成成本記為 gemini_text（歸屬 orgId＋meetingId＋presenter）。
    const gm = this.geminiFor(sessionId, "gemini_text", "supp");
    const slide = await withDeadline(
      generateSupplementSlide(gm, this.deps.inferenceModel, "zh-TW", {
        transcriptContext,
        signalSummary,
        companyName,
        anchorSlide,
      }),
      SUPPLEMENT_DEADLINE_MS,
      "copilot.supplementSlide",
    ).catch(() => null);
    if (!slide) return; // 生成失敗/空頁 → 不送建議（配額未計）

    this.suggestCount.set(sessionId, (this.suggestCount.get(sessionId) ?? 0) + 1);
    const reason = triggers[0]?.label ? `依對話補充：${triggers[0].label}`.slice(0, 80) : "依對話補充";
    this.suggestSlideCb(sessionId, slide, reason);
  }

  /**
   * 撈 deck 目前最後一張 slide 當補充頁的 anchor（供繼承 theme/配色）。deckId 缺、撈失敗、無 slide → undefined
   * （呼叫端不帶 anchor，渲染器退 app 預設）。唯讀、bounded、吞錯——絕不阻斷補充頁生成。
   */
  private async deckTailSlide(orgId: string, deckId: string | undefined): Promise<SlideSpec | undefined> {
    if (!deckId) return undefined;
    try {
      const dws = await this.deps.core.decks.findWithSlides(orgId, deckId);
      return dws?.slides.at(-1)?.spec;
    } catch {
      return undefined;
    }
  }

  /**
   * 現包一個「呼叫即記帳」的 metered Gemini client（歸屬 orgId＋meetingId＋presenter userId），供會中各 LLM 呼叫
   * （補充頁生成、說話者推斷）把成本記進 usage_events。無 meter / 無 runtime → 退回 raw client（行為完全不變）。
   * 注意：grounded 呼叫（triggerResearch）因 metered wrapper 對 grounded 透傳不計費，另在該處手動 meter。
   */
  private geminiFor(sessionId: string, kind: UsageKind, tag: string): GeminiClient {
    const runtime = this.deps.getRuntime(sessionId);
    if (!this.deps.meter || !runtime) return this.deps.gemini;
    return meteredGeminiClient(this.deps.gemini, this.deps.meter, {
      orgId: runtime.orgId,
      kind,
      meetingId: sessionId,
      userId: runtime.presenterUserId,
      idemPrefix: `${tag}:${sessionId}:${randomUUID()}`,
    });
  }

  /**
   * generateGrounded 記帳（metered wrapper 對 grounded 透傳、不計費，故此處手動 meter）。token 無精確值 → 字元數 /4 估。
   * 無 meter → 直接呼叫（不記帳，維持既有行為）。
   */
  private async groundedMetered(
    sessionId: string,
    orgId: string,
    userId: string,
    prompt: string,
  ): Promise<Awaited<ReturnType<GeminiClient["generateGrounded"]>>> {
    if (!this.deps.meter) return this.deps.gemini.generateGrounded({ prompt, model: this.deps.inferenceModel });
    return this.deps.meter.meter(
      orgId,
      "gemini_text",
      async () => {
        const g = await this.deps.gemini.generateGrounded({ prompt, model: this.deps.inferenceModel });
        return {
          result: g,
          model: this.deps.inferenceModel,
          inputTokens: Math.ceil(prompt.length / 4),
          outputTokens: Math.ceil((g.answer?.length ?? 0) / 4),
          meetingId: sessionId,
        };
      },
      `ground:${sessionId}:${randomUUID()}`,
      userId,
    );
  }

  /** 對方公司名稱（供補充頁 grounding）；無 company / 任何錯誤 → undefined。每場受配額（≤limit）約束，不另快取。 */
  private async companyName(sessionId: string): Promise<string | undefined> {
    const runtime = this.deps.getRuntime(sessionId);
    if (!runtime?.companyId) return undefined;
    try {
      const company = await this.deps.core.companies.findById(runtime.orgId, runtime.companyId);
      return company?.name;
    } catch {
      return undefined;
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
      const groundPrompt =
        `會議即時查詢：${query}\n` +
        (contextText ? `對話脈絡：\n${contextText}\n` : "") +
        "請用繁體中文簡短回答（要點式），並附上來源。";
      // 記帳（洞 C）：grounded 走手動 meter（歸屬 orgId＋meetingId＋presenter），記為 gemini_text。
      const grounded = await withDeadline(
        this.groundedMetered(sessionId, runtime.orgId, runtime.presenterUserId, groundPrompt),
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
   * diarization). Also produces an optional speakerLabel (§4.2): the meeting company's CRM contact roster
   * (name/title) is fed into the prompt so the model can name the specific person, or fall back to 客戶-A/B for
   * distinct-but-unnamed client speakers. Best-effort: unconfigured Gemini or any failure → { speaker:'unknown' }.
   * (Not in the frozen interface — the hub calls this before building the TranscriptSegment for onTranscript.)
   */
  async inferSpeaker(sessionId: string, text: string): Promise<SpeakerInference> {
    if (!this.deps.gemini.isConfigured()) return { speaker: "unknown" };
    const contextText = (this.context.get(sessionId) ?? []).slice(-SPEAKER_CONTEXT_MAX).join("\n");
    const roster = await this.contactsRoster(sessionId);
    // 記帳（洞 B）：說話者推斷走 metered client（每個 ASR final 段一次，量最大），記為 gemini_text。
    const gm = this.geminiFor(sessionId, "gemini_text", "spk");
    try {
      const out = await withDeadline(
        gm.generateJson<{ speaker?: TranscriptSpeaker; speakerLabel?: string }>({
          model: this.deps.inferenceModel,
          system:
            "你在判斷一句會議逐字稿是『報告者(presenter，銷售方)』還是『客戶(client)』說的。" +
            "依內容與語氣判斷；無法判斷時 speaker 回 unknown。" +
            "另可選填 speakerLabel 細分在場人物（雙方可能各不只一位）：" +
            "能對上下方 CRM 名單中的某人 → 用『客戶-姓名』或『客戶-職稱』；" +
            "對不上但明顯是不同客戶方發言者 → 用『客戶-A』『客戶-B』區分；報告者方 → 用『報告者』（多位時『報告者-A』）。" +
            "無把握就省略 speakerLabel。只輸出 schema JSON。",
          prompt:
            (roster ? `對方公司 CRM 聯絡人名單：${roster}\n\n` : "") +
            `對話脈絡：\n${contextText}\n\n這一句：${text}`,
          schema: SPEAKER_SCHEMA,
          maxOutputTokens: 96,
          attempts: 1,
        }),
        SPEAKER_DEADLINE_MS,
        "copilot.inferSpeaker",
      );
      const speaker: TranscriptSpeaker =
        out?.speaker === "presenter" || out?.speaker === "client" ? out.speaker : "unknown";
      const label = typeof out?.speakerLabel === "string" ? out.speakerLabel.trim() : "";
      // speakerLabel 只在能確定說話者身分時才有意義；unknown 或空字串一律省略（相容性：缺席＝舊行為）。
      if (speaker === "unknown" || !label) return { speaker };
      return { speaker, speakerLabel: label.slice(0, SPEAKER_LABEL_MAX) };
    } catch {
      return { speaker: "unknown" };
    }
  }

  /**
   * The meeting company's CRM contacts (ContactSummary), read once per session and cached. Contacts are researched
   * pre-meeting, so the roster/whitelist are static for the meeting; both consumers share this single read
   * (removes the duplicate contacts.list between the speaker roster and the retrieval whitelist).
   * Read-only, org-scoped (contacts.list enforces org isolation); [] when no company or on any error.
   */
  private async contactsFor(sessionId: string): Promise<ContactSummary[]> {
    const cached = this.contactsCache.get(sessionId);
    if (cached !== undefined) return cached;
    let contacts: ContactSummary[] = [];
    const runtime = this.deps.getRuntime(sessionId);
    if (runtime?.companyId) {
      try {
        contacts = await this.deps.core.contacts.list(runtime.orgId, runtime.companyId);
      } catch {
        /* contacts optional — degrade to empty (unlabeled inference / whitelist without contacts) */
      }
    }
    this.contactsCache.set(sessionId, contacts);
    return contacts;
  }

  /**
   * The meeting company's CRM contact roster as a compact "姓名（職稱）、…" string for the speaker prompt.
   * Derived from the per-session contacts cache (contactsFor). Empty string when no company or on any error.
   */
  private async contactsRoster(sessionId: string): Promise<string> {
    const cached = this.contactRoster.get(sessionId);
    if (cached !== undefined) return cached;
    const roster = (await this.contactsFor(sessionId))
      .slice(0, CONTACTS_ROSTER_MAX)
      .map((c) => (c.title ? `${c.fullName}（${c.title}）` : c.fullName))
      .join("、");
    this.contactRoster.set(sessionId, roster);
    return roster;
  }

  /**
   * The meeting's retrieval whitelist entityIds (company + contacts + notes + products + news + deal), cached
   * per session (§4.2): the whitelist is static once pre-meeting research is done, so we compute it once instead
   * of on every analysis window. Contacts reuse contactsFor's single read (no duplicate contacts.list).
   */
  private async whitelistFor(sessionId: string, ctx: MeetingContext): Promise<string[]> {
    const cached = this.whitelist.get(sessionId);
    if (cached !== undefined) return cached;
    const contacts = await this.contactsFor(sessionId);
    const ids = await collectWhitelist(this.deps.core, ctx, contacts.map((c) => c.id));
    this.whitelist.set(sessionId, ids);
    return ids;
  }

  /** Drop per-session state (called on session teardown). */
  disposeSession(sessionId: string): void {
    this.context.delete(sessionId);
    this.cardedEntities.delete(sessionId);
    this.contactRoster.delete(sessionId);
    this.contactsCache.delete(sessionId);
    this.whitelist.delete(sessionId);
    this.lastSuggestAt.delete(sessionId);
    this.suggestCount.delete(sessionId);
  }
}
