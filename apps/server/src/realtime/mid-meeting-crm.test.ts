/**
 * 會中 CRM 消費端測試（RESEARCH_UPGRADE_CONTRACT §4.2）——行為驗證，非自述：
 *  1. 白名單跨 org 拒絕：攻擊者把他 org 的 entity id（companyId）混入檢索也不得命中（org_id 硬隔離）。
 *  2. 同場同 entity 去重：跨分析窗共享 seen 集合 → 同一實體整場只出一次卡。
 *  3. 新訊號 schema 解析：analysis 引擎能吐 person_mention／topic_shift，濾掉非列舉 kind。
 *  4. speakerLabel 選填相容：舊 client payload（無 speakerLabel）不壞；inferSpeaker 帶 CRM 名冊回細分標籤，
 *     unknown 時不帶 label。
 */
import { describe, it, expect } from "vitest";
import { createCrmCore } from "@meetcopilot/crm";
import type { CrmCore } from "@meetcopilot/crm";
import type {
  GeminiClient,
  Metered,
  TokenUsage,
} from "../gemini.js";
import type { SignalItem, TranscriptSegment } from "@meetcopilot/shared";
import { retrieveInfoCards } from "./retrieval.js";
import { CrmCopilotOrchestrator } from "./orchestrator.js";
import type { LiveSessionRuntime } from "./session-runtime.js";
import { RollingWindowAnalysisEngine } from "../analysis/gemini-analysis.js";

const USAGE: TokenUsage = { model: "test" };
const VEC = [0.2, 0.9, 0.35, 0.1];

/** Minimal GeminiClient fake: fixed embed vector + fixed generateJson JSON; everything else inert. */
function makeGemini(opts: { embedVec?: number[]; json?: unknown; configured?: boolean }): GeminiClient {
  const embedVec = opts.embedVec ?? [];
  const json = opts.json;
  return {
    isConfigured: () => opts.configured ?? true,
    embed: async () => embedVec,
    embedMetered: async (): Promise<Metered<number[]>> => ({ value: embedVec, usage: USAGE }),
    generateJson: async <T>() => json as T,
    generateJsonMetered: async <T>(): Promise<Metered<T>> => ({ value: json as T, usage: USAGE }),
    generateGrounded: async () => ({ answer: "", citations: [] }),
  };
}

async function seedEmbedding(
  core: CrmCore,
  orgId: string,
  entityType: string,
  entityId: string,
  vec: number[],
  content: string,
): Promise<void> {
  await core.embeddings.upsert(orgId, [
    {
      entityType,
      entityId,
      content,
      contentHash: `${entityType}:${entityId}`,
      embedding: vec,
      dims: vec.length,
      model: "test",
    },
  ]);
}

const sig: SignalItem[] = [{ id: "s1", kind: "interest", label: "對整合有興趣", confidence: 0.8 }];

describe("會中 CRM 檢索白名單 + 去重 + 信任（§4.2）", () => {
  it("白名單跨 org 拒絕：攻擊者混入他 org 的 companyId 不得命中；自家公司正常命中", async () => {
    const core = await createCrmCore(":memory:");
    try {
      await core.migrate();
      const orgA = await core.orgs.create({ name: "Org A" });
      const orgB = await core.orgs.create({ name: "Org B" });
      const companyA = await core.companies.create(orgA.id, { name: "Acme A" });
      const companyB = await core.companies.create(orgB.id, { name: "Acme B" });
      await seedEmbedding(core, orgA.id, "company", companyA.id, VEC, "A 公司情報");
      await seedEmbedding(core, orgB.id, "company", companyB.id, VEC, "B 公司情報（他 org 機密）");

      const deps = { core, gemini: makeGemini({ embedVec: VEC }) };

      // 攻擊者在 orgA，卻把 orgB 的 companyId 塞進 ctx（模擬被竄改的綁定）→ org_id 過濾應使其 0 命中。
      const attacker = await retrieveInfoCards(deps, { orgId: orgA.id, companyId: companyB.id }, sig);
      expect(attacker).toHaveLength(0);

      // 正常：orgA 查自家 companyA → 命中 1 張卡。
      const legit = await retrieveInfoCards(deps, { orgId: orgA.id, companyId: companyA.id }, sig);
      expect(legit).toHaveLength(1);
      expect(legit[0]?.kind).toBe("company");
      expect(legit[0]?.body).toContain("A 公司情報");
    } finally {
      core.close();
    }
  });

  it("同場同 entity 去重：跨分析窗共享 seen 集合 → 同一實體只出一次卡", async () => {
    const core = await createCrmCore(":memory:");
    try {
      await core.migrate();
      const org = await core.orgs.create({ name: "Org A" });
      const company = await core.companies.create(org.id, { name: "Acme" });
      await seedEmbedding(core, org.id, "company", company.id, VEC, "公司情報");

      const deps = { core, gemini: makeGemini({ embedVec: VEC }) };
      const seen = new Set<string>();

      const first = await retrieveInfoCards(deps, { orgId: org.id, companyId: company.id }, sig, {
        contextText: "近期逐字稿要點",
        seen,
      });
      expect(first).toHaveLength(1);

      // 第二個分析窗共享同一 seen 集合 → 同一 company 實體不再出卡。
      const second = await retrieveInfoCards(deps, { orgId: org.id, companyId: company.id }, sig, {
        contextText: "又一輪逐字稿",
        seen,
      });
      expect(second).toHaveLength(0);
    } finally {
      core.close();
    }
  });

  it("信任標記：實體有 human provenance → trust=verified；否則 crawler", async () => {
    const core = await createCrmCore(":memory:");
    try {
      await core.migrate();
      const org = await core.orgs.create({ name: "Org A" });
      const human = await core.companies.create(org.id, { name: "Human Co" });
      const crawled = await core.companies.create(org.id, { name: "Crawled Co" });
      await seedEmbedding(core, org.id, "company", human.id, VEC, "人工背書公司");
      await seedEmbedding(core, org.id, "company", crawled.id, VEC, "純爬蟲公司");
      await core.provenance.record(org.id, [
        {
          entityType: "company",
          entityId: human.id,
          fieldName: "description",
          valueSnapshot: "人工填寫",
          filledBy: "human",
          verified: 1,
        },
      ]);

      const deps = { core, gemini: makeGemini({ embedVec: VEC }) };
      const humanCard = await retrieveInfoCards(deps, { orgId: org.id, companyId: human.id }, sig);
      expect(humanCard[0]?.trust).toBe("verified");
      const crawlerCard = await retrieveInfoCards(deps, { orgId: org.id, companyId: crawled.id }, sig);
      expect(crawlerCard[0]?.trust).toBe("crawler");
    } finally {
      core.close();
    }
  });

  it("信任對映：indexer 實際型別 company_card 命中 → 依基底 company provenance 判信任（修法前永遠 crawler）", async () => {
    const core = await createCrmCore(":memory:");
    try {
      await core.migrate();
      const org = await core.orgs.create({ name: "Org A" });
      const human = await core.companies.create(org.id, { name: "Human Co" });
      const crawled = await core.companies.create(org.id, { name: "Crawled Co" });
      // indexer 寫入的真實 entity_type 是 *_card 別名（company_card），而 provenance 記在基底 "company"。
      // resolveTrust 若不對映 → company_card exact-match 0 列 → 人工驗證資料永遠顯示 crawler（此 finding）。
      await seedEmbedding(core, org.id, "company_card", human.id, VEC, "人工背書公司");
      await seedEmbedding(core, org.id, "company_card", crawled.id, VEC, "純爬蟲公司");
      await core.provenance.record(org.id, [
        {
          entityType: "company", // 基底型別（human update / crawl 皆記於此）
          entityId: human.id,
          fieldName: "description",
          valueSnapshot: "人工填寫",
          filledBy: "human",
          verified: 1,
        },
      ]);

      const deps = { core, gemini: makeGemini({ embedVec: VEC }) };
      const humanCard = await retrieveInfoCards(deps, { orgId: org.id, companyId: human.id }, sig);
      expect(humanCard[0]?.trust).toBe("verified"); // 對映 company_card→company 後可達 verified
      const crawlerCard = await retrieveInfoCards(deps, { orgId: org.id, companyId: crawled.id }, sig);
      expect(crawlerCard[0]?.trust).toBe("crawler"); // 無人工 provenance → crawler
    } finally {
      core.close();
    }
  });
});

describe("新訊號 schema 解析：person_mention / topic_shift（§4.2）", () => {
  it("analysis 引擎接受兩類新訊號，濾掉非列舉 kind", async () => {
    const gemini = makeGemini({
      json: {
        signals: [
          { kind: "person_mention", label: "王經理", confidence: 0.9 },
          { kind: "topic_shift", label: "改談定價", confidence: 0.8 },
          { kind: "not_a_real_kind", label: "應被濾掉", confidence: 0.95 },
          { kind: "interest", label: "對整合有興趣", confidence: 0.7 },
        ],
      },
    });
    const engine = new RollingWindowAnalysisEngine(gemini, "model-x", "sess-1");
    const got: SignalItem[] = [];
    engine.onSignals((items) => got.push(...items));
    engine.ingest("sess-1", { t: Date.now(), text: "我是王經理，我們來談談定價" });
    await new Promise((r) => setTimeout(r, 30));

    const kinds = got.map((s) => s.kind);
    expect(kinds).toContain("person_mention");
    expect(kinds).toContain("topic_shift");
    expect(kinds).toContain("interest");
    expect(kinds).not.toContain("not_a_real_kind");
  });
});

describe("speakerLabel 選填相容 + 推斷（§4.2）", () => {
  it("舊 client payload（無 speakerLabel）仍是合法 segment，JSON 不含該 key", () => {
    const legacy: TranscriptSegment = { id: "x", t: 0, speaker: "client", text: "hi", final: true };
    expect("speakerLabel" in legacy).toBe(false);
    // hub 以 speakerLabel:undefined 建 segment 時，序列化後不應出現該 key（相容舊 client）。
    const wire = JSON.parse(JSON.stringify({ ...legacy, speakerLabel: undefined }));
    expect(wire).not.toHaveProperty("speakerLabel");
  });

  it("inferSpeaker 帶 CRM 名冊回細分 speakerLabel；unknown 時不帶 label", async () => {
    const core = await createCrmCore(":memory:");
    try {
      await core.migrate();
      const org = await core.orgs.create({ name: "Org A" });
      const company = await core.companies.create(org.id, { name: "Acme" });
      await core.contacts.create(org.id, company.id, { fullName: "王大明", title: "採購經理" });
      const runtime = { orgId: org.id, companyId: company.id, presenterUserId: "u1" } as unknown as LiveSessionRuntime;

      const labeled = new CrmCopilotOrchestrator({
        core,
        gemini: makeGemini({ json: { speaker: "client", speakerLabel: "客戶-王大明" } }),
        inferenceModel: "m",
        getRuntime: () => runtime,
        supplementAutoLimitPerMeeting: 0,
      });
      const r1 = await labeled.inferSpeaker("sess", "我們的預算有限");
      expect(r1.speaker).toBe("client");
      expect(r1.speakerLabel).toBe("客戶-王大明");

      // speaker=unknown → 即使模型回了 label 也應省略（label 只在能確定身分時有意義）。
      const unknown = new CrmCopilotOrchestrator({
        core,
        gemini: makeGemini({ json: { speaker: "unknown", speakerLabel: "客戶-A" } }),
        inferenceModel: "m",
        getRuntime: () => runtime,
        supplementAutoLimitPerMeeting: 0,
      });
      const r2 = await unknown.inferSpeaker("sess", "嗯……");
      expect(r2.speaker).toBe("unknown");
      expect(r2.speakerLabel).toBeUndefined();
    } finally {
      core.close();
    }
  });
});
