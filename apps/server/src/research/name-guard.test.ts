/**
 * guardHumanCompanyName（P2-8）：研究結果落庫前，人工建立/確認的 company.name 不被爬蟲覆寫。
 * 對齊 crm/provenance-write 的 isTrusted（human 或 verified），並補「建檔無 provenance ⇒ 人工」的缺口。
 */
import { describe, it, expect } from "vitest";
import type { CrawlPayload } from "@meetcopilot/shared";
import { guardHumanCompanyName } from "./orchestrator.js";

const payloadWithName = (name: string): CrawlPayload => ({
  company: { name, industry: "SaaS" },
  provenance: [
    { fieldName: "name", value: name },
    { fieldName: "industry", value: "SaaS" },
  ],
});

describe("guardHumanCompanyName", () => {
  it("protects a human-created name that has NO provenance row (create writes none)", () => {
    const p = payloadWithName("Example Domain"); // 爬回的英文名
    guardHumanCompanyName(p, "測試科技股份有限公司", undefined);
    expect("name" in p.company).toBe(false); // name 不落庫 → 保留原中文名
    expect(p.provenance.some((x) => x.fieldName === "name")).toBe(false);
    expect(p.company.industry).toBe("SaaS"); // 其他欄位照常覆寫
    expect(p.provenance.some((x) => x.fieldName === "industry")).toBe(true);
  });

  it("protects a name last set by a human (filled_by='human')", () => {
    const p = payloadWithName("Example Domain");
    guardHumanCompanyName(p, "台積電", { filledBy: "human", verified: 1 });
    expect("name" in p.company).toBe(false);
    expect(p.provenance.some((x) => x.fieldName === "name")).toBe(false);
  });

  it("protects a crawler name that a human has verified (verified=1)", () => {
    const p = payloadWithName("Example Domain");
    guardHumanCompanyName(p, "鴻海精密", { filledBy: "crawler", verified: 1 });
    expect("name" in p.company).toBe(false);
  });

  it("allows re-crawl to update a crawler-origin name (filled_by='crawler', not verified)", () => {
    const p = payloadWithName("Acme Corp");
    guardHumanCompanyName(p, "Acme", { filledBy: "crawler", verified: 0 });
    expect(p.company.name).toBe("Acme Corp"); // 既有名本就來自爬蟲 → 允許更新
    expect(p.provenance.some((x) => x.fieldName === "name")).toBe(true);
  });

  it("allows a new company (no existing name) to be named by the crawler", () => {
    const p = payloadWithName("Newly Found Inc");
    guardHumanCompanyName(p, undefined, undefined);
    expect(p.company.name).toBe("Newly Found Inc");
    guardHumanCompanyName(p, "   ", undefined); // 空白名視同無
    expect(p.company.name).toBe("Newly Found Inc");
  });
});
