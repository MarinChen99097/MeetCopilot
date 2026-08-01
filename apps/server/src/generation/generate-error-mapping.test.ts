/**
 * POST /decks/generate 錯誤對映 ＋ finishReason retryable 語意（2026-08-01 prod 事故回歸鎖）。
 *
 * 事故：主題「介紹MeetCopilot給Troy」8 頁 → 使用者看到「內容可能觸發安全性限制，請調整主題或用語後再試」。
 * prod log 實證上游其實是 `finishReason=RECITATION`，被舊 regex 併進 SAFETY 分支＝訊息既錯又不可行動
 *（真正該做的是重取樣；使用者 31 秒後同輸入重按即 201）。
 * 本檔鎖兩件事：(a) RECITATION 不再被說成「安全性限制」；(b) RECITATION 不短路重試、其餘 finishReason 照舊短路。
 *
 * 註（ROM 2026-08-01 17:54 決策 1）：「RECITATION 不短路」是**全域無條件**的；而「升溫＋改寫 hint」已拆成
 * opt-in 的 `resampleOnRecitation`（只有 deck 生成／revise 開）。後者的行為鎖在 `../gemini-recitation-resample.test.ts`。
 */
import { describe, it, expect } from "vitest";
import { mapGenerateError } from "../decks-routes/index.js";
import { GenerationEmptyError } from "./generation-service.js";
import {
  finishReasonError,
  isRecitationError,
  isMaxTokensError,
  GEMINI_MAX_OUTPUT_TOKENS,
  type RetryableError,
} from "../gemini.js";
import { deckOutputTokenBudget, reviseOutputTokenBudget } from "./slide-gen.js";
import { MAX_DECK_PAGES } from "@meetcopilot/shared";

/** 依 gemini.ts 真實訊息格式造錯誤（避免測試用假字串鎖到不存在的形狀）。 */
const err = (finishReason: string): RetryableError => finishReasonError(finishReason);

describe("finishReasonError：retryable 語意", () => {
  it("RECITATION 不短路（交給 withRetry 做獨立重取樣）", () => {
    const e = err("RECITATION");
    expect(e.retryable).not.toBe(false);
    expect(e.message).toContain("finishReason=RECITATION");
    expect(isRecitationError(e)).toBe(true);
  });

  it("MAX_TOKENS / SAFETY / 其餘一律短路（retryable=false），行為不變", () => {
    for (const reason of ["MAX_TOKENS", "SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "OTHER"]) {
      expect(err(reason).retryable, reason).toBe(false);
    }
    expect(isMaxTokensError(err("MAX_TOKENS"))).toBe(true);
    expect(isRecitationError(err("MAX_TOKENS"))).toBe(false);
  });

  it("resampleOnMaxTokens：只有 MAX_TOKENS 被放行重取樣，SAFETY 家族仍短路", () => {
    expect(finishReasonError("MAX_TOKENS", { resampleOnMaxTokens: true }).retryable).not.toBe(false);
    // 沒開（預設）→ 維持短路，checklist-gen／deep-extractor 的「縮小輸入重試」策略不受影響。
    expect(finishReasonError("MAX_TOKENS").retryable).toBe(false);
    expect(finishReasonError("SAFETY", { resampleOnMaxTokens: true }).retryable).toBe(false);
    expect(finishReasonError("OTHER", { resampleOnMaxTokens: true }).retryable).toBe(false);
  });

  it("RECITATION 的 retryable 與任何旗標無關（旗標只管升溫/hint，不管短不短路）", () => {
    expect(finishReasonError("RECITATION").retryable).not.toBe(false);
    expect(finishReasonError("RECITATION", { resampleOnMaxTokens: true }).retryable).not.toBe(false);
    expect(finishReasonError("RECITATION", {}).retryable).not.toBe(false);
  });

  it("SAFETY 家族才給「安全性」字樣，RECITATION 不給", () => {
    expect(err("SAFETY").message).toContain("安全性");
    expect(err("BLOCKLIST").message).toContain("安全性");
    expect(err("RECITATION").message).not.toContain("安全性");
  });
});

describe("輸出 token 預算（MAX_TOKENS 撞頂回歸鎖）", () => {
  it("8 頁的預算必須高於實測用量（output 14218 + thoughts 2150 = 16368，舊寫死值 16384 剛好撞頂）", () => {
    expect(deckOutputTokenBudget(8)).toBeGreaterThan(16_368);
    expect(deckOutputTokenBudget(8)).toBeGreaterThan(16_384); // 舊值
  });

  it("依頁數遞增，且永不超過模型上限", () => {
    expect(deckOutputTokenBudget(12)).toBeGreaterThan(deckOutputTokenBudget(8));
    expect(deckOutputTokenBudget(MAX_DECK_PAGES)).toBe(GEMINI_MAX_OUTPUT_TOKENS);
    expect(deckOutputTokenBudget(1)).toBeGreaterThan(0);
    // 邊界：0/負數不得算出比 1 頁還小的預算（避免必然截斷）。
    expect(deckOutputTokenBudget(0)).toBe(deckOutputTokenBudget(1));
  });

  it("revise：3 頁預算需高於實測單頁用量的 3 倍（單頁實測 4079，舊寫死值 4096）", () => {
    expect(reviseOutputTokenBudget(3)).toBeGreaterThan(4_079 * 3);
    expect(reviseOutputTokenBudget(1)).toBeGreaterThan(4_096); // 舊值連一頁都不夠
    expect(reviseOutputTokenBudget(MAX_DECK_PAGES)).toBeLessThanOrEqual(GEMINI_MAX_OUTPUT_TOKENS);
  });
});

describe("mapGenerateError：HTTP 對映", () => {
  it("RECITATION → 422，且不得再說「安全性限制」（事故回歸）", () => {
    const r = mapGenerateError(err("RECITATION"));
    expect(r.status).toBe(422);
    expect(r.error).not.toContain("安全性");
    expect(r.error).toContain("recitation");
  });

  it("SAFETY 家族 → 422 安全性訊息", () => {
    for (const reason of ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST"]) {
      const r = mapGenerateError(err(reason));
      expect(r.status, reason).toBe(422);
      expect(r.error, reason).toContain("安全性限制");
    }
  });

  it("MAX_TOKENS → 422 輸出過長（不可與 recitation/安全性 混淆）", () => {
    const r = mapGenerateError(err("MAX_TOKENS"));
    expect(r.status).toBe(422);
    expect(r.error).toContain("輸出過長");
  });

  it("其餘 finishReason（OTHER）→ 422 通用未正常結束，不誤標輸出過長", () => {
    const r = mapGenerateError(err("OTHER"));
    expect(r.status).toBe(422);
    expect(r.error).toBe("生成未正常結束，請調整輸入後再試");
  });

  it("限流：.status 429/503 或 RESOURCE_EXHAUSTED/quota → 429", () => {
    expect(mapGenerateError(Object.assign(new Error("boom"), { status: 429 })).status).toBe(429);
    expect(mapGenerateError(Object.assign(new Error("boom"), { status: 503 })).status).toBe(429);
    expect(mapGenerateError(new Error("RESOURCE_EXHAUSTED: out of quota")).status).toBe(429);
  });

  it("空生成 → 422；其餘未知錯誤 → 502 且不外洩上游原文", () => {
    expect(mapGenerateError(new GenerationEmptyError()).status).toBe(422);
    const r = mapGenerateError(new Error("Gemini JSON parse failed; head: {\"slides\":[{\"secret\""));
    expect(r.status).toBe(502);
    expect(r.error).not.toContain("secret");
    expect(r.error).toBe("AI 服務暫時無法生成簡報，請稍後再試");
  });
});
