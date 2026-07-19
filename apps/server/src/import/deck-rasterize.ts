/**
 * 匯入轉檔的 CLI wrapper（契約 §5）：把原簡報「原封點陣化」成逐頁 PNG，供原始頁忠實顯示/匯出。
 *
 *  - pptx：`soffice --headless --convert-to pdf` → 再 `pdftoppm -png` 逐頁點陣化。
 *  - pdf ：直接 `pdftoppm -png`（免 LibreOffice）。
 *
 * bin 路徑走 env：`SOFFICE_BIN`（預設 'soffice'）、`PDFTOPPM_BIN`（預設 'pdftoppm'）。
 * 每次轉檔開一個唯一暫存工作目錄（os.tmpdir()＝Cloud Run 的 /tmp tmpfs，唯一可寫）：
 *   - LibreOffice profile 用 `-env:UserInstallation=file://…/lo_profile`（併發不互踩）。
 *   - HOME / XDG_CACHE_HOME / TMPDIR 指到工作目錄（fontconfig 快取需可寫；Cloud Run 根 FS 唯讀）。
 * 逾時（env `RASTERIZE_TIMEOUT_MS` 覆寫；pptx 預設 120s、pdf 90s）→ SIGKILL 子進程並丟 RasterizeError；收工遞迴刪暫存。
 *
 * ⚠️ 本機（Windows）通常無 soffice/pdftoppm → 實跑會丟 RasterizeError（bin 缺失），屬預期；真轉檔在 Docker E2E 驗。
 * 故轉檔失敗一律以「人話」RasterizeError 表面化（conversion-job 寫入 deck.import_error 給使用者看），不外洩原始 CLI 字串。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const execFileP = promisify(execFile);

/** LibreOffice / poppler 執行檔路徑（Docker 由 apt 安裝；本機可用 env 指向自訂路徑）。 */
const SOFFICE_BIN = process.env.SOFFICE_BIN || "soffice";
const PDFTOPPM_BIN = process.env.PDFTOPPM_BIN || "pdftoppm";

/** 逾時預設（契約 §5）：pptx 走 LibreOffice 較慢給 120s、pdf 直接點陣化給 90s；env 可統一覆寫。 */
const DEFAULT_PPTX_TIMEOUT_MS = 120_000;
const DEFAULT_PDF_TIMEOUT_MS = 90_000;

/** 子進程 stdout/stderr buffer 上限（轉檔工具把輸出寫檔、stdout 極少，16MiB 綽綽有餘）。 */
const CHILD_MAX_BUFFER = 16 * 1024 * 1024;

/** 轉檔失敗的「人話」錯誤：訊息即面向使用者（conversion-job 直接寫進 deck.import_error）。 */
export class RasterizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RasterizeError";
  }
}

/** 點陣化解析度（DPI）；env `RASTERIZE_DPI` 覆寫，預設 150（契約 §5 的 `-r 150`）。 */
function rasterizeDpi(): string {
  const raw = process.env.RASTERIZE_DPI ? Number(process.env.RASTERIZE_DPI) : NaN;
  const dpi = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 150;
  return String(dpi);
}

/** 逾時毫秒：env `RASTERIZE_TIMEOUT_MS`（>0）覆寫，否則用來源型別預設。 */
function timeoutFor(def: number): number {
  const raw = process.env.RASTERIZE_TIMEOUT_MS ? Number(process.env.RASTERIZE_TIMEOUT_MS) : NaN;
  return Number.isFinite(raw) && raw > 0 ? raw : def;
}

/** 子進程環境：把 HOME/快取/暫存都指向可寫的工作目錄（Cloud Run 根 FS 唯讀，只有 /tmp 可寫）。 */
export function childEnv(workDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: workDir,
    XDG_CACHE_HOME: path.join(workDir, "xdg-cache"),
    XDG_CONFIG_HOME: path.join(workDir, "xdg-config"),
    TMPDIR: workDir,
  };
}

interface RunOpts {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

/** 執行一個轉檔 CLI；逾時 SIGKILL、bin 缺失/非零退出一律轉成人話 RasterizeError（原始細節只進 server log）。 */
async function runBin(bin: string, args: string[], opts: RunOpts): Promise<void> {
  try {
    await execFileP(bin, args, {
      cwd: opts.cwd,
      env: opts.env,
      timeout: opts.timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: CHILD_MAX_BUFFER,
      windowsHide: true,
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { killed?: boolean; stderr?: string | Buffer };
    if (e.code === "ENOENT") {
      throw new RasterizeError(`伺服器缺少轉檔元件（${bin}），暫時無法轉換簡報，請聯絡管理員`);
    }
    if (e.killed) {
      throw new RasterizeError("簡報轉檔逾時，檔案可能過大或過於複雜，請精簡後再試");
    }
    const stderr = typeof e.stderr === "string" ? e.stderr : (e.stderr?.toString?.() ?? "");
    console.error(`[import] ${bin} failed (code=${e.code ?? "?"}):`, stderr.slice(0, 1000) || e.message);
    throw new RasterizeError("簡報轉檔失敗，請確認檔案未損毀後再試");
  }
}

/** 讀出某目錄下 `page*.png`，依頁碼（尾碼數字，pdftoppm 多頁會補零）數值排序回傳每頁一個 Buffer。 */
async function collectPagePngs(dir: string): Promise<Buffer[]> {
  const entries = await readdir(dir);
  const matched = entries
    .map((name) => {
      const m = name.match(/^page-?(\d+)\.png$/i);
      return m ? { name, n: parseInt(m[1]!, 10) } : null;
    })
    .filter((x): x is { name: string; n: number } => x !== null)
    .sort((a, b) => a.n - b.n);
  // 各頁 readFile 互相獨立 → 並行讀（保序：Promise.all 依 map 順序回填）。libuv threadpool 天然限流實際 fd 數。
  return Promise.all(matched.map(({ name }) => readFile(path.join(dir, name))));
}

/** `pdftoppm -png -r <dpi> <pdf> <workDir>/page` → 逐頁 PNG（頁序＝檔名尾碼數字）。 */
async function pdfToPagePngs(pdfPath: string, workDir: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<Buffer[]> {
  const outPrefix = path.join(workDir, "page");
  await runBin(PDFTOPPM_BIN, ["-png", "-r", rasterizeDpi(), pdfPath, outPrefix], {
    cwd: workDir,
    env,
    timeoutMs,
  });
  const pngs = await collectPagePngs(workDir);
  if (pngs.length === 0) throw new RasterizeError("檔案沒有可轉換的頁面");
  return pngs;
}

/**
 * soffice pptx→pdf 的共用原始步驟（供匯入點陣化與匯出補充頁 pdf 兩路共用；單一逾時/SIGKILL/ENOENT 契約）。
 * 在 workDir 內把 inPath 轉出 `<workDir>/<basename-無副檔>.pdf`，回傳該 pdf 路徑。
 * 併發安全：每次唯一 LO profile（workDir/lo_profile，-env 需 file:// URI）——避免併發轉檔共用 profile 互踩鎖。
 * soffice 可能靜默失敗（回 0 卻不產檔）→ 存在性檢查給人話 RasterizeError。
 */
export async function sofficePptxToPdf(
  inPath: string,
  workDir: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<string> {
  const loProfile = pathToFileURL(path.join(workDir, "lo_profile")).href;
  await runBin(
    SOFFICE_BIN,
    [
      "--headless",
      "--norestore",
      "--convert-to",
      "pdf",
      "--outdir",
      workDir,
      inPath,
      `-env:UserInstallation=${loProfile}`,
    ],
    { cwd: workDir, env, timeoutMs },
  );

  const pdfPath = path.join(workDir, path.basename(inPath).replace(/\.[^.]+$/, "") + ".pdf");
  try {
    await readFile(pdfPath);
  } catch {
    throw new RasterizeError("無法讀取簡報內容（轉為 PDF 失敗），請確認檔案未損毀");
  }
  return pdfPath;
}

/**
 * pptx bytes → 逐頁 PNG（順序＝頁序）。soffice 先轉 pdf（sofficePptxToPdf）、再 pdftoppm 點陣化。
 * 併發安全：每次唯一 workDir + 唯一 LibreOffice profile；收工遞迴刪暫存。
 */
export async function rasterizePptxToImages(bytes: Buffer): Promise<Buffer[]> {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "ds-pptx-"));
  try {
    const env = childEnv(workDir);
    const inPath = path.join(workDir, "source.pptx");
    await writeFile(inPath, bytes);
    const pdfPath = await sofficePptxToPdf(inPath, workDir, env, timeoutFor(DEFAULT_PPTX_TIMEOUT_MS));
    return await pdfToPagePngs(pdfPath, workDir, env, timeoutFor(DEFAULT_PDF_TIMEOUT_MS));
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** pdf bytes → 逐頁 PNG（順序＝頁序）。直接 pdftoppm，免 LibreOffice。收工遞迴刪暫存。 */
export async function rasterizePdfToImages(bytes: Buffer): Promise<Buffer[]> {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "ds-pdf-"));
  try {
    const env = childEnv(workDir);
    const pdfPath = path.join(workDir, "source.pdf");
    await writeFile(pdfPath, bytes);
    return await pdfToPagePngs(pdfPath, workDir, env, timeoutFor(DEFAULT_PDF_TIMEOUT_MS));
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
