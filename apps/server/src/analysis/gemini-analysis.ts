/**
 * RollingWindowAnalysisEngine — implements the frozen AnalysisEngine seam (analysis/analysis-engine.ts).
 * Borrowed from v1 analysis/engine.ts, rewritten to emit v2's frozen SignalItem[] (shared/signals.ts) directly.
 *
 * Instance-per-session (the frozen onSignals callback carries no sessionId). Maintains a rolling window
 * (last N segments / M seconds), throttles Gemini calls, and emits only signals above a confidence floor.
 * Async callbacks never tear down the process (index.ts installs an unhandledRejection guard); the analysis
 * call is bounded (L13) and uses the 3.5-flash tier (not lite) for reliable structured extraction (L15).
 */
import { randomUUID } from "node:crypto";
import { Type } from "@google/genai";
import { SIGNAL_KINDS, type SignalItem, type SignalKind } from "@meetcopilot/shared";
import type { GeminiClient } from "../gemini.js";
import type { AnalysisEngine } from "./analysis-engine.js";
import type { AsrSegment } from "../asr/asr-provider.js";
import type { Meter } from "../ops/meter.js";
import { meteredGeminiClient } from "../ops/metered-gemini.js";
import { clamp01, withDeadline } from "../realtime/util.js";

const WINDOW_MAX_SEGMENTS = 10;
const WINDOW_MAX_AGE_MS = 90_000;
const ANALYSIS_THROTTLE_MS = 5_000;
const ANALYSIS_DEADLINE_MS = 15_000;
const MAX_OUTPUT_TOKENS = 1024;
/** Only surface signals the model is at least this confident about (noise floor). */
const SIGNALS_MIN_CONFIDENCE = 0.5;

/** union-superset + required (L15): the model must return a `signals` array of typed items. */
const SIGNALS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    signals: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          kind: { type: Type.STRING, enum: [...SIGNAL_KINDS] },
          label: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
        },
        required: ["kind", "label", "confidence"],
      },
    },
  },
  required: ["signals"],
};

interface RawSignals {
  signals?: { kind?: unknown; label?: unknown; confidence?: unknown }[];
}

/** A minimal timed segment for the rolling window (speaker is inferred elsewhere; analysis is speaker-agnostic). */
interface WindowSeg {
  t: number;
  text: string;
}

/**
 * 計費歸屬（ADMIN_CONTRACT §3.3）。有 meter+orgId 時，analysis 的 gemini_text 呼叫改走 metered client
 * （kind=gemini_text、歸屬 meetingId=sessionId）。realtime hub 於建構本 engine 時可傳入
 * `{ meter, orgId }` 啟用；不傳則沿用未計費行為（會中分析成本不進帳，同今日）。
 */
export interface AnalysisMetering {
  meter: Meter;
  orgId: string;
}

export class RollingWindowAnalysisEngine implements AnalysisEngine {
  private window: WindowSeg[] = [];
  private lastAnalysisAt = 0;
  private analyzing = false;
  private signalsCb: ((items: SignalItem[]) => void) | null = null;
  /** 實際發話的 client：有 metering 則為 per-session metered wrapper，否則原 client（透傳）。 */
  private readonly client: GeminiClient;

  constructor(
    private readonly gemini: GeminiClient,
    private readonly model: string,
    private readonly sessionId: string,
    metering?: AnalysisMetering,
  ) {
    this.client = metering
      ? meteredGeminiClient(gemini, metering.meter, {
          orgId: metering.orgId,
          kind: "gemini_text",
          meetingId: sessionId,
          idemPrefix: `analysis:${sessionId}`,
        })
      : gemini;
  }

  onSignals(cb: (items: SignalItem[]) => void): void {
    this.signalsCb = cb;
  }

  ingest(_sessionId: string, seg: AsrSegment): void {
    this.window.push({ t: seg.t, text: seg.text });
    this.trimWindow();
    void this.maybeAnalyze();
  }

  private trimWindow(): void {
    const latestT = this.window[this.window.length - 1]?.t ?? 0;
    this.window = this.window.slice(-WINDOW_MAX_SEGMENTS).filter((s) => latestT - s.t <= WINDOW_MAX_AGE_MS);
  }

  private async maybeAnalyze(): Promise<void> {
    const now = Date.now();
    if (this.analyzing || now - this.lastAnalysisAt < ANALYSIS_THROTTLE_MS) return;
    if (!this.gemini.isConfigured() || !this.signalsCb) return;

    this.analyzing = true;
    this.lastAnalysisAt = now;
    try {
      const items = await this.runAnalysis();
      if (items.length === 0) return;
      try {
        this.signalsCb(items);
      } catch (err) {
        console.error(`[analysis] onSignals callback threw (session=${this.sessionId}):`, err);
      }
    } finally {
      this.analyzing = false;
    }
  }

  private async runAnalysis(): Promise<SignalItem[]> {
    const transcript = this.window.map((s) => s.text).join("\n");
    if (!transcript.trim()) return [];
    try {
      const raw = await withDeadline(
        this.client.generateJson<RawSignals>({
          model: this.model,
          system:
            "你是 B2B 銷售會議的即時分析引擎。依最近逐字稿，抽出對報告者有用的商機訊號。" +
            "kind 只能是列舉值之一；confidence 是你對該訊號的信心（0~1）；label 用該訊號的簡短中文描述。" +
            "沒有明確訊號就回空陣列，不要硬湊。",
          prompt: `最近逐字稿（時間先後）：\n${transcript}\n請輸出符合 schema 的 JSON。`,
          schema: SIGNALS_SCHEMA,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          attempts: 2,
        }),
        ANALYSIS_DEADLINE_MS,
        "analysis.generateJson",
      );
      return this.sanitize(raw);
    } catch (err) {
      console.warn(`[analysis] generateJson failed (session=${this.sessionId}): ${(err as Error).message}`);
      return [];
    }
  }

  private sanitize(raw: RawSignals): SignalItem[] {
    const rows = Array.isArray(raw?.signals) ? raw.signals : [];
    const out: SignalItem[] = [];
    for (const r of rows) {
      const kind = r?.kind as SignalKind;
      if (!SIGNAL_KINDS.includes(kind)) continue;
      const label = typeof r?.label === "string" ? r.label.trim() : "";
      if (!label) continue;
      const confidence = clamp01(r?.confidence);
      if (confidence < SIGNALS_MIN_CONFIDENCE) continue;
      out.push({ id: randomUUID(), kind, label, confidence });
    }
    return out;
  }
}
