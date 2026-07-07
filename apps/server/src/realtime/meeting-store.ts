/**
 * MeetingStore — meetings persistence for M3 (API_CONTRACT §5), over the CRM DbPort (no new migration).
 *
 * Scope note: this lives in apps/server (not packages/crm) on purpose. The M234 seam only froze Deck/Training
 * repos in packages/crm; adding a MeetingRepository there would mean editing core.ts concurrently with the M2/M4
 * build agents (conflict risk, CLAUDE.md rule 6). The 005 `meetings`/`meeting_transcript_segments`/`meeting_signals`
 * tables already exist, so we read/write them here via `core.db`. Row↔domain mapping stays local.
 *
 * The live meeting↔deck binding + consent + committedIndex mirror are held in-memory on the RealtimeHub for the
 * duration of the session (a durable 009_realtime.sql is allowed by M234 but deferred to integration to avoid
 * concurrent crm-package edits during the parallel M2/M3/M4 build).
 */
import { randomUUID } from "node:crypto";
import type { DbPort } from "@meetcopilot/crm";
import type { SignalItem, TranscriptSegment, TranscriptSpeaker } from "@meetcopilot/shared";
import { SIGNAL_KINDS, type SignalKind } from "@meetcopilot/shared";

/** Wire shape for POST /api/meetings + list rows (matches apps/web lib/api.ts MeetingRef). */
export interface MeetingRef {
  id: string;
  title?: string;
  companyId?: string;
  dealId?: string;
  deckId?: string;
  status?: string;
  createdAt?: number;
}

export interface NewMeeting {
  title: string;
  companyId?: string;
  dealId?: string;
  presenterUserId: string;
}

interface MeetingRow {
  id: string;
  company_id: string | null;
  deal_id: string | null;
  title: string | null;
  status: string | null;
  presenter_user_id: string | null;
  created_at: number;
}

interface TranscriptRow {
  id: string;
  t: number | null;
  speaker: string | null;
  is_final: number | null;
  text: string | null;
}

interface SignalRow {
  id: string;
  type: string;
  label: string | null;
  confidence: number | null;
}

const SPEAKERS: TranscriptSpeaker[] = ["presenter", "client", "unknown"];

export class MeetingStore {
  constructor(private readonly db: DbPort) {}

  async create(orgId: string, input: NewMeeting): Promise<{ id: string; presenterUserId: string; createdAt: number }> {
    const id = randomUUID();
    const now = Date.now();
    // meetings.company_id is NOT NULL (005); the API allows omitting companyId → store '' sentinel.
    await this.db.run(
      `INSERT INTO meetings
         (id, org_id, company_id, deal_id, copilot_session_id, title, status, presenter_user_id, started_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)`,
      [id, orgId, input.companyId ?? "", input.dealId ?? null, id, input.title, input.presenterUserId, now, now, now],
    );
    return { id, presenterUserId: input.presenterUserId, createdAt: now };
  }

  async findRef(orgId: string, id: string): Promise<MeetingRef | null> {
    const row = await this.db.get<MeetingRow>(
      `SELECT id, company_id, deal_id, title, status, presenter_user_id, created_at
         FROM meetings WHERE id = ? AND org_id = ?`,
      [id, orgId],
    );
    return row ? this.toRef(row) : null;
  }

  /** Presenter id for a meeting (WS auth cross-check). Returns null if the meeting doesn't exist in this org. */
  async presenterOf(orgId: string, id: string): Promise<string | null> {
    const row = await this.db.get<{ presenter_user_id: string | null }>(
      `SELECT presenter_user_id FROM meetings WHERE id = ? AND org_id = ?`,
      [id, orgId],
    );
    return row ? (row.presenter_user_id ?? null) : null;
  }

  async list(orgId: string, page: number, pageSize: number): Promise<{ items: MeetingRef[]; total: number }> {
    const total =
      (await this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM meetings WHERE org_id = ?`, [orgId]))?.n ?? 0;
    const rows = await this.db.all<MeetingRow>(
      `SELECT id, company_id, deal_id, title, status, presenter_user_id, created_at
         FROM meetings WHERE org_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [orgId, pageSize, (page - 1) * pageSize],
    );
    return { items: rows.map((r) => this.toRef(r)), total };
  }

  async end(orgId: string, id: string): Promise<boolean> {
    const now = Date.now();
    const res = await this.db.run(
      `UPDATE meetings SET status = 'completed', ended_at = ?, updated_at = ? WHERE id = ? AND org_id = ?`,
      [now, now, id, orgId],
    );
    return res.changes > 0;
  }

  /** Persist a finalized transcript segment (post-meeting review + RAG source). Best-effort. */
  async saveSegment(orgId: string, meetingId: string, seg: TranscriptSegment): Promise<void> {
    await this.db.run(
      `INSERT INTO meeting_transcript_segments
         (id, org_id, meeting_id, t, speaker, is_final, text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [seg.id, orgId, meetingId, seg.t, seg.speaker, seg.final ? 1 : 0, seg.text, Date.now()],
    );
  }

  /** Persist a signal (post-meeting review). Best-effort. */
  async saveSignal(orgId: string, meetingId: string, item: SignalItem): Promise<void> {
    await this.db.run(
      `INSERT INTO meeting_signals (id, org_id, meeting_id, type, label, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [item.id, orgId, meetingId, item.kind, item.label, item.confidence, Date.now()],
    );
  }

  async transcript(orgId: string, meetingId: string): Promise<TranscriptSegment[]> {
    const rows = await this.db.all<TranscriptRow>(
      `SELECT id, t, speaker, is_final, text FROM meeting_transcript_segments
         WHERE org_id = ? AND meeting_id = ? ORDER BY created_at ASC`,
      [orgId, meetingId],
    );
    return rows.map((r) => ({
      id: r.id,
      t: r.t ?? 0,
      speaker: (SPEAKERS.includes(r.speaker as TranscriptSpeaker) ? r.speaker : "unknown") as TranscriptSpeaker,
      text: r.text ?? "",
      final: r.is_final === 1,
    }));
  }

  async signals(orgId: string, meetingId: string): Promise<SignalItem[]> {
    const rows = await this.db.all<SignalRow>(
      `SELECT id, type, label, confidence FROM meeting_signals
         WHERE org_id = ? AND meeting_id = ? ORDER BY created_at ASC`,
      [orgId, meetingId],
    );
    return rows
      .filter((r) => SIGNAL_KINDS.includes(r.type as SignalKind))
      .map((r) => ({ id: r.id, kind: r.type as SignalKind, label: r.label ?? "", confidence: r.confidence ?? 0 }));
  }

  private toRef(row: MeetingRow): MeetingRef {
    return {
      id: row.id,
      title: row.title ?? undefined,
      companyId: row.company_id ? row.company_id : undefined,
      dealId: row.deal_id ?? undefined,
      status: row.status ?? undefined,
      createdAt: row.created_at,
    };
  }
}
