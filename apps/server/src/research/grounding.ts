/**
 * GroundingProvider — Gemini Google Search grounding 的開放研究即答（M1_CONTRACT §2；API_CONTRACT §3 /ground）。
 * 回 {answer, citations:{title,url}[]}。ctx.companyId 供把答案錨定到特定公司（M1：併入 prompt 提示；
 * 深度 CRM 上下文注入留待副駕編排 M3）。
 */
import type { GeminiClient, GroundedResult } from "../gemini.js";

export interface GroundingContext {
  companyId?: string;
  companyName?: string;
}

export interface GroundingProvider {
  answer(query: string, ctx?: GroundingContext): Promise<GroundedResult>;
}

const SYSTEM = [
  "You are a B2B sales research assistant. Answer the question concisely using up-to-date, cited facts.",
  "Prefer primary sources. If uncertain, say so rather than inventing details.",
].join(" ");

export function createGroundingProvider(gemini: GeminiClient): GroundingProvider {
  return {
    async answer(query: string, ctx?: GroundingContext): Promise<GroundedResult> {
      if (!gemini.isConfigured()) throw new Error("GEMINI_API_KEY not configured");
      const hint = ctx?.companyName ? `\n(Context: the question concerns the company "${ctx.companyName}".)` : "";
      return gemini.generateGrounded({ system: SYSTEM, prompt: `${query}${hint}` });
    },
  };
}
