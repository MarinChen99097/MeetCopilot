/**
 * DeckRepository 的 SQLite 實作（007_decks.sql：decks / deck_slides / image_jobs）。
 * M234_CONTRACT §M2；API_CONTRACT §4。org-scoped（每查詢 WHERE org_id = ?）、no SQL FK、tx=手動 BEGIN IMMEDIATE。
 *
 * I1（append-only）鐵律的權威落點：
 *  - appendSlide：idx = MAX(idx)+1，永遠加在尾端（恆 > committedIndex）。
 *  - updateSlide：idx ≤ committedIndex → 擲 I1ViolationError（route 對映成 409）。會前（committedIndex=-1）不受限。
 * image_jobs 亦掛此 repo（deck-scoped）。
 */
import type { DbPort } from "./ports.js";
import type { DeckRepository } from "./ports.js";
import type {
  Deck,
  DeckSummary,
  DeckSlide,
  NewDeck,
  ImageJob,
  ImageJobStatus,
  ImageKind,
  NewImageJob,
  ImageJobUpdate,
  SlideSpec,
  DeckLanguage,
  SlideSource,
  SlideTheme,
  DeckSourceKind,
  DeckSlideKind,
  DeckImportStatus,
} from "@meetcopilot/shared";
import { uuidv7 } from "./uuid.js";

/**
 * boot reconcile 寫入 decks.import_error 的固定文案（前端逃生口據此顯示「已中斷」＋重新匯入入口）。
 * 與 import_jobs reaper 的 IMPORT_REAPER_INTERRUPTED_ERROR 平行——後者標 job、此者對帳 deck.import_status。
 */
export const DECK_IMPORT_INTERRUPTED_ERROR = "匯入中斷（伺服器重啟），請重新匯入";

/**
 * I1 違規：試圖修改 idx ≤ committedIndex 的頁（已播/正在播的頁）。
 * route 層捕捉此型別 → 回 409（append-only 不變量的守門）。
 */
export class I1ViolationError extends Error {
  readonly committedIndex: number;
  readonly idx: number;
  constructor(idx: number, committedIndex: number) {
    super(`I1 violation: slide idx ${idx} is at or before committedIndex ${committedIndex} (already committed)`);
    this.name = "I1ViolationError";
    this.idx = idx;
    this.committedIndex = committedIndex;
  }
}

/** 找不到指定的 deck 或 slide（route 對映成 404）。 */
export class DeckNotFoundError extends Error {
  constructor(what: string) {
    super(what);
    this.name = "DeckNotFoundError";
  }
}

/**
 * 018：試圖編輯匯入原簡報的鎖定頁（deck_slides.kind='original'，即 idx < original_count）。
 * route 層捕捉 → 409（「原始簡報頁不可編輯」）。與 I1ViolationError 並存（前段原始頁、尾端補充頁天然不衝突）。
 */
export class OriginalSlideLockedError extends Error {
  readonly idx: number;
  constructor(idx: number) {
    super(`slide idx ${idx} is a locked original (imported) page and cannot be edited`);
    this.name = "OriginalSlideLockedError";
    this.idx = idx;
  }
}

// ─────────────────────────────────────────────────────────────
// row → domain 映射
// ─────────────────────────────────────────────────────────────
interface DeckRow {
  id: string;
  org_id: string;
  title: string;
  language: string;
  source: string;
  committed_index: number;
  company_id: string | null;
  theme_json: string | null;
  created_at: number;
  updated_at: number;
  // ── 018 匯入重構欄（既有列靠 migration DEFAULT：native/NULL/0/ready/NULL）──
  source_kind: string;
  source_asset_id: string | null;
  original_count: number;
  import_status: string;
  import_error: string | null;
}

interface SlideRow {
  id: string;
  org_id: string;
  deck_id: string;
  idx: number;
  spec_json: string;
  created_at: number;
  // ── 018：頁類別＋原始頁指向的 page_image asset（既有列 DEFAULT 'spec'/NULL）──
  kind: string;
  asset_id: string | null;
  // ── 023：匯入 deck 的逐頁純文字（C2 匯入期寫入；native deck 恆 NULL）──
  text_extract: string | null;
}

interface ImageJobRow {
  id: string;
  org_id: string;
  deck_id: string;
  slide_idx: number;
  kind: string;
  status: string;
  prompt: string | null;
  data_uri: string | null;
  error: string | null;
  created_at: number;
  finished_at: number | null;
}

function rowToDeck(r: DeckRow): Deck {
  let theme: SlideTheme | undefined;
  if (r.theme_json) {
    try {
      theme = JSON.parse(r.theme_json) as SlideTheme;
    } catch {
      theme = undefined;
    }
  }
  return {
    id: r.id,
    orgId: r.org_id,
    title: r.title,
    language: r.language as DeckLanguage,
    source: r.source as SlideSource,
    committedIndex: r.committed_index,
    companyId: r.company_id ?? undefined,
    theme,
    sourceKind: r.source_kind as DeckSourceKind,
    originalCount: r.original_count,
    importStatus: r.import_status as DeckImportStatus,
    importError: r.import_error ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToSlide(r: SlideRow): DeckSlide {
  return {
    id: r.id,
    orgId: r.org_id,
    deckId: r.deck_id,
    idx: r.idx,
    spec: JSON.parse(r.spec_json) as SlideSpec,
    createdAt: r.created_at,
    kind: r.kind as DeckSlideKind,
    textExtract: r.text_extract ?? undefined,
  };
}

function rowToImageJob(r: ImageJobRow): ImageJob {
  return {
    id: r.id,
    orgId: r.org_id,
    deckId: r.deck_id,
    slideIdx: r.slide_idx,
    kind: r.kind as ImageKind,
    status: r.status as ImageJobStatus,
    prompt: r.prompt ?? undefined,
    dataUri: r.data_uri ?? undefined,
    error: r.error ?? undefined,
    createdAt: r.created_at,
    finishedAt: r.finished_at ?? undefined,
  };
}

export class SqliteDeckRepository implements DeckRepository {
  constructor(private readonly db: DbPort) {}

  // ── decks ──
  async create(orgId: string, input: NewDeck): Promise<Deck> {
    const id = uuidv7();
    const now = Date.now();
    const slides = input.slides ?? [];
    await this.db.tx(async () => {
      // 018：新增 source_kind/source_asset_id/original_count/import_status 欄。既有呼叫端（generate/CRUD）
      // 不帶這些欄 → 一律落 native/NULL/0/ready（與 migration DEFAULT 一致）；匯入建 processing deck 時帶入。
      await this.db.run(
        `INSERT INTO decks (id, org_id, title, language, source, committed_index, company_id, theme_json,
                            source_kind, source_asset_id, original_count, import_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, -1, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          orgId,
          input.title,
          input.language,
          input.source,
          input.companyId ?? null,
          input.theme ? JSON.stringify(input.theme) : null,
          input.sourceKind ?? "native",
          input.sourceAssetId ?? null,
          input.originalCount ?? 0,
          input.importStatus ?? "ready",
          now,
          now,
        ],
      );
      for (let i = 0; i < slides.length; i++) {
        // create() 建的頁一律 kind='spec'（DEFAULT）。原始頁（kind='original'）由 WP-IMPORT 走 appendSlide(..., {kind,assetId})。
        await this.db.run(
          `INSERT INTO deck_slides (id, org_id, deck_id, idx, spec_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [uuidv7(), orgId, id, i, JSON.stringify(slides[i]), now],
        );
      }
    });
    const deck = await this.findById(orgId, id);
    if (!deck) throw new Error("[crm] deck insert failed");
    return deck;
  }

  async list(orgId: string): Promise<DeckSummary[]> {
    const rows = await this.db.all<DeckRow & { slide_count: number }>(
      `SELECT d.*, (SELECT COUNT(*) FROM deck_slides s WHERE s.org_id = d.org_id AND s.deck_id = d.id) AS slide_count
       FROM decks d WHERE d.org_id = ? ORDER BY d.updated_at DESC`,
      [orgId],
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      language: r.language as DeckLanguage,
      slideCount: r.slide_count,
      updatedAt: r.updated_at,
    }));
  }

  async findById(orgId: string, id: string): Promise<Deck | null> {
    const row = await this.db.get<DeckRow>("SELECT * FROM decks WHERE org_id = ? AND id = ?", [orgId, id]);
    return row ? rowToDeck(row) : null;
  }

  async findWithSlides(orgId: string, id: string): Promise<{ deck: Deck; slides: DeckSlide[] } | null> {
    const deckRow = await this.db.get<DeckRow>("SELECT * FROM decks WHERE org_id = ? AND id = ?", [orgId, id]);
    if (!deckRow) return null;
    const slideRows = await this.db.all<SlideRow>(
      "SELECT * FROM deck_slides WHERE org_id = ? AND deck_id = ? ORDER BY idx ASC",
      [orgId, id],
    );
    return { deck: rowToDeck(deckRow), slides: slideRows.map(rowToSlide) };
  }

  async delete(orgId: string, id: string): Promise<void> {
    await this.db.tx(async () => {
      await this.db.run("DELETE FROM deck_slides WHERE org_id = ? AND deck_id = ?", [orgId, id]);
      await this.db.run("DELETE FROM image_jobs WHERE org_id = ? AND deck_id = ?", [orgId, id]);
      // 018：無 SQL FK，手動級聯刪原檔/逐頁圖 bytes 與轉檔 job（否則 bytea/BLOB 殘留）。
      await this.db.run("DELETE FROM deck_assets WHERE org_id = ? AND deck_id = ?", [orgId, id]);
      await this.db.run("DELETE FROM import_jobs WHERE org_id = ? AND deck_id = ?", [orgId, id]);
      await this.db.run("DELETE FROM decks WHERE org_id = ? AND id = ?", [orgId, id]);
    });
  }

  /**
   * page_commit 推進 committed_index：單調遞增（永不回退；I1 依它）。
   * 取 max 在 JS 端算而非 SQL：SQLite 的 2-arg `MAX(a,b)` 是純量函式，但 Postgres 的 MAX 是聚合函式（單參數）
   * → `GREATEST` 才是 PG 對應，而 SQLite 無 GREATEST，故任一關鍵字都不可移植。改在 tx 內讀→Math.max→寫，單一程式路徑跨兩 driver。
   */
  async setCommittedIndex(orgId: string, deckId: string, index: number): Promise<void> {
    await this.db.tx(async () => {
      const row = await this.db.get<{ committed_index: number }>(
        "SELECT committed_index FROM decks WHERE org_id = ? AND id = ?",
        [orgId, deckId],
      );
      if (!row) return; // deck 不存在：與原 UPDATE …WHERE 命中 0 列同語意（不拋錯）。
      const next = Math.max(row.committed_index, index);
      await this.db.run(
        "UPDATE decks SET committed_index = ?, updated_at = ? WHERE org_id = ? AND id = ?",
        [next, Date.now(), orgId, deckId],
      );
    });
  }

  // ── slides（append-only I1）──
  /**
   * append 到尾端（idx = max(idx)+1，恆 > committedIndex，恆滿足 I1）。
   * 018：`opts.kind`/`opts.assetId` 供 WP-IMPORT 逐頁建原始頁（kind='original'＋指向 page_image asset）；
   * 既有呼叫端（realtime APPEND / generate）省略 opts → 一律 kind='spec'、asset_id=NULL（DEFAULT 語意不變）。
   */
  async appendSlide(
    orgId: string,
    deckId: string,
    spec: SlideSpec,
    opts?: { kind?: DeckSlideKind; assetId?: string },
  ): Promise<DeckSlide> {
    const id = uuidv7();
    const now = Date.now();
    const kind: DeckSlideKind = opts?.kind ?? "spec";
    const assetId = opts?.assetId ?? null;
    let idx = 0;
    await this.db.tx(async () => {
      const deck = await this.db.get<{ id: string }>("SELECT id FROM decks WHERE org_id = ? AND id = ?", [
        orgId,
        deckId,
      ]);
      if (!deck) throw new DeckNotFoundError("deck not found");
      const maxRow = await this.db.get<{ m: number | null }>(
        "SELECT MAX(idx) AS m FROM deck_slides WHERE org_id = ? AND deck_id = ?",
        [orgId, deckId],
      );
      idx = maxRow && maxRow.m !== null ? maxRow.m + 1 : 0;
      await this.db.run(
        `INSERT INTO deck_slides (id, org_id, deck_id, idx, spec_json, created_at, kind, asset_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, orgId, deckId, idx, JSON.stringify(spec), now, kind, assetId],
      );
      await this.db.run("UPDATE decks SET updated_at = ? WHERE org_id = ? AND id = ?", [now, orgId, deckId]);
    });
    return { id, orgId, deckId, idx, spec, createdAt: now, kind };
  }

  /**
   * 會前/pending 編輯。守門（皆 route 對映成 409）：
   *  - 018：idx < original_count（匯入鎖定原始頁）→ OriginalSlideLockedError。
   *  - I1：idx ≤ committedIndex（已播/正在播的頁）→ I1ViolationError（權威落點）。
   * 原始頁在前段（0..original_count-1）、補充頁在尾端，兩守門天然不衝突。
   */
  async updateSlide(orgId: string, deckId: string, idx: number, spec: SlideSpec): Promise<DeckSlide> {
    const deckRow = await this.db.get<DeckRow>("SELECT * FROM decks WHERE org_id = ? AND id = ?", [orgId, deckId]);
    if (!deckRow) throw new DeckNotFoundError("deck not found");
    if (idx < deckRow.original_count) throw new OriginalSlideLockedError(idx);
    if (idx <= deckRow.committed_index) throw new I1ViolationError(idx, deckRow.committed_index);
    const existing = await this.db.get<SlideRow>(
      "SELECT * FROM deck_slides WHERE org_id = ? AND deck_id = ? AND idx = ?",
      [orgId, deckId, idx],
    );
    if (!existing) throw new DeckNotFoundError("slide not found");
    // 縱深防禦：即便 idx 未落在 original_count 前段（資料異常），也擋 kind='original' 的頁。
    if (existing.kind === "original") throw new OriginalSlideLockedError(idx);
    const now = Date.now();
    await this.db.run(
      "UPDATE deck_slides SET spec_json = ? WHERE org_id = ? AND deck_id = ? AND idx = ?",
      [JSON.stringify(spec), orgId, deckId, idx],
    );
    await this.db.run("UPDATE decks SET updated_at = ? WHERE org_id = ? AND id = ?", [now, orgId, deckId]);
    return { id: existing.id, orgId, deckId, idx, spec, createdAt: existing.created_at, kind: existing.kind as DeckSlideKind };
  }

  // ── 018 匯入 setters（deckId 為 PK，全域唯一；不收 orgId，比照契約 §凍結簽名。route/worker 已持有 deckId 歸屬）──
  /** 設 import_status（+ failed 時的 import_error；非 failed 時清 error）。轉檔 job 進度回寫用。 */
  async setImportStatus(deckId: string, status: DeckImportStatus, error?: string): Promise<void> {
    await this.db.run(
      "UPDATE decks SET import_status = ?, import_error = ?, updated_at = ? WHERE id = ?",
      [status, status === "failed" ? (error ?? "import failed").slice(0, 2000) : null, Date.now(), deckId],
    );
  }

  /** 設 original_count（前段鎖定原始頁數）。轉檔完成、原始頁全數落庫後回填 N。 */
  async setOriginalCount(deckId: string, n: number): Promise<void> {
    await this.db.run("UPDATE decks SET original_count = ?, updated_at = ? WHERE id = ?", [n, Date.now(), deckId]);
  }

  /**
   * boot reconcile（契約 §5，與 import_jobs reaper 對帳）：所有 import_status='processing' 的 deck 標 failed。
   * 轉檔是同進程 in-process job，server 重啟後 processing deck 依定義都是被中斷的、永不會再收尾 →
   * 一律標 failed＋人話 import_error，前端才有逃生口（否則只看 deck.importStatus 會永久卡「轉檔中」）。跨 org。
   */
  async failInterruptedImports(): Promise<number> {
    const now = Date.now();
    const row = await this.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM decks WHERE import_status = 'processing'",
      [],
    );
    const n = row?.n ?? 0;
    if (n > 0) {
      await this.db.run(
        "UPDATE decks SET import_status = 'failed', import_error = ?, updated_at = ? WHERE import_status = 'processing'",
        [DECK_IMPORT_INTERRUPTED_ERROR, now],
      );
    }
    return n;
  }

  /**
   * 023/C2（MEETING_CHECKLIST_CONTRACT §11.4）：寫匯入頁逐頁純文字 text_extract。
   * 獨立 UPDATE、只碰 text_extract 一欄——**刻意不走 updateSlide**（匯入原始頁 100% 命中其
   * OriginalSlideLocked/I1 守門；text_extract 不是 deck 內容變更，不影響任何頁面呈現，故繞開是安全的）。
   * 不碰 spec_json、不 bump decks.updated_at（非內容變更，不應擾動 deck 列表排序）。
   * orgId 必進 WHERE：跨 org＝命中 0 列（零副作用、不 throw）。
   * 三態語意（§11.1 v1.4）：`''` 是合法值（負結果標記＝抽過、確認無字），**照寫、不得加「空字串不寫」守衛**；
   * 讀回經 rowToSlide 的 `?? undefined` 只折 NULL，`''` 原樣存活（deck-text-extract.test.ts 有鎖）。
   * **僅限匯入期與回填 job 呼叫，嚴禁 realtime／會中路徑。**
   */
  async setSlideTextExtract(orgId: string, deckId: string, idx: number, text: string): Promise<void> {
    await this.db.run(
      "UPDATE deck_slides SET text_extract = ? WHERE org_id = ? AND deck_id = ? AND idx = ?",
      [text, orgId, deckId, idx],
    );
  }

  // ── image_jobs（pre-meeting AI 生圖）──
  async createImageJob(orgId: string, input: NewImageJob): Promise<ImageJob> {
    const id = uuidv7();
    const now = Date.now();
    await this.db.run(
      `INSERT INTO image_jobs (id, org_id, deck_id, slide_idx, kind, status, prompt, created_at)
       VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`,
      [id, orgId, input.deckId, input.slideIdx, input.kind, input.prompt ?? null, now],
    );
    const job = await this.findImageJob(orgId, id);
    if (!job) throw new Error("[crm] image job insert failed");
    return job;
  }

  async findImageJob(orgId: string, id: string): Promise<ImageJob | null> {
    const row = await this.db.get<ImageJobRow>("SELECT * FROM image_jobs WHERE org_id = ? AND id = ?", [orgId, id]);
    return row ? rowToImageJob(row) : null;
  }

  async updateImageJob(orgId: string, id: string, patch: ImageJobUpdate): Promise<ImageJob> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.status !== undefined) {
      sets.push("status = ?");
      vals.push(patch.status);
    }
    if ("dataUri" in patch) {
      sets.push("data_uri = ?");
      vals.push(patch.dataUri ?? null);
    }
    if ("error" in patch) {
      sets.push("error = ?");
      vals.push(patch.error ? patch.error.slice(0, 2000) : null);
    }
    if (patch.finishedAt !== undefined) {
      sets.push("finished_at = ?");
      vals.push(patch.finishedAt);
    }
    if (sets.length > 0) {
      await this.db.run(`UPDATE image_jobs SET ${sets.join(", ")} WHERE org_id = ? AND id = ?`, [...vals, orgId, id]);
    }
    const job = await this.findImageJob(orgId, id);
    if (!job) throw new DeckNotFoundError("image job not found");
    return job;
  }
}
