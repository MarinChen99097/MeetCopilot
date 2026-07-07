/**
 * CrawlJobStore — crawl_jobs 的存取（CRM_SCHEMA §8；migration 006）。
 *
 * 設計註記：frozen seam（M1_CONTRACT §1）**沒有**為 crawl_jobs 定 repository 介面——它是研究引擎的執行簿記，
 * 非業務域實體。故研究引擎透過 CrmCore 的 **DbPort（sanctioned port）** 自持此表；仍嚴守 org_id scoping 與
 * 參數化 SQL（不繞過 port、不拼字串），與「沒有東西直接碰 db」的紀律相容（碰的是 port，不是 driver）。
 */
import type { DbPort } from "@meetcopilot/crm";
import type { CrawlJob, NewCrawlJob, CrawlTargetType, CrawlMode, CrawlJobStatus } from "@meetcopilot/shared";
import { uuidv7 } from "./uuid.js";

interface CrawlJobRow {
  id: string;
  org_id: string;
  target_type: CrawlTargetType;
  target_id: string;
  target_domain: string | null;
  mode: CrawlMode;
  status: CrawlJobStatus;
  requested_by: string | null;
  started_at: number | null;
  finished_at: number | null;
  sources_json: string | null;
  fields_filled: number | null;
  error: string | null;
  raw_result_ref: string | null;
  created_at: number;
}

function rowToJob(r: CrawlJobRow): CrawlJob {
  let sources: string[] | undefined;
  if (r.sources_json) {
    try {
      const parsed = JSON.parse(r.sources_json);
      if (Array.isArray(parsed)) sources = parsed.filter((x): x is string => typeof x === "string");
    } catch {
      sources = undefined;
    }
  }
  return {
    id: r.id,
    orgId: r.org_id,
    targetType: r.target_type,
    targetId: r.target_id,
    targetDomain: r.target_domain ?? undefined,
    mode: r.mode,
    status: r.status,
    requestedBy: r.requested_by ?? undefined,
    startedAt: r.started_at ?? undefined,
    finishedAt: r.finished_at ?? undefined,
    sources,
    fieldsFilled: r.fields_filled ?? undefined,
    error: r.error ?? undefined,
    rawResultRef: r.raw_result_ref ?? undefined,
    createdAt: r.created_at,
  };
}

export interface CrawlJobStore {
  create(orgId: string, input: NewCrawlJob): Promise<CrawlJob>;
  findById(orgId: string, id: string): Promise<CrawlJob | null>;
  listByTarget(orgId: string, targetId: string): Promise<CrawlJob[]>;
  markRunning(orgId: string, id: string): Promise<void>;
  markDone(orgId: string, id: string, result: { fieldsFilled: number; sources: string[] }): Promise<void>;
  markFailed(orgId: string, id: string, error: string): Promise<void>;
}

export function createCrawlJobStore(db: DbPort): CrawlJobStore {
  return {
    async create(orgId, input) {
      const id = uuidv7();
      const now = Date.now();
      await db.run(
        `INSERT INTO crawl_jobs (id, org_id, target_type, target_id, target_domain, mode, status, requested_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
        [id, orgId, input.targetType, input.targetId, input.targetDomain ?? null, input.mode, input.requestedBy ?? null, now],
      );
      const row = await db.get<CrawlJobRow>("SELECT * FROM crawl_jobs WHERE org_id = ? AND id = ?", [orgId, id]);
      if (!row) throw new Error("crawl job insert failed");
      return rowToJob(row);
    },

    async findById(orgId, id) {
      const row = await db.get<CrawlJobRow>("SELECT * FROM crawl_jobs WHERE org_id = ? AND id = ?", [orgId, id]);
      return row ? rowToJob(row) : null;
    },

    async listByTarget(orgId, targetId) {
      const rows = await db.all<CrawlJobRow>(
        "SELECT * FROM crawl_jobs WHERE org_id = ? AND target_id = ? ORDER BY created_at DESC",
        [orgId, targetId],
      );
      return rows.map(rowToJob);
    },

    async markRunning(orgId, id) {
      await db.run("UPDATE crawl_jobs SET status = 'running', started_at = ? WHERE org_id = ? AND id = ?", [
        Date.now(),
        orgId,
        id,
      ]);
    },

    async markDone(orgId, id, result) {
      await db.run(
        "UPDATE crawl_jobs SET status = 'done', finished_at = ?, fields_filled = ?, sources_json = ? WHERE org_id = ? AND id = ?",
        [Date.now(), result.fieldsFilled, JSON.stringify(result.sources), orgId, id],
      );
    },

    async markFailed(orgId, id, error) {
      await db.run("UPDATE crawl_jobs SET status = 'failed', finished_at = ?, error = ? WHERE org_id = ? AND id = ?", [
        Date.now(),
        error.slice(0, 2000),
        orgId,
        id,
      ]);
    },
  };
}
