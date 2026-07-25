/**
 * A3 對練情境模式——TrainingRepository 落庫/讀取測試（vitest, in-memory）：
 *  - createSession 落 `mode`（顯式值＋預設 'sales'）；mapSession 讀回 mode。
 *  - mapReport 向後相容：舊 legacy object scores_json → 依 TRAIN_MODES.sales.dimensions 轉 labeled 陣列；
 *    新 labeled 陣列 → 直通。
 */
import { describe, it, expect } from "vitest";
import { createCrmCore } from "./core.js";
import type { CrmCore } from "./ports.js";
import { TRAIN_MODES } from "@meetcopilot/shared";

async function seed(): Promise<{ core: CrmCore; contactId: string }> {
  const core = await createCrmCore(":memory:");
  await core.migrate();
  const co = await core.companies.create("o1", { name: "Acme" });
  const c = await core.contacts.create("o1", co.id, { fullName: "Jane" });
  return { core, contactId: c.id };
}

describe("createSession — 落對練情境模式 mode（A3）", () => {
  it("顯式 mode 落庫並讀回；省略時預設 'sales'", async () => {
    const { core, contactId } = await seed();

    const s = await core.training.createSession("o1", { contactId, mode: "interview" });
    expect(s.mode).toBe("interview");
    const found = await core.training.findSession("o1", s.id);
    expect(found?.mode).toBe("interview");

    const s2 = await core.training.createSession("o1", { contactId });
    expect(s2.mode).toBe("sales"); // 省略 → 預設 sales（回歸：既有行為不變）
    const found2 = await core.training.findSession("o1", s2.id);
    expect(found2?.mode).toBe("sales");

    await core.close();
  });
});

describe("mapReport — scores_json 向後相容（A3）", () => {
  it("舊 legacy object {objectionHandling,discovery,clarity,closing} → 依 sales.dimensions label 依序轉陣列", async () => {
    const { core } = await seed();
    const salesLabels = TRAIN_MODES.sales.dimensions.map((d) => d.label);

    await core.db.run(
      `INSERT INTO training_reports (id, org_id, session_id, scores_json, highlights_json, summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        "rep-legacy",
        "o1",
        "sess-legacy",
        JSON.stringify({ objectionHandling: 80, discovery: 60, clarity: 70, closing: 50 }),
        JSON.stringify([]),
        "舊報告摘要",
        Date.now(),
      ],
    );

    const rep = await core.training.findReport("o1", "rep-legacy");
    expect(rep?.scores).toEqual([
      { label: salesLabels[0], score: 80 }, // 異議處理
      { label: salesLabels[1], score: 60 }, // 需求挖掘
      { label: salesLabels[2], score: 70 }, // 清晰度
      { label: salesLabels[3], score: 50 }, // 收尾
    ]);
    expect(rep?.summary).toBe("舊報告摘要");

    await core.close();
  });

  it("新 labeled 陣列 scores_json → 直通（不轉換）", async () => {
    const { core } = await seed();
    const arr = [
      { label: "表達溝通", score: 90 },
      { label: "專業深度", score: 40 },
      { label: "情境反應", score: 55 },
    ];

    await core.db.run(
      `INSERT INTO training_reports (id, org_id, session_id, scores_json, highlights_json, summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["rep-new", "o1", "sess-new", JSON.stringify(arr), JSON.stringify([]), "新報告", Date.now()],
    );

    const rep = await core.training.findReport("o1", "rep-new");
    expect(rep?.scores).toEqual(arr); // 陣列直通、順序保留

    await core.close();
  });
});
