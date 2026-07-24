/**
 * persona 嗓音選定測試：pickPersonaVoice 決定性、分散性、值域皆在 PERSONA_VOICE_POOL 內。
 * 純函式，不碰 core/minter，故直接單測。
 */
import { describe, it, expect } from "vitest";
import { pickPersonaVoice, PERSONA_VOICE_POOL } from "./persona.js";

describe("pickPersonaVoice — persona 嗓音穩定選定", () => {
  it("決定性：同一 contactId 多次呼叫永遠回同一嗓音", () => {
    const id = "contact-abc-123-xyz";
    const first = pickPersonaVoice(id);
    for (let i = 0; i < 20; i++) expect(pickPersonaVoice(id)).toBe(first);
  });

  it("回傳值一定在 PERSONA_VOICE_POOL 內", () => {
    const pool = new Set<string>(PERSONA_VOICE_POOL);
    for (const id of ["", "a", "決策者-1", "0", "some-uuid-like-9f8e7d6c", "ZZZZZZZZ"]) {
      expect(pool.has(pickPersonaVoice(id))).toBe(true);
    }
  });

  it("分散性：不同 contactId 會分散到多個嗓音（單字元 a..h 恰好命中全部 8 個池嗓音）", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const voices = new Set(ids.map(pickPersonaVoice));
    // charCode 累加 mod 8：97..104 → 1,2,3,4,5,6,7,0 → 覆蓋整個池、彼此相異。
    expect(voices.size).toBe(PERSONA_VOICE_POOL.length);
  });

  it("分散性（實務 id）：一批 UUID 風格 id 至少落在 3 種以上嗓音", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `contact-${i}-${(i * 7 + 3).toString(16)}-persona`);
    const voices = new Set(ids.map(pickPersonaVoice));
    expect(voices.size).toBeGreaterThanOrEqual(3);
  });
});
