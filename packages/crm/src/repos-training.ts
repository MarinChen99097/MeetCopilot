/**
 * TrainingRepository 實作（M4 語音模擬訓練；CRM_SCHEMA §8 尾備忘、M234_CONTRACT §M4、008_training.sql）。
 * org-scoping 鐵律：每個方法收 orgId 並注入 WHERE org_id = ?；跨租戶結構上不可能外洩。
 * 語音本身經 ephemeral token 直連 Gemini Live、不落我方 server；本表只存 session 簿記＋雙向逐字稿＋課後評分報告。
 */
import type { DbPort } from "./ports.js";
import type { TrainingRepository } from "./ports.js";
import type {
  TrainSession,
  NewTrainSession,
  TrainTurn,
  TrainReport,
  NewTrainReport,
  TrainDifficulty,
  TrainScores,
  TrainHighlight,
} from "@meetcopilot/shared";
import { uuidv7 } from "./uuid.js";

// ─────────────────────────────────────────────────────────────
// training_sessions
// ─────────────────────────────────────────────────────────────
export class SqliteTrainingRepository implements TrainingRepository {
  constructor(private readonly db: DbPort) {}

  async createSession(orgId: string, input: NewTrainSession): Promise<TrainSession> {
    const now = Date.now();
    const id = uuidv7();
    const difficulty: TrainDifficulty = input.difficulty ?? "neutral";
    await this.db.run(
      `INSERT INTO training_sessions
         (id, org_id, contact_id, deal_id, difficulty, started_at, ended_at, transcript_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, orgId, input.contactId, input.dealId ?? null, difficulty, now, null, null, now],
    );
    return (await this.findSession(orgId, id))!;
  }

  async findSession(orgId: string, id: string): Promise<TrainSession | null> {
    const row = await this.db.get<Record<string, unknown>>(
      "SELECT * FROM training_sessions WHERE org_id = ? AND id = ?",
      [orgId, id],
    );
    return row ? mapSession(row) : null;
  }

  async saveTranscript(orgId: string, sessionId: string, turns: TrainTurn[]): Promise<void> {
    // 對練中/結束時整包覆寫（前端累積後上傳；append-only 語意由前端維護，server 存最新全量）。
    await this.db.run(
      "UPDATE training_sessions SET transcript_json = ? WHERE org_id = ? AND id = ?",
      [JSON.stringify(turns), orgId, sessionId],
    );
  }

  async finishSession(orgId: string, sessionId: string): Promise<void> {
    // 只在尚未設定時寫入（掛斷/結束冪等；重複 finish 不覆蓋首次結束時間）。
    await this.db.run(
      "UPDATE training_sessions SET ended_at = ? WHERE org_id = ? AND id = ? AND ended_at IS NULL",
      [Date.now(), orgId, sessionId],
    );
  }

  async createReport(orgId: string, input: NewTrainReport): Promise<{ reportId: string }> {
    const now = Date.now();
    const id = uuidv7();
    // UNIQUE(org_id, session_id)：重評分冪等——衝突則更新既有列（保留原 id），故回既有 reportId。
    await this.db.run(
      `INSERT INTO training_reports
         (id, org_id, session_id, scores_json, highlights_json, summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_id, session_id) DO UPDATE SET
         scores_json = excluded.scores_json,
         highlights_json = excluded.highlights_json,
         summary = excluded.summary`,
      [
        id,
        orgId,
        input.sessionId,
        JSON.stringify(input.scores),
        JSON.stringify(input.highlights),
        input.summary,
        now,
      ],
    );
    const existing = await this.db.get<{ id: string }>(
      "SELECT id FROM training_reports WHERE org_id = ? AND session_id = ?",
      [orgId, input.sessionId],
    );
    return { reportId: existing?.id ?? id };
  }

  async findReport(orgId: string, reportId: string): Promise<TrainReport | null> {
    const row = await this.db.get<Record<string, unknown>>(
      "SELECT * FROM training_reports WHERE org_id = ? AND id = ?",
      [orgId, reportId],
    );
    return row ? mapReport(row) : null;
  }
}

function mapSession(r: Record<string, unknown>): TrainSession {
  const transcriptJson = r.transcript_json as string | null;
  return {
    id: r.id as string,
    orgId: r.org_id as string,
    contactId: r.contact_id as string,
    dealId: (r.deal_id as string | null) ?? undefined,
    difficulty: r.difficulty as TrainDifficulty,
    startedAt: (r.started_at as number | null) ?? undefined,
    endedAt: (r.ended_at as number | null) ?? undefined,
    transcript: transcriptJson ? (JSON.parse(transcriptJson) as TrainTurn[]) : undefined,
    createdAt: r.created_at as number,
  };
}

function mapReport(r: Record<string, unknown>): TrainReport {
  const highlightsJson = r.highlights_json as string | null;
  return {
    scores: JSON.parse(r.scores_json as string) as TrainScores,
    highlights: highlightsJson ? (JSON.parse(highlightsJson) as TrainHighlight[]) : [],
    summary: (r.summary as string | null) ?? "",
  };
}
