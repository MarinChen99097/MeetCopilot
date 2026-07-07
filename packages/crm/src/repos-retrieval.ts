/**
 * 信任層/檢索層 repositories（CRM_SCHEMA §8-9）：Provenance / Embedding（JS cosine）/ ProfileCard。
 * org-scoping 鐵律在 search 尤其關鍵：查詢一律注入 WHERE org_id=?，故他 org 的向量結構上不可能被回傳。
 */
import type { DbPort } from "./ports.js";
import type {
  ProvenanceRepository,
  EmbeddingRepository,
  ProfileCardRepository,
  ByUser,
  EmbeddingSearchHit,
} from "./ports.js";
import type {
  FieldProvenance,
  NewProvenance,
  NewEmbedding,
  ProfileCard,
  NewProfileCard,
  FilledBy,
  Bool01,
} from "@meetcopilot/shared";
import { cosine, uuidv7 } from "./mappers.js";
import { recordProvenanceRows } from "./provenance-write.js";

// ─────────────────────────────────────────────────────────────
// ProvenanceRepository（每欄取未 superseded 最新一筆）
// ─────────────────────────────────────────────────────────────
export class SqliteProvenanceRepository implements ProvenanceRepository {
  constructor(private readonly db: DbPort) {}

  async listForEntity(orgId: string, entityType: string, entityId: string): Promise<FieldProvenance[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT field_name, value_snapshot, filled_by, source_type, source_url, confidence, verified, created_at
       FROM field_provenance
       WHERE org_id = ? AND entity_type = ? AND entity_id = ? AND superseded_by IS NULL
       ORDER BY field_name ASC, created_at DESC`,
      [orgId, entityType, entityId],
    );
    return rows.map((r) => ({
      fieldName: r.field_name as string,
      valueSnapshot: (r.value_snapshot as string | null) ?? "",
      filledBy: r.filled_by as FilledBy,
      sourceType: (r.source_type as string | null) ?? undefined,
      sourceUrl: (r.source_url as string | null) ?? undefined,
      confidence: (r.confidence as number | null) ?? undefined,
      verified: (r.verified as Bool01) ?? 0,
      createdAt: r.created_at as number,
    }));
  }

  async confirm(
    orgId: string,
    entityType: string,
    entityId: string,
    fieldName: string,
    by: ByUser,
  ): Promise<void> {
    const now = Date.now();
    await this.db.run(
      `UPDATE field_provenance SET verified = 1, verified_by = ?, verified_at = ?
       WHERE org_id = ? AND entity_type = ? AND entity_id = ? AND field_name = ? AND superseded_by IS NULL`,
      [by.userId, now, orgId, entityType, entityId, fieldName],
    );
  }

  async record(orgId: string, rows: NewProvenance[]): Promise<void> {
    await this.db.tx(async () => {
      await recordProvenanceRows(this.db, orgId, rows);
    });
  }
}

// ─────────────────────────────────────────────────────────────
// EmbeddingRepository（TEXT JSON + JS 暴力 cosine；search 過 org_id + 白名單）
// ─────────────────────────────────────────────────────────────
export class SqliteEmbeddingRepository implements EmbeddingRepository {
  constructor(private readonly db: DbPort) {}

  async upsert(orgId: string, rows: NewEmbedding[]): Promise<void> {
    await this.db.tx(async () => {
      const now = Date.now();
      for (const r of rows) {
        const chunkIndex = r.chunkIndex ?? 0;
        const existing = await this.db.get<{ id: string; content_hash: string }>(
          `SELECT id, content_hash FROM embeddings
           WHERE org_id = ? AND entity_type = ? AND entity_id = ? AND chunk_index = ?`,
          [orgId, r.entityType, r.entityId, chunkIndex],
        );
        if (existing) {
          if (existing.content_hash === r.contentHash) continue; // 內容未變 → 跳過重嵌
          await this.db.run(
            `UPDATE embeddings SET content = ?, content_hash = ?, embedding = ?, dims = ?, model = ?, token_count = ?, updated_at = ?
             WHERE org_id = ? AND id = ?`,
            [
              r.content,
              r.contentHash,
              JSON.stringify(r.embedding),
              r.dims,
              r.model,
              r.tokenCount ?? null,
              now,
              orgId,
              existing.id,
            ],
          );
        } else {
          await this.db.run(
            `INSERT INTO embeddings
               (id, org_id, entity_type, entity_id, chunk_index, content, content_hash, embedding, dims, model, token_count, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              uuidv7(),
              orgId,
              r.entityType,
              r.entityId,
              chunkIndex,
              r.content,
              r.contentHash,
              JSON.stringify(r.embedding),
              r.dims,
              r.model,
              r.tokenCount ?? null,
              now,
              now,
            ],
          );
        }
      }
    });
  }

  async search(
    orgId: string,
    queryVec: number[],
    filter: { entityTypes?: string[]; entityIds?: string[] },
    k: number,
  ): Promise<EmbeddingSearchHit[]> {
    const where = ["org_id = ?"];
    const params: unknown[] = [orgId];
    if (filter.entityTypes && filter.entityTypes.length > 0) {
      where.push(`entity_type IN (${filter.entityTypes.map(() => "?").join(", ")})`);
      params.push(...filter.entityTypes);
    }
    if (filter.entityIds && filter.entityIds.length > 0) {
      where.push(`entity_id IN (${filter.entityIds.map(() => "?").join(", ")})`);
      params.push(...filter.entityIds);
    }
    const rows = await this.db.all<{
      entity_type: string;
      entity_id: string;
      content: string;
      embedding: string;
    }>(
      `SELECT entity_type, entity_id, content, embedding FROM embeddings WHERE ${where.join(" AND ")}`,
      params,
    );
    const scored: EmbeddingSearchHit[] = rows.map((r) => ({
      entityType: r.entity_type,
      entityId: r.entity_id,
      content: r.content,
      score: cosine(queryVec, JSON.parse(r.embedding) as number[]),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(0, k));
  }
}

// ─────────────────────────────────────────────────────────────
// ProfileCardRepository（built_from_hash 守重生；UNIQUE(org,entity_type,entity_id)）
// ─────────────────────────────────────────────────────────────
export class SqliteProfileCardRepository implements ProfileCardRepository {
  constructor(private readonly db: DbPort) {}

  async get(orgId: string, entityType: string, entityId: string): Promise<ProfileCard | null> {
    const row = await this.db.get<Record<string, unknown>>(
      "SELECT * FROM profile_cards WHERE org_id = ? AND entity_type = ? AND entity_id = ?",
      [orgId, entityType, entityId],
    );
    return row ? mapProfileCard(row) : null;
  }

  async upsert(orgId: string, input: NewProfileCard): Promise<ProfileCard> {
    const now = Date.now();
    await this.db.run(
      `INSERT INTO profile_cards
         (id, org_id, entity_type, entity_id, card_markdown, built_from_hash, model_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_id, entity_type, entity_id) DO UPDATE SET
         card_markdown = excluded.card_markdown,
         built_from_hash = excluded.built_from_hash,
         model_version = excluded.model_version,
         updated_at = excluded.updated_at`,
      [
        uuidv7(),
        orgId,
        input.entityType,
        input.entityId,
        input.cardMarkdown,
        input.builtFromHash,
        input.modelVersion ?? null,
        now,
        now,
      ],
    );
    return (await this.get(orgId, input.entityType, input.entityId))!;
  }
}

function mapProfileCard(r: Record<string, unknown>): ProfileCard {
  return {
    id: r.id as string,
    orgId: r.org_id as string,
    entityType: r.entity_type as string,
    entityId: r.entity_id as string,
    cardMarkdown: r.card_markdown as string,
    builtFromHash: r.built_from_hash as string,
    modelVersion: (r.model_version as string | null) ?? undefined,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}
