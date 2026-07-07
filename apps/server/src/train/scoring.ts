/**
 * TrainScorer — 課後評分（M4；finish 觸發）。用 LLM 讀**雙向**逐字稿，對 REP（業務，不是扮演的 AI 客戶）
 * 評 4 維 0–100 + highlights + summary。
 *
 * L15：結構化輸出用 union-superset schema + `required` 關鍵欄 + `maxOutputTokens` 上限；模型用 `gemini-3.5-flash`
 * 等級（extractModel）——複雜結構化評分別用 flash-lite。分數防禦性 clamp 到 0–100 整數。
 */
import { Type } from "@google/genai";
import type { GeminiClient } from "../gemini.js";
import type { TrainTurn, TrainScores, TrainHighlight, TrainHighlightKind } from "@meetcopilot/shared";

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
  score(turns: TrainTurn[], ctx: ScoreContext): Promise<ScoreResult>;
}

const S = Type;

const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: S.OBJECT,
  properties: {
    scores: {
      type: S.OBJECT,
      properties: {
        objectionHandling: { type: S.INTEGER },
        discovery: { type: S.INTEGER },
        clarity: { type: S.INTEGER },
        closing: { type: S.INTEGER },
      },
      required: ["objectionHandling", "discovery", "clarity", "closing"],
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

const SYSTEM = [
  "You are an expert B2B sales coach reviewing a role-play practice call.",
  "The transcript is two-way: 'REP' is the salesperson being evaluated; 'CUSTOMER' is an AI playing the prospect. **Score only the REP.**",
  "Score four dimensions 0–100 (higher = better):",
  "- objectionHandling: how well the rep acknowledged and resolved the customer's objections/pushback.",
  "- discovery: quality of questions uncovering needs, priorities, pain, and buying process.",
  "- clarity: how clear, concise, and jargon-free the rep's explanations were.",
  "- closing: whether the rep advanced the deal — clear next steps, asked for commitment.",
  "Then give 2–5 highlights, each a SHORT verbatim quote from the REP with a one-sentence coaching comment; kind='good' for strong moments, kind='improve' for missed opportunities.",
  "Then a 2–4 sentence overall summary. Write comments/summary in Traditional Chinese (繁體中文).",
  "Be fair but honest; base every judgement only on what the transcript shows. Return ONLY valid JSON matching the schema.",
].join(" ");

/** 逐字稿轉評分用文本（rep/ai → REP/CUSTOMER 標籤）。 */
function renderTranscript(turns: TrainTurn[]): string {
  return turns
    .map((t) => `${t.speaker === "rep" ? "REP" : "CUSTOMER"}: ${t.text}`)
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
    async score(turns: TrainTurn[], ctx: ScoreContext): Promise<ScoreResult> {
      if (!gemini.isConfigured()) throw new Error("GEMINI_API_KEY not configured");

      const prompt =
        `Persona played by CUSTOMER: ${ctx.personaName}, ${ctx.personaTitle} at ${ctx.companyName}.\n\n` +
        `TRANSCRIPT:\n${renderTranscript(turns)}\n\n` +
        "Evaluate the REP per the instructions and return the JSON.";

      const raw = await gemini.generateJson<{
        scores?: Partial<Record<keyof TrainScores, unknown>>;
        highlights?: { quote?: unknown; comment?: unknown; kind?: unknown }[];
        summary?: unknown;
      }>({
        model,
        system: SYSTEM,
        prompt,
        schema: RESPONSE_SCHEMA,
        maxOutputTokens: 2048,
      });

      const s = raw.scores ?? {};
      const scores: TrainScores = {
        objectionHandling: clampScore(s.objectionHandling),
        discovery: clampScore(s.discovery),
        clarity: clampScore(s.clarity),
        closing: clampScore(s.closing),
      };

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
