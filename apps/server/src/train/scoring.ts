/**
 * TrainScorer — 課後評分（M4；finish 觸發）。用 LLM 讀**雙向**逐字稿，對受評者（YOU：業務／報告者／求職者，
 * 不是扮演對手的 AI）評分 + highlights + summary。
 *
 * A3：評分維度**改資料驅動**——維度數/名稱由 `TRAIN_MODES[mode].dimensions` 決定（各情境模式不同）；
 * SYSTEM 由 `coachRole` ＋逐維 guide 動態組，回傳前以模式維度為準組 labeled 陣列（label 對齊、缺分補 0、不受模型亂序影響）。
 *
 * L15：結構化輸出用 union-superset schema + `required` 關鍵欄 + `maxOutputTokens` 上限；模型用 `gemini-3.5-flash`
 * 等級（extractModel）——複雜結構化評分別用 flash-lite。分數防禦性 clamp 到 0–100 整數。
 */
import { Type } from "@google/genai";
import type { GeminiClient } from "../gemini.js";
import type {
  TrainTurn,
  TrainMode,
  TrainScores,
  TrainHighlight,
  TrainHighlightKind,
} from "@meetcopilot/shared";
import { TRAIN_MODES } from "@meetcopilot/shared";

/**
 * 評分報告文字語言（決策 2026-07-24）：跟 app i18n 語系（web 呼叫 finish 時帶當前 locale → 映射）——
 * 'zh'＝繁體中文、'en'＝英文。**維度 label 仍用 TRAIN_MODES 的中文 label 不變**（那是 UI 顯示；此僅切 comments/summary 語言）。
 * 預設 'zh'。
 */
export type ReportLang = "zh" | "en";

export interface ScoreResult {
  scores: TrainScores;
  highlights: TrainHighlight[];
  summary: string;
}

export interface ScoreContext {
  personaName: string;
  personaTitle: string;
  companyName: string;
}

export interface TrainScorer {
  /**
   * @param client 可選 per-call GeminiClient override——finish 時傳入現包的 metered client 以記帳（洞 D）；
   *   省略則用建構期的 client（行為不變）。
   * @param mode  情境模式（A3）；決定 coachRole＋評分維度（`TRAIN_MODES[mode].dimensions`）。省略＝'sales'。
   * @param reportLang 報告文字語言（跟 app i18n locale）；決定 comments/summary 語言。省略＝'zh'。
   */
  score(
    turns: TrainTurn[],
    ctx: ScoreContext,
    client?: GeminiClient,
    mode?: TrainMode,
    reportLang?: ReportLang,
  ): Promise<ScoreResult>;
}

const S = Type;

/**
 * 回應 schema（A3）：scores 由固定四鍵 object 改為 **labeled 陣列**（`{label,score}[]`）——模式維度數/名稱可變，
 * schema 保持通用；「該給哪些 label」由動態 SYSTEM（逐維 guide）指示。
 */
const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: S.OBJECT,
  properties: {
    scores: {
      type: S.ARRAY,
      items: {
        type: S.OBJECT,
        properties: {
          label: { type: S.STRING },
          score: { type: S.INTEGER },
        },
        required: ["label", "score"],
      },
    },
    highlights: {
      type: S.ARRAY,
      items: {
        type: S.OBJECT,
        properties: {
          quote: { type: S.STRING },
          comment: { type: S.STRING },
          kind: { type: S.STRING, enum: ["good", "improve"] },
        },
        required: ["quote", "comment", "kind"],
      },
    },
    summary: { type: S.STRING },
  },
  required: ["scores", "summary"],
};

/**
 * 依情境模式動態組 SYSTEM（A3）：教練身分＝`TRAIN_MODES[mode].coachRole`；評分維度＝逐維 `label: guide`。
 * 逐字稿標籤泛化為 YOU（受評者）/COUNTERPART（對手），SYSTEM 明示**只評 YOU**。
 */
function buildSystem(mode: TrainMode, reportLang: ReportLang = "zh"): string {
  const def = TRAIN_MODES[mode];
  const dimLines = def.dimensions.map((d) => `- ${d.label}: ${d.guide}.`);
  const langName = reportLang === "en" ? "English" : "Traditional Chinese (繁體中文)";
  return [
    `You are ${def.coachRole}.`,
    "The transcript is two-way: 'YOU' is the person being evaluated (the presenter/rep/candidate); 'COUNTERPART' is an AI playing the other party. **Score only YOU — never score the COUNTERPART.**",
    "Score each of these dimensions 0–100 (higher = better), and return a 'scores' array with exactly one entry per dimension, each entry's 'label' set to EXACTLY the label shown here:",
    ...dimLines,
    "Then give 2–5 highlights, each a SHORT verbatim quote from YOU with a one-sentence coaching comment; kind='good' for strong moments, kind='improve' for missed opportunities.",
    `Then a 2–4 sentence overall summary. Write comments and summary in ${langName}; keep proper nouns, product names, and technical terms in their original form (often English), do not force-translate them.`,
    "Be fair but honest; base every judgement only on what the transcript shows. Return ONLY valid JSON matching the schema.",
  ].join(" ");
}

/** 逐字稿轉評分用文本（rep/ai → YOU/COUNTERPART 標籤；受評者＝YOU）。 */
function renderTranscript(turns: TrainTurn[]): string {
  return turns
    .map((t) => `${t.speaker === "rep" ? "YOU" : "COUNTERPART"}: ${t.text}`)
    .join("\n");
}

/** clamp 到 0–100 整數（模型偶爾越界/回小數）。 */
function clampScore(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

const VALID_KINDS: TrainHighlightKind[] = ["good", "improve"];

export function createTrainScorer(gemini: GeminiClient, model?: string): TrainScorer {
  return {
    async score(
      turns: TrainTurn[],
      ctx: ScoreContext,
      client?: GeminiClient,
      mode: TrainMode = "sales",
      reportLang: ReportLang = "zh",
    ): Promise<ScoreResult> {
      const g = client ?? gemini; // 洞 D：finish 傳 metered client 記帳；省略則用建構期 client。
      if (!g.isConfigured()) throw new Error("GEMINI_API_KEY not configured");

      const prompt =
        `Role played by COUNTERPART: ${ctx.personaName}, ${ctx.personaTitle} at ${ctx.companyName}.\n\n` +
        `TRANSCRIPT:\n${renderTranscript(turns)}\n\n` +
        "Evaluate YOU per the instructions and return the JSON.";

      const raw = await g.generateJson<{
        scores?: { label?: unknown; score?: unknown }[];
        highlights?: { quote?: unknown; comment?: unknown; kind?: unknown }[];
        summary?: unknown;
      }>({
        model,
        system: buildSystem(mode, reportLang),
        prompt,
        schema: RESPONSE_SCHEMA,
        maxOutputTokens: 2048,
      });

      // 以「模式維度」為權威組陣列：把模型回的 label→score 建索引，再對每個 dimensions[i].label 取分數
      // （clamp 0–100、缺→0、順序照 dimensions）。保證回傳＝該模式維度、不受模型亂序/漏維/多維影響。
      const byLabel = new Map<string, number>();
      for (const item of raw.scores ?? []) {
        if (item && typeof item === "object" && typeof item.label === "string") {
          byLabel.set(item.label.trim(), clampScore(item.score));
        }
      }
      const scores: TrainScores = TRAIN_MODES[mode].dimensions.map((d) => ({
        label: d.label,
        score: byLabel.get(d.label) ?? 0,
      }));

      const highlights: TrainHighlight[] = (raw.highlights ?? [])
        .map((h) => {
          const kind: TrainHighlightKind = VALID_KINDS.includes(h.kind as TrainHighlightKind)
            ? (h.kind as TrainHighlightKind)
            : "improve";
          return {
            quote: typeof h.quote === "string" ? h.quote : "",
            comment: typeof h.comment === "string" ? h.comment : "",
            kind,
          };
        })
        .filter((h) => h.quote.trim().length > 0 || h.comment.trim().length > 0);

      const summary = typeof raw.summary === "string" ? raw.summary : "";
      return { scores, highlights, summary };
    },
  };
}
