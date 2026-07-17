/**
 * WP3 §3 多輪研究：`runDeepRounds` 的「一輪無新增事實即提早停」。
 * 用假 DeepResearcher：round 1 帶回新來源；後續輪帶回**相同**來源（0 新）→ 應在該輪後停，不跑滿 rounds。
 */
import { describe, it, expect } from "vitest";
import { runDeepRounds } from "./deep-rounds.js";
import type { DeepResearcher, DeepResearchBundle, DeepResearchInput } from "./deep-research.js";

function bundleWith(urls: string[]): DeepResearchBundle {
  return {
    groundedFindings: urls.map((u, i) => ({ angle: "overview", query: `q${i}`, answer: "a", citations: [{ title: u, url: u }] })),
    sourceTexts: urls.map((u) => ({ url: u, title: u, text: "some source text body" })),
    citationUrls: urls,
  };
}

describe("runDeepRounds early-stop", () => {
  it("stops after a round that adds no new facts (does not run all rounds)", async () => {
    let calls = 0;
    const researcher: DeepResearcher = {
      async research(_input: DeepResearchInput): Promise<DeepResearchBundle> {
        calls++;
        // 每輪都回相同兩個來源 → round 2 起 0 新事實。
        return bundleWith(["https://a.example/1", "https://b.example/2"]);
      },
    };
    const res = await runDeepRounds(researcher, { companyName: "Acme" }, {
      rounds: 3,
      buildFollowUps: () => [{ angle: "overview", query: "deeper" }], // 一律有 follow-up，強制進 round 2
    });
    // round 1 跑基礎、round 2 跑 follow-up 但 0 新 → 提早停於第 2 輪。第 3 輪不跑。
    expect(calls).toBe(2);
    expect(res.rounds).toBe(2);
    expect(res.bundle.sourceTexts).toHaveLength(2); // 去重後只有 2 個來源
  });

  it("runs subsequent rounds while new facts keep arriving", async () => {
    let calls = 0;
    const researcher: DeepResearcher = {
      async research(): Promise<DeepResearchBundle> {
        calls++;
        return bundleWith([`https://x.example/${calls}`]); // 每輪都是新來源
      },
    };
    const res = await runDeepRounds(researcher, { companyName: "Acme" }, {
      rounds: 3,
      buildFollowUps: () => [{ angle: "overview", query: "more" }],
    });
    expect(calls).toBe(3); // 一路有新事實 → 跑滿 3 輪
    expect(res.bundle.sourceTexts).toHaveLength(3);
  });

  it("整場預算已到期 → 不開第 2 輪（round 1 仍跑，budget 是整場非每輪）", async () => {
    let calls = 0;
    const researcher: DeepResearcher = {
      async research(): Promise<DeepResearchBundle> {
        calls++;
        return bundleWith([`https://z.example/${calls}`]); // 每輪都是新來源 → 排除「無新事實」提早停，只由預算閘門停
      },
    };
    const res = await runDeepRounds(researcher, { companyName: "Acme" }, {
      rounds: 3,
      budgetMs: 0, // 整場預算 0 → 開場 deadline 即到；round 1 一律跑，round 2 起被閘門擋下
      buildFollowUps: () => [{ angle: "overview", query: "deeper" }], // 一律有 follow-up（證明是預算而非缺口停）
    });
    expect(calls).toBe(1);
    expect(res.rounds).toBe(1);
  });

  it("stops when gap analysis yields no follow-ups", async () => {
    let calls = 0;
    const researcher: DeepResearcher = {
      async research(): Promise<DeepResearchBundle> {
        calls++;
        return bundleWith([`https://y.example/${calls}`]);
      },
    };
    const res = await runDeepRounds(researcher, { companyName: "Acme" }, {
      rounds: 3,
      buildFollowUps: () => [], // 無缺口 → round 1 後即停
    });
    expect(calls).toBe(1);
    expect(res.rounds).toBe(1);
  });
});
