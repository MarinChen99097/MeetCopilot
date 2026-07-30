/**
 * C2 匯入抽字驗收（MEETING_CHECKLIST_CONTRACT §11；vitest）。
 * 覆蓋：
 *  1. parsePptxText 對「重排過」的 pptx（真實 zip fixture：檔名序 ≠ sldIdLst 播放序）→ 輸出跟 sldIdLst 走；
 *     解不出 sldIdLst／rId 缺 rel → null（對齊無效訊號）。
 *  2. pdf 索引鍵收集：單頁失敗 → 空字串佔位不位移（assemblePdfPages）＋ 真實 PDF（pdf-lib 2 頁）整條 parsePdfText。
 *  3. 數量守門：解析頁數 ≠ 原始頁數 → 整份丟棄、一頁都不寫。
 *  4. 讀圖上限：>20 頁待讀 → 只讀 20、其餘留 NULL（mock gemini 數呼叫次數）。
 *  5. 回填冪等：已有 text_extract 的頁不重寫；native deck 回 not-needed；同 deck 併發第二發 no-op。
 *  6. 抽字失敗不影響匯入：extractText throw → deck 仍 ready、job done。
 *  7. 計費：mock meter 斷言讀圖呼叫落 gemini_extract、orgId/userId/idemPrefix 正確。
 *  8. 三態負結果標記（§11.1 v1.4）：讀圖回空寫 ''、第二輪零呼叫（收斂）、>20 頁第二輪輪到後段（飢餓解除）、
 *     回應缺 text 欄位＝失敗留 NULL（不寫負標記）。
 * （setSlideTextExtract 的 org 隔離／committed·original 照寫在 packages/crm/test/deck-text-extract.test.ts。）
 */
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import type { CrmCore } from "@meetcopilot/crm";
import type { DeckSlide, SlideSpec, UsageKind } from "@meetcopilot/shared";
import { parsePptxText } from "./pptx-parser.js";
import { parsePdfText, assemblePdfPages } from "./pdf-parser.js";
import { runTextExtract, maybeStartTextExtract, type TextExtractDeps } from "./text-extract.js";
import { runConversionJob } from "./conversion-job.js";
import type { GeminiClient } from "../gemini.js";
import type { Meter, MeterResult } from "../ops/meter.js";

// ─────────────────────────────────────────────────────────────
// fixtures / fakes
// ─────────────────────────────────────────────────────────────

const SLIDE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";

function slideXml(text: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"` +
    ` xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<p:cSld><p:spTree>` +
    `<p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>` +
    `</p:spTree></p:cSld></p:sld>`
  );
}

/**
 * 手工構造 pptx zip fixture（契約測試 1）：slideN.xml 檔名序 ≠ sldIdLst 播放序。
 * sldIdLst＝[rId2→slide2.xml, rId1→slide1.xml]——播放序是 slide2 先講。
 */
async function buildReorderedPptx(opts: { withSldIdLst?: boolean; dropRel?: boolean } = {}): Promise<Buffer> {
  const { withSldIdLst = true, dropRel = false } = opts;
  const zip = new JSZip();
  const sldIdLst = withSldIdLst
    ? `<p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst>`
    : "";
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"` +
      ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${sldIdLst}</p:presentation>`,
  );
  const rels = [
    `<Relationship Id="rId1" Type="${SLIDE_REL_TYPE}" Target="slides/slide1.xml"/>`,
    ...(dropRel ? [] : [`<Relationship Id="rId2" Type="${SLIDE_REL_TYPE}" Target="slides/slide2.xml"/>`]),
  ].join("");
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
  );
  zip.file("ppt/slides/slide1.xml", slideXml("檔名一號頁的內容文字"));
  zip.file("ppt/slides/slide2.xml", slideXml("檔名二號頁的內容文字"));
  return zip.generateAsync({ type: "nodebuffer" });
}

/**
 * 手工構造最小 2 頁 PDF（真實 fixture；傳統 xref table＋Helvetica，pdf-parse 內建 pdf.js v1.10 可讀）。
 * 位移程式化計算（xref entry 恆 20 bytes：10 位 offset＋空格＋5 位 gen＋空格＋n＋空格＋\n）。
 */
function buildTwoPagePdf(text1: string, text2: string): Buffer {
  const objs: string[] = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>";
  objs[3] =
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>";
  objs[4] =
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>";
  objs[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  const s1 = `BT /F1 24 Tf 72 700 Td (${text1}) Tj ET`;
  const s2 = `BT /F1 24 Tf 72 700 Td (${text2}) Tj ET`;
  objs[6] = `<< /Length ${s1.length} >>\nstream\n${s1}\nendstream`;
  objs[7] = `<< /Length ${s2.length} >>\nstream\n${s2}\nendstream`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let i = 1; i <= 7; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefPos = out.length;
  out += "xref\n0 8\n0000000000 65535 f \n";
  for (let i = 1; i <= 7; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

interface WriteCall {
  orgId: string;
  deckId: string;
  idx: number;
  text: string;
}

/** 管線用假 CrmCore：可設定 deck 樣態＋slides，記錄所有 setSlideTextExtract。 */
function makePipelineCore(opts: {
  sourceKind: "pptx" | "pdf" | "native";
  importStatus?: string;
  originalCount: number;
  /** 每頁的既有 textExtract（undefined＝空）；長度＝originalCount。 */
  existing?: (string | undefined)[];
  sourceMime?: string;
  hasSource?: boolean;
}): { core: CrmCore; writes: WriteCall[] } {
  const writes: WriteCall[] = [];
  const slides: DeckSlide[] = Array.from({ length: opts.originalCount }, (_, i) => ({
    id: `s-${i}`,
    orgId: "org-1",
    deckId: "deck-x",
    idx: i,
    spec: {
      id: `spec-${i}`,
      template: "image-full",
      blocks: [{ type: "image", dataUri: `asset:a-${i}` }],
      source: opts.sourceKind === "pdf" ? "pdf" : "pptx",
    } as SlideSpec,
    createdAt: 0,
    kind: "original",
    textExtract: opts.existing?.[i],
  }));
  const deck = {
    id: "deck-x",
    sourceKind: opts.sourceKind,
    importStatus: opts.importStatus ?? "ready",
    originalCount: opts.originalCount,
    committedIndex: -1,
  };
  const core = {
    decks: {
      findWithSlides: async (_orgId: string, _deckId: string) => ({ deck, slides }),
      setSlideTextExtract: async (orgId: string, deckId: string, idx: number, text: string) => {
        writes.push({ orgId, deckId, idx, text });
        // 有狀態假 DB：寫入反映到 slides，讓「第二輪」測試（三態收斂／飢餓解除）看得到上一輪結果。
        slides[idx]!.textExtract = text;
      },
    },
    deckAssets: {
      getSourceAsset: async () =>
        (opts.hasSource ?? true)
          ? { assetId: "src", mime: opts.sourceMime ?? "application/pdf", bytes: Buffer.from("src") }
          : null,
      getPageImage: async (_orgId: string, _deckId: string, pageIndex: number) =>
        Buffer.from(`png-${pageIndex}`),
    },
  } as unknown as CrmCore;
  return { core, writes };
}

/** 假 Gemini client（讀圖 fallback 用）：計呼叫次數；metered 路徑（generateJsonMetered）同源。 */
function makeFakeGemini(opts: { configured?: boolean; text?: string } = {}): {
  gemini: GeminiClient;
  calls: { count: number };
} {
  const calls = { count: 0 };
  const text = opts.text ?? "這是從頁面圖片逐字轉錄出來的文字內容，超過二十個字元的門檻";
  const gemini = {
    isConfigured: () => opts.configured ?? true,
    generateJson: async () => {
      calls.count++;
      return { text };
    },
    generateJsonMetered: async () => {
      calls.count++;
      return { value: { text }, usage: { model: "fake-model", inputTokens: 10, outputTokens: 5 } };
    },
  } as unknown as GeminiClient;
  return { gemini, calls };
}

interface MeterCall {
  orgId: string;
  kind: UsageKind;
  idemKey: string;
  userId?: string;
}

/** 假 Meter：記錄 (orgId, kind, idemKey, userId)，執行 fn 回 result。 */
function makeFakeMeter(): { meter: Meter; calls: MeterCall[] } {
  const calls: MeterCall[] = [];
  const meter: Meter = {
    async meter<T>(
      orgId: string,
      kind: UsageKind,
      fn: () => Promise<MeterResult<T>>,
      idemKey: string,
      userId?: string,
    ): Promise<T> {
      calls.push({ orgId, kind, idemKey, userId });
      const r = await fn();
      return r.result;
    },
  };
  return { meter, calls };
}

async function waitUntil(cond: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("waitUntil timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

// ─────────────────────────────────────────────────────────────
// 1. parsePptxText：頁序權威＝sldIdLst（真實 zip fixture）
// ─────────────────────────────────────────────────────────────

describe("parsePptxText — sldIdLst 播放序權威（契約 §11.2）", () => {
  it("重排過的 pptx（檔名序 ≠ sldIdLst 序）→ 輸出順序跟 sldIdLst 走，不跟檔名", async () => {
    const bytes = await buildReorderedPptx();
    const pages = await parsePptxText(bytes);
    expect(pages).not.toBeNull();
    // sldIdLst＝[rId2→slide2, rId1→slide1]：第 0 頁必須是 slide2 的文字（檔名排序會給出相反結果）。
    expect(pages![0]).toContain("檔名二號頁的內容文字");
    expect(pages![1]).toContain("檔名一號頁的內容文字");
  });

  it("解不出 sldIdLst → null（對齊無效訊號）", async () => {
    const bytes = await buildReorderedPptx({ withSldIdLst: false });
    expect(await parsePptxText(bytes)).toBeNull();
  });

  it("sldIdLst 的 rId 沒有對應 rel → null（對齊無效訊號）", async () => {
    const bytes = await buildReorderedPptx({ dropRel: true });
    expect(await parsePptxText(bytes)).toBeNull();
  });

  it("非 pptx zip（缺 presentation.xml）→ null", async () => {
    const zip = new JSZip();
    zip.file("hello.txt", "not a pptx");
    expect(await parsePptxText(await zip.generateAsync({ type: "nodebuffer" }))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// 2. pdf：索引鍵收集＋單頁失敗佔位
// ─────────────────────────────────────────────────────────────

describe("parsePdfText — 頁索引鍵收集（契約 §11.2）", () => {
  it("assemblePdfPages：單頁失敗（缺鍵）→ 空字串佔位，不位移後續頁", () => {
    const byIndex = new Map<number, string>([
      [0, "第一頁"],
      [2, "第三頁"],
    ]); // 第 1 頁（index 1）失敗被 pdf-parse 靜默吞掉
    expect(assemblePdfPages(byIndex, 3)).toEqual(["第一頁", "", "第三頁"]);
  });

  it("真實 2 頁 PDF（手工構造、傳統 xref）→ 兩頁文字各就各位、長度＝頁數", async () => {
    const bytes = buildTwoPagePdf(
      "Alpha bravo charlie delta echo foxtrot golf",
      "Hotel india juliett kilo lima mike november",
    );
    const pages = await parsePdfText(bytes);
    expect(pages).not.toBeNull();
    expect(pages!).toHaveLength(2);
    expect(pages![0]).toContain("Alpha");
    expect(pages![1]).toContain("Hotel");
    expect(pages![0]).not.toContain("Hotel"); // 不互相污染＝索引鍵沒錯位
  });
});

// ─────────────────────────────────────────────────────────────
// 3. 數量守門：解析頁數 ≠ 原始頁數 → 整份丟棄
// ─────────────────────────────────────────────────────────────

describe("runTextExtract — 數量守門（契約 §11.2）", () => {
  it("解析頁數(2) ≠ 原始頁數(3) → 整份丟棄、一頁都不寫（讀圖未配置 → 全 NULL）", async () => {
    const { core, writes } = makePipelineCore({ sourceKind: "pdf", originalCount: 3 });
    const { gemini } = makeFakeGemini({ configured: false }); // 隔離：讀圖關閉，凡有寫入必來自解析路徑
    const deps: TextExtractDeps = {
      core,
      gemini,
      extractModel: "m",
      parseText: async () => ["這一頁的文字內容絕對超過二十個字元的門檻喔", "第二頁文字也一樣超過二十個字元的門檻喔"], // 只有 2 頁
    };
    await runTextExtract(deps, { orgId: "org-1", deckId: "deck-guard", idemPrefix: "textextract:t3" });
    expect(writes).toHaveLength(0); // 對齊無效：一頁都不寫
  });

  it("解析器回 null（對齊無效）→ 同樣一頁都不寫、全數轉讀圖", async () => {
    const { core, writes } = makePipelineCore({ sourceKind: "pptx", originalCount: 2 });
    const { gemini, calls } = makeFakeGemini();
    const deps: TextExtractDeps = { core, gemini, extractModel: "m", parseText: async () => null };
    await runTextExtract(deps, { orgId: "org-1", deckId: "deck-null", idemPrefix: "textextract:t3b" });
    expect(calls.count).toBe(2); // 全數走讀圖
    expect(writes).toHaveLength(2); // 寫入全部來自讀圖結果
    writes.forEach((w) => expect(w.text).toContain("逐字轉錄"));
  });
});

// ─────────────────────────────────────────────────────────────
// 4. 讀圖上限：>20 頁待讀 → 只讀 20、其餘 NULL
// ─────────────────────────────────────────────────────────────

describe("runTextExtract — 讀圖硬上限（契約 §11.3）", () => {
  it("25 頁全需讀圖 → gemini 只被呼叫 20 次、只寫 20 頁、頁 20–24 留 NULL", async () => {
    const { core, writes } = makePipelineCore({ sourceKind: "pdf", originalCount: 25 });
    const { gemini, calls } = makeFakeGemini();
    const deps: TextExtractDeps = { core, gemini, extractModel: "m", parseText: async () => null };
    await runTextExtract(deps, { orgId: "org-1", deckId: "deck-cap", idemPrefix: "textextract:t4" });

    expect(calls.count).toBe(20); // TEXT_EXTRACT_VISION_MAX_PAGES 預設 20
    expect(writes).toHaveLength(20);
    const writtenIdx = new Set(writes.map((w) => w.idx));
    for (let i = 0; i < 20; i++) expect(writtenIdx.has(i)).toBe(true);
    for (let i = 20; i < 25; i++) expect(writtenIdx.has(i)).toBe(false); // 截斷頁留 NULL
  });
});

// ─────────────────────────────────────────────────────────────
// 5. 回填冪等：fill-empty／native／併發去重
// ─────────────────────────────────────────────────────────────

describe("maybeStartTextExtract / 冪等（契約 §11.5）", () => {
  it("已有 text_extract 的頁不重寫（fill-empty）", async () => {
    const { core, writes } = makePipelineCore({
      sourceKind: "pdf",
      originalCount: 2,
      existing: ["這一頁在上次匯入時已經寫入過逐頁文字了", undefined],
    });
    const { gemini, calls } = makeFakeGemini();
    const deps: TextExtractDeps = {
      core,
      gemini,
      extractModel: "m",
      parseText: async () => ["新解析的第一頁文字超過二十個字元的門檻喔", ""], // 第 0 頁有字也不得重寫
    };
    await runTextExtract(deps, { orgId: "org-1", deckId: "deck-fill", idemPrefix: "textextract:t5" });

    expect(writes.every((w) => w.idx === 1)).toBe(true); // 只動第 1 頁
    expect(writes.filter((w) => w.idx === 0)).toHaveLength(0);
    expect(calls.count).toBe(1); // 第 1 頁解析為空 → 讀圖一次
  });

  it("native deck → not-needed（零工作）；已全有字 → not-needed；匯入未完成 → not-needed", async () => {
    const { gemini } = makeFakeGemini();
    const native = makePipelineCore({ sourceKind: "native", originalCount: 0 });
    expect(
      await maybeStartTextExtract(
        { core: native.core, gemini, extractModel: "m" },
        { orgId: "org-1", deckId: "deck-native", idemPrefix: "textextract:t5b" },
      ),
    ).toBe("not-needed");

    const full = makePipelineCore({
      sourceKind: "pdf",
      originalCount: 1,
      existing: ["已經有完整逐頁文字的頁面不需要再處理"],
    });
    expect(
      await maybeStartTextExtract(
        { core: full.core, gemini, extractModel: "m" },
        { orgId: "org-1", deckId: "deck-full", idemPrefix: "textextract:t5c" },
      ),
    ).toBe("not-needed");

    const processing = makePipelineCore({ sourceKind: "pdf", originalCount: 1, importStatus: "processing" });
    expect(
      await maybeStartTextExtract(
        { core: processing.core, gemini, extractModel: "m" },
        { orgId: "org-1", deckId: "deck-processing", idemPrefix: "textextract:t5d" },
      ),
    ).toBe("not-needed");
  });

  it("同 deck 併發第二發 no-op（in-flight 去重）：parse 只跑一次、寫入不重複", async () => {
    const { core, writes } = makePipelineCore({ sourceKind: "pdf", originalCount: 2 });
    const { gemini } = makeFakeGemini({ configured: false });
    let parseCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const deps: TextExtractDeps = {
      core,
      gemini,
      extractModel: "m",
      parseText: async () => {
        parseCalls++;
        await gate; // 卡住第一發，讓第二發在 in-flight 期間進來
        return ["第一頁解析文字超過二十個字元的門檻沒問題", "第二頁解析文字超過二十個字元的門檻沒問題"];
      },
    };
    const args = { orgId: "org-1", deckId: "deck-conc", idemPrefix: "textextract:t5e" };

    const first = await maybeStartTextExtract(deps, args);
    expect(first).toBe("started");
    const second = await maybeStartTextExtract(deps, args); // 第一發還卡在 parse
    expect(second).toBe("in-flight");

    release();
    await waitUntil(() => writes.length === 2);
    expect(parseCalls).toBe(1); // 第二發完全沒啟動管線
    expect(writes.map((w) => w.idx).sort()).toEqual([0, 1]); // 每頁只寫一次
  });
});

// ─────────────────────────────────────────────────────────────
// 6. 抽字失敗不影響匯入
// ─────────────────────────────────────────────────────────────

describe("conversion-job × 抽字階段（契約 §11.1）", () => {
  function makeJobCore() {
    const jobStatuses: string[] = [];
    const importStatuses: string[] = [];
    const core = {
      importJobs: {
        setJobStatus: async (_j: string, status: string) => {
          jobStatuses.push(status);
        },
      },
      deckAssets: {
        getSourceAsset: async () => ({ assetId: "src", mime: "application/pdf", bytes: Buffer.from("%PDF") }),
        insertAsset: async () => "asset-1",
      },
      decks: {
        appendSlide: async () => ({ idx: 0 }),
        setOriginalCount: async () => {},
        setImportStatus: async (_d: string, status: string) => {
          importStatuses.push(status);
        },
      },
    } as unknown as CrmCore;
    return { core, jobStatuses, importStatuses };
  }

  it("抽字階段 throw → deck 仍 ready、job 仍 done（絕不 failed）", async () => {
    const { core, jobStatuses, importStatuses } = makeJobCore();
    await runConversionJob(core, "deck-e", "org-1", "job-e", {
      rasterizePdfToImages: async () => [Buffer.from("png")],
      rasterizePptxToImages: async () => [Buffer.from("png")],
      extractText: async () => {
        throw new Error("抽字爆炸");
      },
    });
    expect(importStatuses).toEqual(["ready"]); // 沒被改成 failed
    expect(jobStatuses).toEqual(["running", "done"]); // job 主流程不受影響
  });

  it("抽字階段確實在 ready 之後、done 之前被呼叫（deck 先 ready、UX 不變）", async () => {
    const { core, jobStatuses, importStatuses } = makeJobCore();
    let readyBeforeExtract = false;
    let doneBeforeExtract = false;
    await runConversionJob(core, "deck-f", "org-1", "job-f", {
      rasterizePdfToImages: async () => [Buffer.from("png")],
      rasterizePptxToImages: async () => [Buffer.from("png")],
      extractText: async () => {
        readyBeforeExtract = importStatuses.includes("ready");
        doneBeforeExtract = jobStatuses.includes("done");
      },
    });
    expect(readyBeforeExtract).toBe(true); // ready 已發生
    expect(doneBeforeExtract).toBe(false); // done 還沒發生
  });
});

// ─────────────────────────────────────────────────────────────
// 7. 計費：kind='gemini_extract'、orgId/userId/idemPrefix
// ─────────────────────────────────────────────────────────────

describe("runTextExtract — 計費（契約 §11.3）", () => {
  it("讀圖呼叫經 meter：kind=gemini_extract、orgId/userId 正確、idemKey 帶 textextract:<jobId> 前綴", async () => {
    const { core, writes } = makePipelineCore({ sourceKind: "pdf", originalCount: 2 });
    const { gemini } = makeFakeGemini();
    const { meter, calls } = makeFakeMeter();
    const deps: TextExtractDeps = { core, gemini, meter, extractModel: "m", parseText: async () => null };

    await runTextExtract(deps, {
      orgId: "org-billing",
      deckId: "deck-meter",
      userId: "user-importer",
      idemPrefix: "textextract:job-77",
    });

    expect(calls).toHaveLength(2); // 每頁一筆
    for (const c of calls) {
      expect(c.kind).toBe("gemini_extract");
      expect(c.orgId).toBe("org-billing");
      expect(c.userId).toBe("user-importer");
      expect(c.idemKey.startsWith("textextract:job-77:")).toBe(true);
    }
    expect(new Set(calls.map((c) => c.idemKey)).size).toBe(2); // 頁間由 seq 區分（不同 idemKey）
    expect(writes).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────
// 8. 三態負結果標記（契約 §11.1 v1.4）：讀圖回空寫 ''、回填收斂、飢餓解除
// ─────────────────────────────────────────────────────────────

describe("runTextExtract — 三態負結果標記（契約 §11.1 v1.4）", () => {
  it("讀圖回空 → DB 落 ''；第二輪 needsText=false → not-needed、gemini 零新呼叫（收斂）", async () => {
    const { core, writes } = makePipelineCore({ sourceKind: "pdf", originalCount: 3 });
    const { gemini, calls } = makeFakeGemini({ text: "" }); // 純圖無字頁：讀圖轉錄回空字串
    const deps: TextExtractDeps = { core, gemini, extractModel: "m", parseText: async () => null };
    const args = { orgId: "org-1", deckId: "deck-neg", idemPrefix: "textextract:t8" };

    await runTextExtract(deps, args);
    expect(calls.count).toBe(3);
    expect(writes).toHaveLength(3);
    writes.forEach((w) => expect(w.text).toBe("")); // 負結果標記落庫（v1.3 舊語意：這裡是 0 筆＝留 NULL）

    // 第二輪：'' 算「已有結果」→ 全部跳過。v1.3 舊語意這裡會再燒 3 次讀圖、永不收斂。
    expect(await maybeStartTextExtract(deps, args)).toBe("not-needed");
    await runTextExtract(deps, args); // 就算硬跑管線也零工作
    expect(calls.count).toBe(3); // 第二輪 gemini 呼叫數 = 0
    expect(writes).toHaveLength(3); // 也沒有任何重寫
  });

  it("25 頁全空 deck：第一輪讀前 20 頁寫 ''，第二輪自動輪到 21–25 頁（飢餓解除）", async () => {
    const { core, writes } = makePipelineCore({ sourceKind: "pdf", originalCount: 25 });
    const { gemini, calls } = makeFakeGemini({ text: "" });
    const deps: TextExtractDeps = { core, gemini, extractModel: "m", parseText: async () => null };
    const args = { orgId: "org-1", deckId: "deck-starve", idemPrefix: "textextract:t9" };

    // 第一輪：硬上限 20 → 只讀 idx 0–19，全部寫 ''。
    await runTextExtract(deps, args);
    expect(calls.count).toBe(20);
    expect(writes.map((w) => w.idx).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));

    // 第二輪：0–19 已有負標記被跳過 → 候選只剩 20–24（v1.3 舊語意：slice 又取同樣前 20 頁＝20–24 永久飢餓）。
    const firstRound = writes.length;
    await runTextExtract(deps, args);
    expect(writes.slice(firstRound).map((w) => w.idx).sort((a, b) => a - b)).toEqual([20, 21, 22, 23, 24]);
    expect(calls.count).toBe(25); // 第二輪只多 5 次（不重讀 0–19）

    // 第三輪：25 頁全有結果 → 完全收斂（零呼叫、零寫入）。
    expect(await maybeStartTextExtract(deps, args)).toBe("not-needed");
    await runTextExtract(deps, args);
    expect(calls.count).toBe(25);
    expect(writes).toHaveLength(25);
  });

  it("讀圖回應缺 text 欄位（非字串）→ 該頁留 NULL 不寫負標記（失敗 ≠ 確認無字，下一輪可重試）", async () => {
    const { core, writes } = makePipelineCore({ sourceKind: "pdf", originalCount: 2 });
    const gemini = {
      isConfigured: () => true,
      generateJson: async () => ({}), // 回應缺 text 欄位
    } as unknown as GeminiClient;
    const deps: TextExtractDeps = { core, gemini, extractModel: "m", parseText: async () => null };
    await runTextExtract(deps, { orgId: "org-1", deckId: "deck-malformed", idemPrefix: "textextract:t10" });
    expect(writes).toHaveLength(0); // 一頁都不寫（留 NULL）——只有「真的回空字串」才有資格寫 ''
  });
});
