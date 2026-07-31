/**
 * W4「上次分數」——`GET /api/train/personas` 每個 persona 附 `lastScore?/lastPracticedAt?`（既有 training 表彙總）。
 *  - 練過並評分 → lastScore＝各維度平均（四捨五入）、lastPracticedAt＝session.ended_at。
 *  - 沒練過 → 兩欄 undefined（**不是 0**——0 分和沒練過是兩件事）。
 *  - 多次對練 → 取**最新**那次。
 *  - 跨 org（攻擊者視角，硬規則 7）：他 org 的報告即使 contact_id 與本 org 相同，也絕不帶進來。
 */
import { describe, it, expect } from "vitest";
import { createCrmCore } from "@meetcopilot/crm";
import type { CrmCore } from "@meetcopilot/crm";
import type { GeminiClient } from "../gemini.js";
import type { LiveTokenMinter } from "./live-token.js";
import type { TrainScorer } from "./scoring.js";
import { createTrainService, type TrainService } from "./train-service.js";
import { overallScore } from "./last-score.js";

const mockMinter: LiveTokenMinter = {
  async mint(opts) {
    return { token: "t", model: opts.model, expireTime: Date.now() + 60_000 };
  },
};

function makeService(core: CrmCore): TrainService {
  return createTrainService({
    core,
    minter: mockMinter,
    scorer: {} as unknown as TrainScorer,
    gemini: { isConfigured: () => false } as unknown as GeminiClient,
    liveModel: "live-model",
  });
}

/** 建一個「可對練」的 contact（trainingUnlocked=1 就過 canTrain 閘，不需 verified persona）。 */
async function makeTrainableContact(core: CrmCore, orgId: string, companyName: string, fullName: string) {
  const co = await core.companies.create(orgId, { name: companyName });
  const contact = await core.contacts.create(orgId, co.id, { fullName, title: "CIO" });
  await core.contacts.setTrainingUnlocked(orgId, contact.id, true);
  return contact;
}

/** 跑一場對練並評分（scores 為各維度分數），回 session id。 */
async function practice(core: CrmCore, orgId: string, contactId: string, scores: number[]) {
  const session = await core.training.createSession(orgId, { contactId });
  await core.training.finishSession(orgId, session.id);
  await core.training.createReport(orgId, {
    sessionId: session.id,
    scores: scores.map((score, i) => ({ label: `d${i}`, score })),
    highlights: [],
    summary: "s",
  });
  return session.id;
}

describe("overallScore — scores_json → 0–100 總分", () => {
  it("新格式（陣列）取各維度平均並四捨五入", () => {
    expect(overallScore(JSON.stringify([{ label: "a", score: 80 }, { label: "b", score: 71 }]))).toBe(76); // 75.5→76
  });
  it("舊格式（固定四維 object）相容", () => {
    expect(overallScore(JSON.stringify({ objectionHandling: 60, discovery: 70, clarity: 80, closing: 90 }))).toBe(75);
  });
  it("壞資料／空 → null（呼叫端據此回 undefined，不編造 0 分）", () => {
    expect(overallScore(null)).toBeNull();
    expect(overallScore("not json")).toBeNull();
    expect(overallScore("[]")).toBeNull();
    expect(overallScore(JSON.stringify([{ label: "a" }]))).toBeNull();
  });
});

describe("personas() 的 lastScore / lastPracticedAt", () => {
  it("練過→帶分數與時間；沒練過→兩欄 undefined；多次→取最新那次", async () => {
    const core = await createCrmCore(":memory:");
    await core.migrate();
    const practiced = await makeTrainableContact(core, "o1", "Acme", "已練過的人");
    const fresh = await makeTrainableContact(core, "o1", "Beta", "沒練過的人");

    await practice(core, "o1", practiced.id, [40, 40, 40, 40]); // 舊的一場：40
    // 時間戳是 epoch-ms：兩場之間必須真的跨過一毫秒，否則「哪一場比較新」在資料上本來就沒有答案。
    // （真實對練一場數分鐘，這個 sleep 只是把測試資料造得跟現實一樣可分辨。）
    await new Promise((r) => setTimeout(r, 5));
    const latest = await practice(core, "o1", practiced.id, [80, 70, 90, 61]); // 新的一場：75.25→75
    const latestSession = await core.training.findSession("o1", latest);

    const out = await makeService(core).personas("o1");
    const p = out.find((x) => x.contactId === practiced.id)!;
    const f = out.find((x) => x.contactId === fresh.id)!;

    expect(p.lastScore).toBe(75); // 最新那場，不是 40
    expect(p.lastPracticedAt).toBe(latestSession!.endedAt);
    expect(f.lastScore).toBeUndefined();
    expect(f.lastPracticedAt).toBeUndefined();
  });

  it("跨 org：他 org 對同一 contactId 的高分報告，絕不出現在本 org 的 personas", async () => {
    const core = await createCrmCore(":memory:");
    await core.migrate();
    const victim = await makeTrainableContact(core, "o1", "Acme", "本 org 的人");

    // 攻擊佐證：o2 拿 o1 的 contactId 建 session＋99 分報告（repo 不驗跨 org contact 歸屬，但查詢一律 org_id=?）。
    await practice(core, "o2", victim.id, [99, 99, 99, 99]);

    const out = await makeService(core).personas("o1");
    expect(out.find((x) => x.contactId === victim.id)!.lastScore).toBeUndefined();

    // o2 自己查也看不到這個 contact（contact 不屬於 o2 → 根本不在 persona 清單裡）。
    expect(await makeService(core).personas("o2")).toHaveLength(0);
  });
});
