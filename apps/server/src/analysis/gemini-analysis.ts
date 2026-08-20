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
import {
  CHECKLIST_PROMPT_MAX_PENDING,
  SIGNAL_KINDS,
  type SignalItem,
  type SignalKind,
  type TranscriptSpeaker,
} from "@meetcopilot/shared";
import type { GeminiClient } from "../gemini.js";
import type { AnalysisEngine, AnalysisResult, PendingChecklistHint } from "./analysis-engine.js";
import type { AsrSegment } from "../asr/asr-provider.js";
import type { Meter } from "../ops/meter.js";
import { meteredGeminiClient } from "../ops/metered-gemini.js";
import { clamp01, withDeadline } from "../realtime/util.js";

/**
 * 滾動窗攜進 prompt 的**逐字稿字元**預算（`sum(text.length)`，不含說話者前綴與換行）。
 *
 * **為什麼是字元不是段數**：段數上限的唯一職責就是「限制 prompt 大小」——牆上時長已經由
 * `WINDOW_MAX_AGE_MS`（90s）管住了。而「一段」在兩種擷取模式下不是同一個量：雙聲道（API_CONTRACT §6
 * `channels=2`）時**兩條 ASR 軌各自產生 final 段**，同一段會議時間的 `ingest` 頻率直接翻倍，段數上限一半
 * 就被右軌吃掉。先前為了補償 stereo 把段數上限從 10 翻倍成 20，但常數不分模式 → **mono 場次的 prompt
 * 逐字稿也跟著翻倍**（≤40 秒→≤80 秒），而 mono 正是麥克風被拒時的 fallback 路徑（`audio-capture.ts` 註記
 * 「denial is common — so this path carries the WHOLE meeting」），等於整場付雙倍 token。
 * 改成字元預算之後，這個上限直接約束「prompt 到底多大」，**mono 與 stereo 收斂到同一個成本**，
 * 不必也不能把聲道數傳進 engine（`ensureRuntime` 建構本 engine 時右軌還不存在，是中途才 lazily 建的）。
 *
 * **300 怎麼來的**：基準線取**改動前的 mono 行為**＝10 段 × 段長上限 4 秒 ＝ 最多 40 秒逐字稿。
 * 繁中口語約 4–5 字/秒 → 40 秒 ≈ 160–200 字（這已是天花板：靜音切段規則讓實際段落多半不到 4 秒），
 * 中英夾雜時字元密度更高，取 300 作為預算 → mono 在最壓迫的情況下仍不比舊行為少看到東西，
 * 而繁中場次實際上仍由 `WINDOW_MAX_AGE_MS` 主宰（90 秒 ≈ 360–450 字 > 300 時才由字元預算封頂）。
 * 相對「20 段」版本（繁中 ≈ 400 字）是實打實的降幅，且不再隨聲道數浮動。
 *
 * 副作用（刻意）：短段落現在能多留幾段——舊制 10 段可能只涵蓋 10 秒，字元預算讓窗涵蓋的對話量穩定得多，
 * 而成本上限不變。
 */
const WINDOW_MAX_CHARS = 300;
/**
 * 滾動窗裡一段逐字稿最久能存活的時間。**export 是刻意的單一真相**：023 §7.5 的「手動 uncheck 冷卻期」
 * 長度必須等於這個值（那正是「害某項被誤判的那段逐字稿」最久能留在窗裡的時間），
 * 由 `realtime/session-runtime.ts` 的 `UNCHECK_COOLDOWN_MS` 直接引用——**不要在第二處另寫一個 90000**。
 *
 * ⚠️ **時鐘域**：這個年齡是拿 `seg.t`（音訊取樣時鐘，只在 PCM frame 進來時前進）相減算的，**不是牆鐘**。
 * 任何要對齊窗輪替的計時都得同域，用 `latestWindowT()` 取高水位（見 §7.5 v1.2）。
 */
export const WINDOW_MAX_AGE_MS = 90_000;
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
    // 023 待講清單對話勾稽（契約 §7.1）：本輪明確涵蓋的項目 id。**不在 required**——pending 為空時
    // prompt 完全不提這件事，模型自然省略該欄（零額外成本）。
    coveredItemIds: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["signals"],
};

/** 模型輸出邊界的原始形狀（未消毒）。export 供 sanitize 單測直接驅動。 */
export interface RawSignals {
  signals?: { kind?: unknown; label?: unknown; confidence?: unknown }[];
  coveredItemIds?: unknown;
}

/**
 * A minimal timed segment for the rolling window. `speaker` is decided upstream (stereo：由聲道確定；
 * mono：LLM 推斷，可能 `unknown`），這裡只負責把它渲染成 prompt 前綴——**沒有/unknown 就不加前綴**。
 */
interface WindowSeg {
  t: number;
  text: string;
  speaker?: TranscriptSpeaker;
}

/** 逐字稿在 prompt 裡的說話者前綴（繁中，與本檔其餘 prompt 同語言）。unknown／缺席 → 不加前綴。 */
function windowLine(s: WindowSeg): string {
  if (s.speaker === "presenter") return `報告者：${s.text}`;
  if (s.speaker === "client") return `客戶：${s.text}`;
  // unknown：**刻意輸出裸文字**而不是「未知：」——後者會讓模型以為「未知」是第三個在場角色。
  return s.text;
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
  private signalsCb: ((items: SignalItem[], result: AnalysisResult) => void) | null = null;
  /** 023：本場 pending 待講項目（空＝prompt 不加該節）。由 hub 每輪注入，已排序＋上限。 */
  private pendingChecklist: PendingChecklistHint[] = [];
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

  onSignals(cb: (items: SignalItem[], result: AnalysisResult) => void): void {
    this.signalsCb = cb;
  }

  /**
   * 023（契約 §7.1）：注入 pending 待講項目。呼叫端（hub）已按「must 優先、再依 idx」排序；
   * 這裡再防禦性截 CHECKLIST_PROMPT_MAX_PENDING 條，並濾掉沒有 id/title 的爛資料。
   * 空陣列 → prompt 完全不加勾稽那一節（零額外 token；契約明文）。
   */
  setPendingChecklist(items: PendingChecklistHint[]): void {
    this.pendingChecklist = (items ?? [])
      .filter((it) => typeof it?.id === "string" && it.id.length > 0 && typeof it?.title === "string" && it.title.length > 0)
      .slice(0, CHECKLIST_PROMPT_MAX_PENDING);
  }

  ingest(_sessionId: string, seg: AsrSegment, speaker?: TranscriptSpeaker): void {
    this.window.push({ t: seg.t, text: seg.text, speaker });
    this.trimWindow();
    void this.maybeAnalyze();
  }

  /**
   * 023 §7.5（v1.2）：本場**音訊時鐘**高水位＝目前窗內最新一段的 `t`（窗空→undefined）。
   * 刻意用**與 `trimWindow` 完全相同的取法**（`window[last].t`），這樣「冷卻是否走完一個窗」與
   * 「窗要不要丟掉這一段」永遠拿同一個基準比——單一真相。唯讀，不改任何狀態。
   */
  latestWindowT(): number | undefined {
    return this.window[this.window.length - 1]?.t;
  }

  /**
   * 兩道同時生效的上限：**年齡**（`WINDOW_MAX_AGE_MS`，管牆上時長）與**字元預算**
   * （`WINDOW_MAX_CHARS`，管 prompt 大小）。
   *
   * 年齡用 `filter` 而不是「從舊端 break」：段落是兩條 ASR 軌非同步轉寫完才 `ingest` 的，抵達順序
   * **不保證** `t` 單調（左軌一段 4 秒、右軌一段 1 秒，完成時間可以交錯）。基準 `latestT` 沿用
   * 「最後進窗那一段的 t」，與 `latestWindowT()` 同一取法（單一真相）。
   *
   * 字元預算從**最新往回收**，收到超出預算就停；**最新一段永遠留著**（單段就算自己超標也不能讓窗變空，
   * 否則那一輪分析等於瞎了）。
   */
  private trimWindow(): void {
    const latestT = this.window[this.window.length - 1]?.t ?? 0;
    const fresh = this.window.filter((s) => latestT - s.t <= WINDOW_MAX_AGE_MS);
    let chars = 0;
    let start = fresh.length - 1; // 起始值＝只留最新一段（fresh 為空時是 -1，下面的 slice 會退化成空陣列）
    for (let i = fresh.length - 1; i >= 0; i--) {
      chars += fresh[i]!.text.length;
      if (chars > WINDOW_MAX_CHARS) break;
      start = i;
    }
    this.window = fresh.slice(Math.max(0, start));
  }

  private async maybeAnalyze(): Promise<void> {
    const now = Date.now();
    if (this.analyzing || now - this.lastAnalysisAt < ANALYSIS_THROTTLE_MS) return;
    if (!this.gemini.isConfigured() || !this.signalsCb) return;

    this.analyzing = true;
    this.lastAnalysisAt = now;
    try {
      const result = await this.runAnalysis();
      // 023：signals 為空但有勾稽命中時仍需回呼（節流/單飛鎖不變，只是「值得回報」的條件多一種）。
      if (result.signals.length === 0 && (result.coveredItemIds?.length ?? 0) === 0) return;
      try {
        this.signalsCb(result.signals, result);
      } catch (err) {
        console.error(`[analysis] onSignals callback threw (session=${this.sessionId}):`, err);
      }
    } finally {
      this.analyzing = false;
    }
  }

  /** 023（契約 §7.1）：pending 非空時附加的勾稽指示；空 → 回空字串（prompt 完全不變）。 */
  private checklistPromptSection(): string {
    if (this.pendingChecklist.length === 0) return "";
    const lines = this.pendingChecklist
      .map((it) => `#${it.id} ${it.title}（關鍵詞：${(it.keywords ?? []).join("、")}）`)
      .join("\n");
    return (
      "\n另有一份本場「還沒講到」的待講清單如下（格式：#id 標題（關鍵詞））：\n" +
      `${lines}\n` +
      "若最近這段對話**已明確涵蓋**其中某幾項，把它們的 id 放進 coveredItemIds。" +
      "判準嚴格：只有內容真的被講到/問到/回應到才算；只是提到相關字眼、模稜兩可、或只是預告「稍後會講」一律不算，" +
      "沒有把握就不要放（**寧漏勿誤**——誤劃掉會讓報告者漏講，比漏劃傷害大）。沒有任何一項被涵蓋就回空陣列。"
    );
  }

  private async runAnalysis(): Promise<AnalysisResult> {
    const transcript = this.window.map(windowLine).join("\n");
    if (!transcript.trim()) return { signals: [] };
    try {
      const raw = await withDeadline(
        this.client.generateJson<RawSignals>({
          model: this.model,
          system:
            "你是 B2B 銷售會議的即時分析引擎。依最近逐字稿，抽出對報告者有用的商機訊號。" +
            "kind 只能是列舉值之一；confidence 是你對該訊號的信心（0~1）；label 用該訊號的簡短中文描述。" +
            "另偵測兩類輔助訊號供會中即時補充資訊（RESEARCH_UPGRADE_CONTRACT §4.2）：" +
            "person_mention（提到具體人名/在場人物，label 放該人名或稱謂）、" +
            "topic_shift（討論話題明顯轉換，label 放新話題的簡短描述）。" +
            "沒有明確訊號就回空陣列，不要硬湊。" +
            this.checklistPromptSection(),
          prompt:
            "最近逐字稿（時間先後；行首「報告者：」＝銷售方、「客戶：」＝對方，" +
            `沒有標註的行代表當下無法確定說話者）：\n${transcript}\n請輸出符合 schema 的 JSON。`,
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
      return { signals: [] };
    }
  }

  sanitize(raw: RawSignals): AnalysisResult {
    const rows = Array.isArray(raw?.signals) ? raw.signals : [];
    const signals: SignalItem[] = [];
    for (const r of rows) {
      const kind = r?.kind as SignalKind;
      if (!SIGNAL_KINDS.includes(kind)) continue;
      const label = typeof r?.label === "string" ? r.label.trim() : "";
      if (!label) continue;
      const confidence = clamp01(r?.confidence);
      if (confidence < SIGNALS_MIN_CONFIDENCE) continue;
      signals.push({ id: randomUUID(), kind, label, confidence });
    }
    // 023：勾稽 id 防幻覺——**必須在 pending 集合內**，否則丟棄；順帶去重／去空白。
    const allowed = new Set(this.pendingChecklist.map((it) => it.id));
    const covered: string[] = [];
    for (const v of Array.isArray(raw?.coveredItemIds) ? raw.coveredItemIds : []) {
      if (typeof v !== "string") continue;
      const id = v.trim().replace(/^#/, ""); // prompt 以 `#id` 列出，容忍模型把 `#` 一起回來
      if (!allowed.has(id) || covered.includes(id)) continue;
      covered.push(id);
    }
    return covered.length > 0 ? { signals, coveredItemIds: covered } : { signals };
  }
}
