/**
 * 商機/筆記 repositories（CRM_SCHEMA §6/§8）：Deal（+採購委員會 join）、Note（多型 entityType+entityId）。
 * org-scoped；Deal.update 走 human-provenance（entityType='deal'，deals 無 verified_status 故不 bump）。
 */
import type { DbPort } from "./ports.js";
import type { DealRepository, NoteRepository, SingletonNoteInput, DealFilter, Page, Paged, ByUser } from "./ports.js";
import type {
  Deal,
  NewDeal,
  DealContact,
  NewDealContact,
  DealContactStance,
  DecisionPower,
  Note,
  NewNote,
  NoteEntityType,
  NoteType,
  Bool01,
} from "@meetcopilot/shared";
import { rowToDomain, patchToRecord, insertRow, uuidv7, DEAL_DEFS } from "./mappers.js";
import { applyHumanUpdate } from "./update-apply.js";

// ─────────────────────────────────────────────────────────────
// DealRepository
// ─────────────────────────────────────────────────────────────
export class SqliteDealRepository implements DealRepository {
  constructor(private readonly db: DbPort) {}

  async create(orgId: string, input: NewDeal): Promise<Deal> {
    if (!input.companyId) throw new Error("[crm] deal requires companyId");
    const now = Date.now();
    const id = uuidv7();
    const rec = patchToRecord(input as Record<string, unknown>, DEAL_DEFS);
    rec.id = id;
    rec.org_id = orgId;
    if (rec.stage === undefined) rec.stage = "prospect";
    if (rec.status === undefined) rec.status = "open";
    rec.created_at = now;
    rec.updated_at = now;
    await insertRow(this.db, "deals", rec);
    return (await this.findById(orgId, id))!;
  }

  async findById(orgId: string, id: string): Promise<Deal | null> {
    const row = await this.db.get<Record<string, unknown>>(
      "SELECT * FROM deals WHERE org_id = ? AND id = ?",
      [orgId, id],
    );
    return row ? rowToDomain<Deal>(row, DEAL_DEFS) : null;
  }

  async list(orgId: string, filter: DealFilter, page: Page): Promise<Paged<Deal>> {
    const where = ["org_id = ?"];
    const params: unknown[] = [orgId];
    if (filter.companyId) {
      where.push("company_id = ?");
      params.push(filter.companyId);
    }
    if (filter.stage) {
      where.push("stage = ?");
      params.push(filter.stage);
    }
    if (filter.status) {
      where.push("status = ?");
      params.push(filter.status);
    }
    if (filter.ownerUserId) {
      where.push("owner_user_id = ?");
      params.push(filter.ownerUserId);
    }
    const whereSql = where.join(" AND ");
    const totalRow = await this.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM deals WHERE ${whereSql}`,
      params,
    );
    const limit = Math.max(1, page.pageSize);
    const offset = Math.max(0, (page.page - 1) * page.pageSize);
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT * FROM deals WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return { items: rows.map((r) => rowToDomain<Deal>(r, DEAL_DEFS)), total: totalRow?.n ?? 0 };
  }

  async update(orgId: string, id: string, patch: Partial<Deal>, by: ByUser): Promise<Deal> {
    // deals 無 verified_status 欄，故不 bumpVerified；仍寫 human provenance（§3）。
    await applyHumanUpdate(this.db, "deals", "deal", orgId, id, patch as Record<string, unknown>, DEAL_DEFS, by);
    return (await this.findById(orgId, id))!;
  }

  async delete(orgId: string, id: string): Promise<void> {
    await this.db.run("DELETE FROM deals WHERE org_id = ? AND id = ?", [orgId, id]);
  }

  async listContacts(orgId: string, dealId: string): Promise<DealContact[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      "SELECT * FROM deal_contacts WHERE org_id = ? AND deal_id = ?",
      [orgId, dealId],
    );
    return rows.map(mapDealContact);
  }

  async addContact(orgId: string, dealId: string, input: NewDealContact): Promise<DealContact> {
    await this.db.run(
      `INSERT INTO deal_contacts (deal_id, contact_id, org_id, role, stance, influence, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(deal_id, contact_id) DO UPDATE SET
         role = excluded.role, stance = excluded.stance,
         influence = excluded.influence, notes = excluded.notes`,
      [
        dealId,
        input.contactId,
        orgId,
        input.role ?? null,
        input.stance ?? null,
        input.influence ?? null,
        input.notes ?? null,
      ],
    );
    const row = await this.db.get<Record<string, unknown>>(
      "SELECT * FROM deal_contacts WHERE org_id = ? AND deal_id = ? AND contact_id = ?",
      [orgId, dealId, input.contactId],
    );
    return mapDealContact(row!);
  }
}

function mapDealContact(r: Record<string, unknown>): DealContact {
  return {
    orgId: r.org_id as string,
    dealId: r.deal_id as string,
    contactId: r.contact_id as string,
    role: (r.role as DecisionPower | null) ?? undefined,
    stance: (r.stance as DealContactStance | null) ?? undefined,
    influence: (r.influence as number | null) ?? undefined,
    notes: (r.notes as string | null) ?? undefined,
  };
}

// ─────────────────────────────────────────────────────────────
// NoteRepository（多型 entityType+entityId）
// ─────────────────────────────────────────────────────────────
export class SqliteNoteRepository implements NoteRepository {
  constructor(private readonly db: DbPort) {}

  async list(orgId: string, entityType: NoteEntityType, entityId: string): Promise<Note[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT * FROM notes WHERE org_id = ? AND entity_type = ? AND entity_id = ?
       ORDER BY pinned DESC, created_at DESC`,
      [orgId, entityType, entityId],
    );
    return rows.map(mapNote);
  }

  async create(orgId: string, input: NewNote): Promise<Note> {
    const now = Date.now();
    const id = uuidv7();
    await this.db.run(
      `INSERT INTO notes (id, org_id, entity_type, entity_id, author_user_id, body, note_type, pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        orgId,
        input.entityType,
        input.entityId,
        input.authorUserId ?? null,
        input.body,
        input.noteType ?? "general",
        input.pinned ?? 0,
        now,
        now,
      ],
    );
    return (await this.findById(orgId, id))!;
  }

  async update(orgId: string, id: string, patch: Partial<Note>): Promise<Note> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if ("body" in patch) {
      sets.push("body = ?");
      vals.push(patch.body ?? null);
    }
    if ("noteType" in patch) {
      sets.push("note_type = ?");
      vals.push(patch.noteType ?? null);
    }
    if ("pinned" in patch) {
      sets.push("pinned = ?");
      vals.push(patch.pinned ?? 0);
    }
    sets.push("updated_at = ?");
    vals.push(Date.now());
    await this.db.run(`UPDATE notes SET ${sets.join(", ")} WHERE org_id = ? AND id = ?`, [...vals, orgId, id]);
    return (await this.findById(orgId, id))!;
  }

  async delete(orgId: string, id: string): Promise<void> {
    await this.db.run("DELETE FROM notes WHERE org_id = ? AND id = ?", [orgId, id]);
  }

  async upsertSingletonNote(orgId: string, input: SingletonNoteInput): Promise<Note> {
    const now = Date.now();
    const pinned = input.pinned ? 1 : 0;
    // 冪等鍵＝(org_id, entity_type, entity_id, note_type)：命中最早一筆（若歷史上意外有多筆，穩定更新同一筆）。
    const existing = await this.db.get<{ id: string }>(
      `SELECT id FROM notes WHERE org_id = ? AND entity_type = ? AND entity_id = ? AND note_type = ?
       ORDER BY created_at ASC LIMIT 1`,
      [orgId, input.entityType, input.entityId, input.noteType],
    );
    if (existing) {
      await this.db.run("UPDATE notes SET body = ?, pinned = ?, updated_at = ? WHERE org_id = ? AND id = ?", [
        input.body,
        pinned,
        now,
        orgId,
        existing.id,
      ]);
      return (await this.findById(orgId, existing.id))!;
    }
    const id = uuidv7();
    await this.db.run(
      `INSERT INTO notes (id, org_id, entity_type, entity_id, author_user_id, body, note_type, pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, orgId, input.entityType, input.entityId, null, input.body, input.noteType, pinned, now, now],
    );
    return (await this.findById(orgId, id))!;
  }

  private async findById(orgId: string, id: string): Promise<Note | null> {
    const row = await this.db.get<Record<string, unknown>>(
      "SELECT * FROM notes WHERE org_id = ? AND id = ?",
      [orgId, id],
    );
    return row ? mapNote(row) : null;
  }
}

function mapNote(r: Record<string, unknown>): Note {
  return {
    id: r.id as string,
    orgId: r.org_id as string,
    entityType: r.entity_type as NoteEntityType,
    entityId: r.entity_id as string,
    authorUserId: (r.author_user_id as string | null) ?? undefined,
    body: r.body as string,
    noteType: (r.note_type as NoteType | null) ?? undefined,
    pinned: (r.pinned as Bool01 | null) ?? undefined,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}
