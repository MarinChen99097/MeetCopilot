/**
 * conversion-job 單元測試（契約 §10）：以「注入 mock 點陣化 + 假 core」驗 job 狀態流轉與原始頁 spec 生成，
 * 不真的呼叫 soffice/pdftoppm（本機無此二 bin，真轉檔在 Docker E2E 驗）。
 */
import { describe, it, expect } from "vitest";
import type { CrmCore } from "@meetcopilot/crm";
import type { DeckSlideKind, SlideSpec } from "@meetcopilot/shared";
import { runConversionJob, type ConversionDeps } from "./conversion-job.js";
import { RasterizeError } from "./deck-rasterize.js";

interface AppendCall {
  spec: SlideSpec;
  kind?: DeckSlideKind;
  assetId?: string;
}
interface InsertCall {
  kind: string;
  pageIndex?: number;
  mime: string;
  byteLen: number;
}

/** 假 CrmCore（只實作 conversion-job 用到的方法），並記錄所有呼叫供斷言。 */
function makeFakeCore(source: { mime: string; bytes: Buffer } | null) {
  const jobStatuses: { status: string; error?: string }[] = [];
  const importStatuses: { status: string; error?: string }[] = [];
  const inserts: InsertCall[] = [];
  const appends: AppendCall[] = [];
  let originalCount: number | undefined;
  let assetSeq = 0;

  const core = {
    importJobs: {
      setJobStatus: async (_jobId: string, status: string, error?: string) => {
        jobStatuses.push({ status, error });
      },
    },
    deckAssets: {
      getSourceAsset: async (_deckId: string) =>
        source ? { assetId: "src-1", mime: source.mime, bytes: source.bytes } : null,
      insertAsset: async (input: { kind: string; pageIndex?: number; mime: string; bytes: Buffer }) => {
        inserts.push({ kind: input.kind, pageIndex: input.pageIndex, mime: input.mime, byteLen: input.bytes.length });
        assetSeq += 1;
        return `asset-${assetSeq}`;
      },
    },
    decks: {
      appendSlide: async (
        _orgId: string,
        _deckId: string,
        spec: SlideSpec,
        opts?: { kind?: DeckSlideKind; assetId?: string },
      ) => {
        appends.push({ spec, kind: opts?.kind, assetId: opts?.assetId });
        return { idx: appends.length - 1 };
      },
      setOriginalCount: async (_deckId: string, n: number) => {
        originalCount = n;
      },
      setImportStatus: async (_deckId: string, status: string, error?: string) => {
        importStatuses.push({ status, error });
      },
    },
  } as unknown as CrmCore;

  return {
    core,
    calls: {
      get jobStatuses() {
        return jobStatuses;
      },
      get importStatuses() {
        return importStatuses;
      },
      get inserts() {
        return inserts;
      },
      get appends() {
        return appends;
      },
      get originalCount() {
        return originalCount;
      },
    },
  };
}

const PDF_MIME = "application/pdf";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

describe("runConversionJob — success", () => {
  it("pdf: N images → N page_image assets + N locked original image-full slides → ready/done", async () => {
    const pages = [Buffer.from("png-a"), Buffer.from("png-b"), Buffer.from("png-c")];
    const deps: ConversionDeps = {
      rasterizePdfToImages: async () => pages,
      rasterizePptxToImages: async () => {
        throw new Error("should not be called for pdf");
      },
    };
    const { core, calls } = makeFakeCore({ mime: PDF_MIME, bytes: Buffer.from("%PDF-1.7 ...") });

    await runConversionJob(core, "deck-1", "org-1", "job-1", deps);

    // job 狀態流轉：running → done（無 failed）。
    expect(calls.jobStatuses.map((s) => s.status)).toEqual(["running", "done"]);
    expect(calls.importStatuses.map((s) => s.status)).toEqual(["ready"]);
    expect(calls.originalCount).toBe(3);

    // 逐頁 page_image：pageIndex 0/1/2、image/png、byte 長度＝各頁。
    expect(calls.inserts).toEqual([
      { kind: "page_image", pageIndex: 0, mime: "image/png", byteLen: pages[0]!.length },
      { kind: "page_image", pageIndex: 1, mime: "image/png", byteLen: pages[1]!.length },
      { kind: "page_image", pageIndex: 2, mime: "image/png", byteLen: pages[2]!.length },
    ]);

    // 逐頁原始頁：kind='original'、assetId 對齊、spec＝image-full + image block(asset:<id>)、source='pdf'。
    expect(calls.appends).toHaveLength(3);
    calls.appends.forEach((a, i) => {
      expect(a.kind).toBe("original");
      expect(a.assetId).toBe(`asset-${i + 1}`);
      expect(a.spec.template).toBe("image-full");
      expect(a.spec.source).toBe("pdf");
      expect(a.spec.blocks).toEqual([{ type: "image", dataUri: `asset:asset-${i + 1}` }]);
      expect(typeof a.spec.id).toBe("string");
    });
  });

  it("pptx: routes to pptx rasterizer and stamps source='pptx'", async () => {
    const deps: ConversionDeps = {
      rasterizePptxToImages: async () => [Buffer.from("png")],
      rasterizePdfToImages: async () => {
        throw new Error("should not be called for pptx");
      },
    };
    const { core, calls } = makeFakeCore({ mime: PPTX_MIME, bytes: Buffer.from("PK\x03\x04...") });

    await runConversionJob(core, "deck-2", "org-1", "job-2", deps);

    expect(calls.jobStatuses.map((s) => s.status)).toEqual(["running", "done"]);
    expect(calls.appends[0]!.spec.source).toBe("pptx");
    expect(calls.originalCount).toBe(1);
  });
});

describe("runConversionJob — failure", () => {
  it("rasterize throws RasterizeError → import_status/job both 'failed' with the human message", async () => {
    const msg = "簡報轉檔逾時，檔案可能過大或過於複雜，請精簡後再試";
    const deps: ConversionDeps = {
      rasterizePdfToImages: async () => {
        throw new RasterizeError(msg);
      },
      rasterizePptxToImages: async () => [],
    };
    const { core, calls } = makeFakeCore({ mime: PDF_MIME, bytes: Buffer.from("%PDF") });

    await runConversionJob(core, "deck-3", "org-1", "job-3", deps);

    expect(calls.jobStatuses.map((s) => s.status)).toEqual(["running", "failed"]);
    expect(calls.jobStatuses.at(-1)!.error).toBe(msg);
    expect(calls.importStatuses).toEqual([{ status: "failed", error: msg }]);
    expect(calls.appends).toHaveLength(0);
    expect(calls.originalCount).toBeUndefined();
  });

  it("missing source asset → failed (no pages built)", async () => {
    const deps: ConversionDeps = {
      rasterizePdfToImages: async () => [Buffer.from("x")],
      rasterizePptxToImages: async () => [Buffer.from("x")],
    };
    const { core, calls } = makeFakeCore(null);

    await runConversionJob(core, "deck-4", "org-1", "job-4", deps);

    expect(calls.importStatuses.map((s) => s.status)).toEqual(["failed"]);
    expect(calls.jobStatuses.map((s) => s.status)).toEqual(["running", "failed"]);
    expect(calls.appends).toHaveLength(0);
  });

  it("zero pages → failed", async () => {
    const deps: ConversionDeps = {
      rasterizePdfToImages: async () => [],
      rasterizePptxToImages: async () => [],
    };
    const { core, calls } = makeFakeCore({ mime: PDF_MIME, bytes: Buffer.from("%PDF") });

    await runConversionJob(core, "deck-5", "org-1", "job-5", deps);

    expect(calls.importStatuses.map((s) => s.status)).toEqual(["failed"]);
    expect(calls.appends).toHaveLength(0);
  });
});
