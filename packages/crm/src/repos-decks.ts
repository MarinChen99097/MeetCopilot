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
} from "@meetcopilot/shared";
import { uuidv7 } from "./uuid.js";

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
}

interface SlideRow {
  id: string;
  org_id: string;
  deck_id: string;
  idx: number;
  spec_json: string;
  created_at: number;
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
      await this.db.run(
        `INSERT INTO decks (id, org_id, title, language, source, committed_index, company_id, theme_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, -1, ?, ?, ?, ?)`,
        [
          id,
          orgId,
          input.title,
          input.language,
          input.source,
          input.companyId ?? null,
          input.theme ? JSON.stringify(input.theme) : null,
          now,
          now,
        ],
      );
      for (let i = 0; i < slides.length; i++) {
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
  async appendSlide(orgId: string, deckId: string, spec: SlideSpec): Promise<DeckSlide> {
    const id = uuidv7();
    const now = Date.now();
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
        `INSERT INTO deck_slides (id, org_id, deck_id, idx, spec_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, orgId, deckId, idx, JSON.stringify(spec), now],
      );
      await this.db.run("UPDATE decks SET updated_at = ? WHERE org_id = ? AND id = ?", [now, orgId, deckId]);
    });
    return { id, orgId, deckId, idx, spec, createdAt: now };
  }

  /** 會前/pending 編輯。I1 守門：idx ≤ committedIndex → I1ViolationError（權威落點）。 */
  async updateSlide(orgId: string, deckId: string, idx: number, spec: SlideSpec): Promise<DeckSlide> {
    const deckRow = await this.db.get<DeckRow>("SELECT * FROM decks WHERE org_id = ? AND id = ?", [orgId, deckId]);
    if (!deckRow) throw new DeckNotFoundError("deck not found");
    if (idx <= deckRow.committed_index) throw new I1ViolationError(idx, deckRow.committed_index);
    const existing = await this.db.get<SlideRow>(
      "SELECT * FROM deck_slides WHERE org_id = ? AND deck_id = ? AND idx = ?",
      [orgId, deckId, idx],
    );
    if (!existing) throw new DeckNotFoundError("slide not found");
    const now = Date.now();
    await this.db.run(
      "UPDATE deck_slides SET spec_json = ? WHERE org_id = ? AND deck_id = ? AND idx = ?",
      [JSON.stringify(spec), orgId, deckId, idx],
    );
    await this.db.run("UPDATE decks SET updated_at = ? WHERE org_id = ? AND id = ?", [now, orgId, deckId]);
    return { id: existing.id, orgId, deckId, idx, spec, createdAt: existing.created_at };
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
