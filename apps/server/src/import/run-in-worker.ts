/**
 * 匯入解析的可終止 worker 封裝（契約 C2）。
 * 把 CPU 密集又可能被惡意輸入拖住的解析（pptx/pdf）丟到 worker thread，逾時可強制 terminate，
 * 主執行緒（express 請求）不被卡死。parsePptx 內建 zip-bomb 位元組上限；worker 再加一層「時間」上限。
 *
 * WORKER 載入（關鍵，姊妹專案已驗證）：Node 22.18+ 的原生 TypeScript type-stripping 會在 worker thread 內
 * 「取代」tsx，導致 worker 內用「靜態 import 解析器」在 dev 會 ERR_MODULE_NOT_FOUND。
 * 解法：本檔以 __filename 的副檔名推導 ext（.ts→"ts"／.js→"js"），spawn 對應副檔名的 parse-worker，
 * 並把 ext 經 workerData 傳給 worker；parse-worker「不」靜態 import 解析器，改用「帶顯式副檔名」的動態 import。
 * dev（tsx）走 .ts、prod（node dist）走 .js，兩者皆可。
 */
import { Worker } from "node:worker_threads";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type ImportTask = "pptx" | "pdf" | "pdf-extract";

interface WorkerOk<T> {
  ok: true;
  result: T;
}
interface WorkerErr {
  ok: false;
  error: string;
}
type WorkerMessage<T> = WorkerOk<T> | WorkerErr;

/**
 * 在 worker thread 執行匯入解析。逾時會 worker.terminate() 並 reject(new Error("匯入解析逾時"))
 * （decks catch 會把含「逾時」的訊息映射成 HTTP 408）。
 * @param task     解析種類（pptx / pdf → SlideSpec[]；pdf-extract → { text }）。
 * @param buf      原始檔位元組。
 * @param timeoutMs 逾時毫秒；到期強制終止 worker。
 */
export function runInWorker<T>(task: ImportTask, buf: Buffer, timeoutMs: number): Promise<T> {
  const ext = __filename.endsWith(".ts") ? "ts" : "js";
  const workerPath = path.join(__dirname, "parse-worker." + ext);

  return new Promise<T>((resolve, reject) => {
    // ArrayBuffer 傳遞：只有「buf 剛好等於整個底層 ArrayBuffer」時才 zero-copy transfer（transfer 後主執行緒該
    // buffer 會 detach）；否則精確切出這段位元組的副本再 transfer（避免把整個共享 pool 都送走或誤傳鄰居資料）。
    const canTransferWhole = buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength;
    const payload: ArrayBuffer = canTransferWhole
      ? (buf.buffer as ArrayBuffer)
      : (buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);

    const worker = new Worker(workerPath, {
      workerData: { ext, task, buffer: payload },
      transferList: [payload],
    });

    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    const timer = setTimeout(() => {
      settle(() => {
        void worker.terminate();
        reject(new Error("匯入解析逾時"));
      });
    }, timeoutMs);

    worker.on("message", (msg: WorkerMessage<T>) => {
      settle(() => {
        clearTimeout(timer);
        void worker.terminate();
        if (msg.ok) resolve(msg.result);
        else reject(new Error(msg.error));
      });
    });

    worker.on("error", (err: Error) => {
      settle(() => {
        clearTimeout(timer);
        void worker.terminate();
        reject(err);
      });
    });

    worker.on("exit", (code: number) => {
      // 只有在還沒 settle 時才有意義（正常路徑會先收到 message 才 exit）。非 0＝異常結束；0 但無結果＝提前結束。
      settle(() => {
        clearTimeout(timer);
        reject(new Error(code !== 0 ? `worker 非正常結束（code=${code}）` : "worker 未回傳結果即結束"));
      });
    });
  });
}
