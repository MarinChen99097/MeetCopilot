/**
 * WP4.1 §4.1 嵌入索引管線：`buildCompanyIndex` 冪等——重跑不讓 embeddings 列數翻倍（content_hash 去重）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createCrmCore } from "@meetcopilot/crm";
import type { CrmCore } from "@meetcopilot/crm";
import { buildCompanyIndex } from "./indexer.js";

let core: CrmCore;
const ORG = "org-idx";

// 假 embed：回固定維度向量（內容決定 hash，非向量）；計呼叫次數以驗「未變即免 embed」。
function makeEmbed() {
  let calls = 0;
  const fn = async (_text: string): Promise<number[]> => {
    calls++;
    return [0.1, 0.2, 0.3];
  };
  return { fn, get calls() { return calls; } };
}

async function countEmbeddings(): Promise<number> {
  const row = await core.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM embeddings WHERE org_id = ?", [ORG]);
  return row?.n ?? 0;
}

beforeEach(async () => {
  core = await createCrmCore(":memory:");
  await core.migrate();
  await core.db.run("INSERT INTO orgs (id, name, default_locale, created_at) VALUES (?, ?, ?, ?)", [
    ORG,
    "Idx Seller",
    "zh-TW",
    Date.now(),
  ]);
});

afterEach(() => core.close());

describe("buildCompanyIndex idempotency", () => {
  it("re-running does not double the embeddings row count", async () => {
    const company = await core.companies.create(ORG, {
      name: "Indexed Co",
      description: "A B2B company that makes widgets for enterprises.",
      descriptionZh: "一家做企業級小工具的 B2B 公司。",
    });
    await core.notes.upsertSingletonNote(ORG, {
      entityType: "company",
      entityId: company.id,
      noteType: "narrative",
      body: "## AI 敘事\n\n這家公司的敘事內容。",
      pinned: true,
    });

    const embed1 = makeEmbed();
    const r1 = await buildCompanyIndex({ core, embed: embed1.fn, embedModel: "test-embed" }, ORG, company.id);
    const after1 = await countEmbeddings();
    expect(after1).toBeGreaterThan(0);
    expect(r1.chunks).toBe(after1); // 每 chunk 一列（首次全部寫入）
    expect(embed1.calls).toBe(after1); // 首次每 chunk 都 embed

    const embed2 = makeEmbed();
    await buildCompanyIndex({ core, embed: embed2.fn, embedModel: "test-embed" }, ORG, company.id);
    const after2 = await countEmbeddings();

    expect(after2).toBe(after1); // 列數不翻倍（冪等）
    expect(embed2.calls).toBe(0); // 內容未變 → 連 embed 都省
  });

  it("shrinking content removes stale high-index chunks (no residual past new chunk count)", async () => {
    // 首建：長 description（>CHUNK_CHARS）→ company_card 至少 2 chunk。
    const longDesc = "A".repeat(1500); // 無換行/空白 → chunkText 在 1000 邊界硬切 → chunk0(1000)+chunk1(500)
    const company = await core.companies.create(ORG, { name: "Shrink Co", description: longDesc });
    await buildCompanyIndex({ core, embed: async () => [1, 2, 3], embedModel: "test-embed" }, ORG, company.id);

    const before = await core.db.all<{ chunk_index: number }>(
      "SELECT chunk_index FROM embeddings WHERE org_id = ? AND entity_type = 'company_card' AND entity_id = ? ORDER BY chunk_index",
      [ORG, company.id],
    );
    expect(before.length).toBeGreaterThanOrEqual(2); // 確認前置：確有 2+ chunk

    // 內容縮短 → 只剩 1 chunk；重建後高 index 舊 chunk 必須被刪，不得殘留。
    await core.companies.update(ORG, company.id, { description: "short" }, { userId: "tester" });
    await buildCompanyIndex({ core, embed: async () => [1, 2, 3], embedModel: "test-embed" }, ORG, company.id);

    const after = await core.db.all<{ chunk_index: number }>(
      "SELECT chunk_index FROM embeddings WHERE org_id = ? AND entity_type = 'company_card' AND entity_id = ? ORDER BY chunk_index",
      [ORG, company.id],
    );
    expect(after).toHaveLength(1); // 殘留 chunk_index=1 已刪
    expect(after[0]?.chunk_index).toBe(0);
  });

  it("indexes company_card + note with source-row entity ids (retrieval whitelist alignment)", async () => {
    const company = await core.companies.create(ORG, { name: "Co", description: "desc" });
    const note = await core.notes.upsertSingletonNote(ORG, {
      entityType: "company",
      entityId: company.id,
      noteType: "observations",
      body: "- 一條未歸類情報（[來源](https://x.example)）",
    });
    await buildCompanyIndex({ core, embed: async () => [1, 2, 3], embedModel: "test-embed" }, ORG, company.id);

    const rows = await core.db.all<{ entity_type: string; entity_id: string }>(
      "SELECT entity_type, entity_id FROM embeddings WHERE org_id = ?",
      [ORG],
    );
    // company_card → companyId；note → note.id（會中檢索白名單以來源 row id 過濾，見 realtime/retrieval.ts）。
    expect(rows.some((r) => r.entity_type === "company_card" && r.entity_id === company.id)).toBe(true);
    expect(rows.some((r) => r.entity_type === "note" && r.entity_id === note.id)).toBe(true);
  });
});
