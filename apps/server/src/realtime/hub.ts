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
import type {
  ChecklistCoverSource,
  ChecklistItem,
  ServerMessage,
  SignalItem,
  TranscriptSegment,
  WsRole,
} from "@meetcopilot/shared";
import { CHECKLIST_PROMPT_MAX_PENDING, SLIDE_DWELL_COVER_MS, compareChecklistOrder, redactPii } from "@meetcopilot/shared";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { GeminiClient } from "../gemini.js";
import type { Meter } from "../ops/meter.js";
import { GeminiAsrProvider } from "../asr/gemini-asr.js";
import { RollingWindowAnalysisEngine } from "../analysis/gemini-analysis.js";
import type { AnalysisResult } from "../analysis/analysis-engine.js";
import type { AsrSegment } from "../asr/asr-provider.js";
import { LiveSessionRuntime } from "./session-runtime.js";
import { CrmCopilotOrchestrator } from "./orchestrator.js";
import { LivePatchService } from "./patch-service.js";
import { MeetingStore } from "./meeting-store.js";
import { routeTranscriptSegment } from "./transcript-privacy.js";
import { runWithMetering } from "../ops/metering-context.js";
import { meteredGeminiClient } from "../ops/metered-gemini.js";
import { gatherChecklistContext, generateChecklist } from "../generation/checklist-gen.js";
import type { BroadcastSink, BroadcastTarget, ConnMeta } from "./types.js";

/** Binding captured at meeting creation, consumed when the runtime is first materialized. */
export interface MeetingBinding {
  orgId: string;
  presenterUserId: string;
  companyId?: string;
  dealId?: string;
  deckId?: string;
  /** 023：本場會議目標（自由文字一句話），供待講清單生成（MEETING_CHECKLIST_CONTRACT §6.3）。 */
  objective?: string;
}

/** 待講清單生成狀態（＝wire `checklist.status`）。Map 中沒有這場＝本場沒有 checklist。 */
type ChecklistPhase = "generating" | "ready" | "failed";

interface Conn {
  ws: WebSocket;
  meta: ConnMeta;
}

/** Idle grace period after the last socket drops before a session is reclaimed (reconnect cancels it). */
const DISCONNECT_GRACE_MS = 5 * 60_000;

/** 待講清單 snapshot 廣播的 debounce（契約 §7.4：同一秒內多次改變合併為一次廣播）。 */
const CHECKLIST_BROADCAST_DEBOUNCE_MS = 300;

export class RealtimeHub implements BroadcastSink {
  readonly store: MeetingStore;
  readonly patch: LivePatchService;
  private readonly orchestrator: CrmCopilotOrchestrator;

  private readonly rooms = new Map<string, Set<Conn>>();
  private readonly sessions = new Map<string, LiveSessionRuntime>();
  private readonly bindings = new Map<string, MeetingBinding>();
  private readonly graceTimers = new Map<string, NodeJS.Timeout>();
  /** 023：每場待講清單的生成階段（**同時是「每場只生成一次」的守門」**；契約 §6.3）。 */
  private readonly checklistPhase = new Map<string, ChecklistPhase>();
  /** 023：每場 snapshot 廣播的 debounce timer（契約 §7.4）。 */
  private readonly checklistTimers = new Map<string, NodeJS.Timeout>();

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
      supplementAutoLimitPerMeeting: config.supplementAutoLimitPerMeeting,
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
    // DynamicSlide 補充頁橋接：對話→補充頁生成後進 patch.suggest（HUD 批准佇列，I3：只到 hud）。
    // I2 不變——suggest 只入列，報告者手動 ACCEPT 才 append（patch.act）。
    this.orchestrator.onSuggestSlide((sid, slide, reason) => this.patch.suggest(sid, slide, reason));
  }

  /** Called by POST /api/meetings (same process) to record the live binding for lazy runtime creation. */
  registerMeeting(meetingId: string, binding: MeetingBinding): void {
    this.bindings.set(meetingId, binding);
  }

  /**
   * 023 §6.1：待講清單／目標草擬共用的生成依賴（同一個 Gemini client＋抽取層模型，不另建 client）。
   * 供 meetings-routes 的 `POST /api/meetings/draft-objective` 使用。
   *
   * 計費歸屬（ADMIN_CONTRACT §3「記帳補洞」／CHANGE_TRACKER「LLM 呼叫必記帳」）：**必須傳 orgId**，
   * 有 meter 時包 metered client（與 runChecklistGeneration 同一套機制／同 kind='gemini_text'）。
   * 這是使用者可反覆觸發的 LLM 端點，故 `idemPrefix` 帶 **per-call uuid**（不像清單生成每場只跑一次可用
   * `checklist:${meetingId}`）——否則同 org 的第 2 次以後草擬會被冪等鍵去重而完全不計費。
   * `meetingId` 刻意省略：草擬發生在建會**之前**，此時還沒有 meeting 可歸屬。
   */
  checklistGenDeps(orgId: string, userId?: string): { gemini: GeminiClient; model: string } {
    return this.checklistDeps({ orgId, userId, idemPrefix: `objective:${randomUUID()}` });
  }

  /**
   * 清單生成／目標草擬共用的 Gemini 依賴組裝（**單一建構點**）：有 meter 時包 metered client
   *（kind='gemini_text'）、無 meter 時裸 client fallback；模型固定 config.gemini.extractModel。
   * kind／userId／fallback 規則兩個呼叫點必須永遠一致（少包一邊＝記帳漏洞），故收攏在此；
   * `idemPrefix`／`meetingId` 的取值理由屬呼叫點脈絡，註解留在各呼叫點。
   */
  private checklistDeps(o: {
    orgId: string;
    userId?: string;
    meetingId?: string;
    idemPrefix: string;
  }): { gemini: GeminiClient; model: string } {
    return {
      gemini: this.meter
        ? meteredGeminiClient(this.gemini, this.meter, {
            orgId: o.orgId,
            kind: "gemini_text",
            userId: o.userId,
            meetingId: o.meetingId,
            idemPrefix: o.idemPrefix,
          })
        : this.gemini,
      model: this.config.gemini.extractModel,
    };
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
      // 023：HUD 一連上就補一份全量 checklist snapshot（replace 語意 → 斷線重連自我修復，契約 §5）。
      // I3：**只送給這條 hud 連線**，present/capture 永遠收不到。
      if (meta.role === "hud") void this.sendChecklistSnapshot(meta, ws);
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
    // 023：沒有 live runtime 的場次也可能留著 checklist debounce timer（生成期就斷線）→ 一併清掉。
    for (const timer of this.checklistTimers.values()) clearTimeout(timer);
    this.checklistTimers.clear();
    this.checklistPhase.clear();
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
    // 023 bounded teardown（L13）：清掉 checklist 的 debounce timer 與階段狀態（清單本體已在 DB）。
    const checklistTimer = this.checklistTimers.get(meetingId);
    if (checklistTimer) {
      clearTimeout(checklistTimer);
      this.checklistTimers.delete(meetingId);
    }
    this.checklistPhase.delete(meetingId);
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
    // 019 安全網：包進計費脈絡，未經 wrapper 的 raw 會中 AI 呼叫也會被補記（歸屬 orgId＋meetingId＋presenter）。
    asr.onFinal((seg) => this.runMeteredForMeeting(runtime, () => void this.onAsrFinal(runtime, seg)));
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
    // 023：第二參數帶 coveredItemIds（對話勾稽，零額外 LLM 呼叫）。
    engine.onSignals((items, result) =>
      this.runMeteredForMeeting(runtime, () => this.onSignals(runtime, items, result)),
    );

    this.sessions.set(meta.meetingId, runtime);
    // 023：把本場 pending 待講項目注入分析引擎（重連也會重注；沒有清單＝注入空陣列＝prompt 不變）。
    void this.refreshPendingChecklist(runtime);
    return runtime;
  }

  /**
   * 019 安全網：把會中 AI 處理（speaker 推斷 / 分析→orchestrator 檢索·研究·補充頁）包進計費脈絡，
   * 未經 metered wrapper 的 raw AI 呼叫也會被 gemini 安全網補記（歸屬 orgId＋meetingId＋presenter）。
   * 無 meter → 直接跑（行為不變）。fn 同步啟動的 fire-and-forget async 會繼承此脈絡。
   */
  private runMeteredForMeeting(runtime: LiveSessionRuntime, fn: () => void): void {
    if (!this.meter) {
      fn();
      return;
    }
    runWithMetering(
      {
        orgId: runtime.orgId,
        userId: runtime.presenterUserId,
        meetingId: runtime.meetingId,
        kind: "gemini_text",
        meter: this.meter,
        idemPrefix: `mtg:${runtime.meetingId}:${randomUUID()}`,
      },
      fn,
    );
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
    // speakerLabel (§4.2) is optional; when absent the segment carries only the frozen speaker enum (back-compat).
    const { speaker, speakerLabel } = await this.orchestrator.inferSpeaker(runtime.meetingId, redactedText);
    // Re-check: consent may have been revoked during the async speaker inference above.
    if (!runtime.consent) return;
    const ts: TranscriptSegment = { id: randomUUID(), t: seg.t, speaker, speakerLabel, text: seg.text, final: true };

    const route = routeTranscriptSegment({
      consent: runtime.consent,
      persistTranscript: runtime.persistTranscript,
      segment: ts,
    });
    // I3: raw transcript only to the presenter's private HUD (account B, isolated).
    if (route.hud) this.broadcast(runtime.meetingId, { type: "transcript", segment: route.hud }, "hud");
    // Ephemeral-by-default: persist (redacted) only when the meeting opted in.
    if (route.persist) this.store.saveSegment(runtime.orgId, runtime.meetingId, route.persist).catch(() => {});
    // 023 勾稽 evidence 來源：**刻意只取 route.persist**（已 redact 且本場已同意持久化的文字）——
    // checklist.evidence 會落庫，若在 persistTranscript=false 的場次寫入逐字內容就違反 M5 §A ephemeral-by-default。
    // 未同意持久化 → 恆 undefined → evidence 留 NULL（HUD 仍看得到「已講」，只是沒有引文）。
    runtime.lastEvidenceText = route.persist?.text;
    if (route.contextSegment) this.orchestrator.onTranscript(runtime.meetingId, route.contextSegment);
    if (route.analysisText != null) runtime.engine.ingest(runtime.meetingId, { ...seg, text: route.analysisText });
  }

  private onSignals(runtime: LiveSessionRuntime, items: SignalItem[], result?: AnalysisResult): void {
    // 023：signals 可能為空而只有勾稽命中 → 空陣列不廣播/不落庫/不進 orchestrator（維持原行為）。
    if (items.length > 0) {
      this.broadcast(runtime.meetingId, { type: "signals", items }, "hud"); // I3: hud only
      for (const it of items) this.store.saveSignal(runtime.orgId, runtime.meetingId, it).catch(() => {});
      this.orchestrator.onSignals(runtime.meetingId, items);
    }
    // 023 對話勾稽（契約 §7.1）：id 已在 engine sanitize 過（必在 pending 集合內）。
    const covered = result?.coveredItemIds ?? [];
    if (covered.length > 0) void this.coverChecklist(runtime, covered, "transcript", runtime.lastEvidenceText);
  }

  // ── 023 會中待講清單（MEETING_CHECKLIST_CONTRACT §6/§7）────────────────
  // I1：本段完全不觸及 deck patch 路徑——沒有 PatchOp、沒有 appendSlide/updateSlide。
  // I3：**每一條 checklist 訊息都走 broadcast(..., "hud")**（或直接送單一 hud socket），絕不 "all"/"present"。

  /**
   * 建會成功後由 POST /api/meetings 觸發的背景生成（契約 §6.3；fire-and-forget，**絕不讓建會請求失敗**）。
   * 先廣播 `generating` → 生成＋replaceAll → 廣播 `ready`；任何失敗 → 廣播 `failed`。
   * 缺 deckId **且** 缺 companyId → 直接 return（本場無 checklist，不生成不廣播）。
   * 每場只跑一次（checklistPhase 已有這場即 return）。
   */
  startChecklistGeneration(meetingId: string): void {
    const binding = this.bindings.get(meetingId);
    if (!binding) return;
    if (!binding.deckId && !binding.companyId) return; // 資料完全不足 → 本場沒有待講清單
    if (this.checklistPhase.has(meetingId)) return; // 每場只生成一次（重連不重生）
    this.checklistPhase.set(meetingId, "generating");
    this.broadcastChecklist(meetingId, "generating", []);
    void this.runChecklistGeneration(meetingId, binding);
  }

  private async runChecklistGeneration(meetingId: string, binding: MeetingBinding): Promise<void> {
    try {
      const ctx = await gatherChecklistContext(this.core, binding.orgId, {
        deckId: binding.deckId,
        companyId: binding.companyId,
        dealId: binding.dealId,
      });
      const items = await generateChecklist(
        // 計費歸屬（ADMIN_CONTRACT §3.3）：有 meter 時走 metered client（gemini_text，歸屬 org＋meeting）。
        // **必帶 userId**（＝建會者/報告者）：meter.meter 的 userId 只在「背景 job 無 request 脈絡」時才可
        // 省略，而這裡的脈絡就在手上（binding.presenterUserId 由 POST /api/meetings 的 JWT 帶入）。少了它，
        // admin 後台 usage/events 會把「同一次建會」中**更貴的那個** LLM 呼叫掛在「未知使用者」下。
        // idemPrefix＝`checklist:${meetingId}`：清單生成每場只跑一次，冪等鍵天然唯一（不像目標草擬要 per-call uuid）。
        this.checklistDeps({
          orgId: binding.orgId,
          userId: binding.presenterUserId,
          meetingId,
          idemPrefix: `checklist:${meetingId}`,
        }),
        { objective: binding.objective ?? "", ...ctx },
      );
      const stored = await this.core.checklist.replaceAll(binding.orgId, meetingId, items);
      this.checklistPhase.set(meetingId, "ready");
      // replaceAll 已回傳「落庫後依 idx 排序」的結果（ports.ts）→ 直接廣播，省掉 broadcastChecklistSnapshot
      // 的重複全量 SELECT。phase 剛設成 ready，與 snapshot 路徑的 `?? "ready"` 分支等價；內容、順序、hud-only 目標相同。
      this.broadcastChecklist(meetingId, "ready", stored);
      const runtime = this.sessions.get(meetingId);
      if (runtime) await this.refreshPendingChecklist(runtime);
    } catch (err) {
      // 優雅降級（契約 §6.2）：HUD 顯示「清單生成失敗」，會議照常進行。
      console.warn(`[checklist] generation failed (meeting=${meetingId}): ${(err as Error).message}`);
      this.checklistPhase.set(meetingId, "failed");
      this.broadcastChecklist(meetingId, "failed", []);
    }
  }

  /**
   * 批次劃掉（自動路徑：transcript／slide）。repo 只動 pending 且回「真的被改動」的項目，
   * 空陣列＝沒有新變化 → **不廣播**（契約 §7.4）。
   *
   * 023 §7.5：`by === 'transcript'` 時先濾掉仍在「手動 uncheck 冷卻期」內的 itemId——那段害它被誤判的
   * 逐字稿還在分析滾動窗裡（冷卻長度＝窗的最大年齡），不濾掉的話 5 秒後又會被同一段話劃掉，
   * 使 uncheck 實質無效。`'slide'`（報告者導覽）與手動 `check` 一律**不受**冷卻限制。
   *
   * v1.2：比對用的是**音訊時鐘**高水位（`runtime.audioClockMs()`＝分析窗內最新一段的 t），不是 `Date.now()`。
   * 整批只讀一次時鐘，讓同一輪分析的所有 id 拿同一個基準判齡。取不到 → runtime 那側 fail-safe 成「仍在冷卻」。
   */
  private async coverChecklist(
    runtime: LiveSessionRuntime,
    itemIds: string[],
    by: ChecklistCoverSource,
    evidence?: string,
  ): Promise<void> {
    const audioT = runtime.audioClockMs();
    const targets =
      by === "transcript" ? itemIds.filter((id) => !runtime.isUncheckCooling(id, audioT)) : itemIds;
    if (targets.length === 0) return; // 全部都在冷卻期（或本來就是空） → 什麼都不做、不廣播
    try {
      const changed = await this.core.checklist.markCovered(runtime.orgId, runtime.meetingId, targets, by, evidence);
      if (changed.length === 0) return; // 無改變不廣播
      this.scheduleChecklistBroadcast(runtime.meetingId, runtime.orgId);
      await this.refreshPendingChecklist(runtime);
    } catch (err) {
      console.warn(`[checklist] markCovered failed (meeting=${runtime.meetingId}): ${(err as Error).message}`);
    }
  }

  /**
   * 翻頁勾稽（契約 §7.2，零 LLM）。ws-server 在既有 I2 gate 內、committedIndex 前進**之前**呼叫。
   * 前一頁停留 ≥ SLIDE_DWELL_COVER_MS 才把「綁前一頁且仍 pending」的項目劃掉；不足＝快速翻過，不動作。
   * 本方法同時推進 `lastCommitAt`（單一擁有者，避免 ws-server 與 hub 各記一份）。
   */
  onPageCommitted(runtime: LiveSessionRuntime, prevIndex: number): void {
    const last = runtime.lastCommitAt;
    const now = Date.now();
    runtime.lastCommitAt = now;
    if (last == null || prevIndex < 0) return; // 本場第一次翻頁／還沒播過任何頁 → 無停留可算
    if (now - last < SLIDE_DWELL_COVER_MS) return; // 停留不足 20 秒＝翻過去而已，不算講到
    void (async () => {
      const items = await this.core.checklist.list(runtime.orgId, runtime.meetingId);
      const ids = items.filter((it) => it.status === "pending" && it.slideIdx === prevIndex).map((it) => it.id);
      if (ids.length === 0) return;
      await this.coverChecklist(runtime, ids, "slide", `第 ${prevIndex + 1} 頁`);
    })().catch((err) =>
      console.warn(`[checklist] slide-dwell cover failed (meeting=${runtime.meetingId}): ${(err as Error).message}`),
    );
  }

  /**
   * 手動改狀態（契約 §5/§7.3）。**presenter 身分閘在 ws-server（I2）**，這裡只執行；
   * orgId 一律來自已驗證的 wsToken（絕不從 payload），跨 org／不存在 → repo 回 null → 零副作用、不廣播。
   *
   * 023 §7.5：`uncheck` 成功後**一併記入冷卻期**（`runtime.noteUnchecked` 記下當下的**音訊時鐘**高水位，
   * 不是牆鐘），讓接下來一個分析窗週期（以音訊時鐘計）內的 transcript 自動 cover 跳過該項——
   * 否則報告者的修正會在 5 秒後被同一段逐字稿推翻（打地鼠）。
   * 刻意在 `updated` 非 null（＝確實屬於本 org＋本場）之後才記，跨 org 的呼叫不得污染 runtime 狀態。
   */
  checklistAction(orgId: string, meetingId: string, itemId: string, action: "check" | "uncheck" | "skip"): void {
    const status = action === "check" ? "covered" : action === "uncheck" ? "pending" : "skipped";
    void (async () => {
      const updated = await this.core.checklist.setStatus(
        orgId,
        meetingId,
        itemId,
        status,
        action === "check" ? "manual" : undefined,
      );
      if (!updated) return;
      const runtime = this.sessions.get(meetingId);
      if (action === "uncheck" && runtime && runtime.orgId === orgId) runtime.noteUnchecked(itemId);
      this.scheduleChecklistBroadcast(meetingId, orgId);
      if (runtime) await this.refreshPendingChecklist(runtime);
    })().catch((err) =>
      console.warn(`[checklist] action failed (meeting=${meetingId}, action=${action}): ${(err as Error).message}`),
    );
  }

  /**
   * 把本場 pending 項目注入分析引擎（契約 §7.1）：**must 優先、再依 idx**，上限
   * CHECKLIST_PROMPT_MAX_PENDING。沒有清單→注入空陣列＝prompt 完全不加該節（零額外 token）。
   */
  private async refreshPendingChecklist(runtime: LiveSessionRuntime): Promise<void> {
    const setPending = runtime.engine.setPendingChecklist;
    if (typeof setPending !== "function") return; // 精簡/測試用 engine 未實作 → 略過
    try {
      const items = await this.core.checklist.list(runtime.orgId, runtime.meetingId);
      const pending = items
        .filter((it) => it.status === "pending")
        .sort(compareChecklistOrder)
        .slice(0, CHECKLIST_PROMPT_MAX_PENDING)
        .map((it) => ({ id: it.id, title: it.title, keywords: it.keywords }));
      setPending.call(runtime.engine, pending);
    } catch (err) {
      console.warn(`[checklist] pending sync failed (meeting=${runtime.meetingId}): ${(err as Error).message}`);
    }
  }

  /** 300ms debounce 的全量 snapshot 廣播（契約 §7.4：同一秒內多次改變合併為一次）。 */
  private scheduleChecklistBroadcast(meetingId: string, orgId: string): void {
    if (this.checklistTimers.has(meetingId)) return; // 已排程 → 合併
    const timer = setTimeout(() => {
      this.checklistTimers.delete(meetingId);
      void this.broadcastChecklistSnapshot(meetingId, orgId);
    }, CHECKLIST_BROADCAST_DEBOUNCE_MS);
    if (typeof timer.unref === "function") timer.unref();
    this.checklistTimers.set(meetingId, timer);
  }

  /** 讀 DB 後廣播全量 snapshot（hud-only）。 */
  private async broadcastChecklistSnapshot(meetingId: string, orgId: string): Promise<void> {
    try {
      const items = await this.core.checklist.list(orgId, meetingId);
      this.broadcastChecklist(meetingId, this.checklistPhase.get(meetingId) ?? "ready", items);
    } catch (err) {
      console.warn(`[checklist] snapshot broadcast failed (meeting=${meetingId}): ${(err as Error).message}`);
    }
  }

  /** I3 單一出口：checklist 訊息**只**送 hud（禁 "all"／"present"）。 */
  private broadcastChecklist(meetingId: string, status: ChecklistPhase, items: ChecklistItem[]): void {
    this.broadcast(meetingId, this.checklistMessage(meetingId, status, items), "hud");
  }

  /** 契約 §5 checklist 訊息的**單一建構點**（廣播與單 socket 補發共用；形狀改動只准改這裡，不得漂移）。 */
  private checklistMessage(meetingId: string, status: ChecklistPhase, items: ChecklistItem[]): ServerMessage {
    return { type: "checklist", status, items, currentSlideIdx: this.currentSlideIdx(meetingId) };
  }

  /** HUD「正在講」高亮用的簡報高水位；尚未播過任何頁（-1）→ 省略該欄。 */
  private currentSlideIdx(meetingId: string): number | undefined {
    const idx = this.sessions.get(meetingId)?.committedIndex;
    return idx != null && idx >= 0 ? idx : undefined;
  }

  /**
   * 新 hud 連線的補發 snapshot（replace 語意 → 斷線重連自我修復）。
   * 本場沒有 checklist（無生成階段且 DB 無資料）→ 什麼都不送（HUD 不顯示面板）。
   */
  private async sendChecklistSnapshot(meta: ConnMeta, ws: WebSocket): Promise<void> {
    try {
      const phase = this.checklistPhase.get(meta.meetingId);
      // generating 期間依契約 items 必為空陣列。
      const items = phase === "generating" ? [] : await this.core.checklist.list(meta.orgId, meta.meetingId);
      if (!phase && items.length === 0) return;
      // I3：單 socket 補發（**只送這條 hud 連線**，不得改走 broadcast）；訊息形狀與廣播共用同一建構點。
      const msg = this.checklistMessage(meta.meetingId, phase ?? "ready", items);
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    } catch (err) {
      console.warn(`[checklist] snapshot send failed (meeting=${meta.meetingId}): ${(err as Error).message}`);
    }
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
