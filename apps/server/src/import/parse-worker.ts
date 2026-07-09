/**
 * 匯入解析 worker thread 入口（契約 C2）。由 run-in-worker.ts spawn。
 *
 * 關鍵：本檔「不」靜態 import 解析器。Node 22.18+ 原生 type-stripping 在 worker 內取代 tsx，靜態 import
 * 在 dev 會 ERR_MODULE_NOT_FOUND。改用「帶顯式副檔名」的動態 import（副檔名由 run-in-worker 經 workerData.ext 傳入）：
 * dev → "./pptx-parser.ts"、prod → "./pptx-parser.js"。解析器對 @meetcopilot/shared 只有 `import type`（執行期被抹除），
 * 故 worker 內即使不經 tsconfig paths 解析也能載入。
 */
import { parentPort, workerData } from "node:worker_threads";
import type { SlideSpec } from "@meetcopilot/shared";

interface WorkerData {
  ext: "ts" | "js";
  task: "pptx" | "pdf" | "pdf-extract";
  buffer: ArrayBuffer;
}

async function run(): Promise<unknown> {
  const { ext, task, buffer } = workerData as WorkerData;
  // transfer 過來的 ArrayBuffer 正好是這段位元組（整份或精確切片），直接包成 Buffer。
  const buf = Buffer.from(buffer);

  if (task === "pptx") {
    const mod = (await import("./pptx-parser." + ext)) as { parsePptx: (b: Buffer) => Promise<SlideSpec[]> };
    return mod.parsePptx(buf);
  }
  if (task === "pdf") {
    const mod = (await import("./pdf-parser." + ext)) as { parsePdf: (b: Buffer) => Promise<SlideSpec[]> };
    return mod.parsePdf(buf);
  }
  // pdf-extract：抽純文字（供 grounding），非 1:1 匯入成頁。
  const mod = (await import("./extract." + ext)) as { extractFromPdf: (b: Buffer) => Promise<{ text: string }> };
  return mod.extractFromPdf(buf);
}

run()
  .then((result) => parentPort?.postMessage({ ok: true, result }))
  .catch((err: unknown) =>
    parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
