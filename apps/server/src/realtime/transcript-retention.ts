/**
 * transcript-retention — TTL purge of persisted transcript segments (M5 §A).
 *
 * Only opted-in meetings (persist_transcript=1) ever write to meeting_transcript_segments; this routine deletes
 * those rows once they age past their meeting's retention_days (per-meeting; NULL → the 30-day service default).
 * Runs once on boot and then daily. The interval is unref'd so it never keeps the process alive on its own, and
 * a failed purge is logged (count only — NEVER any transcript text/PII) without tearing anything down.
 */
import type { DbPort } from "@meetcopilot/crm";

const DAY_MS = 86_400_000;
/** Fallback when a meeting's retention_days is NULL (M5 §A / migration 009 comment). */
const DEFAULT_RETENTION_DAYS = 30;
const DAILY_MS = 24 * 60 * 60 * 1000;

export interface RetentionHandle {
  /** Run a purge immediately (also used by tests); resolves to the number of rows deleted. */
  runOnce(): Promise<number>;
  /** Stop the daily timer (graceful shutdown). */
  stop(): void;
}

/**
 * Start the retention purge loop. Purges once immediately (non-fatal on error), then every `intervalMs`
 * (default 24h). Returns a handle to run on demand / stop the timer.
 */
export function startTranscriptRetention(db: DbPort, opts?: { intervalMs?: number }): RetentionHandle {
  const runOnce = async (): Promise<number> => {
    const now = Date.now();
    // Delete segments older than their meeting's retention window (correlated subquery per row; COALESCE
    // supplies the 30-day default when retention_days is NULL). Bounded single statement; logs count only.
    const res = await db.run(
      `DELETE FROM meeting_transcript_segments
         WHERE created_at < ? - (COALESCE(
           (SELECT m.retention_days FROM meetings m WHERE m.id = meeting_transcript_segments.meeting_id),
           ?
         ) * ?)`,
      [now, DEFAULT_RETENTION_DAYS, DAY_MS],
    );
    if (res.changes > 0) {
      console.log(`[retention] purged ${res.changes} persisted transcript segment(s) past TTL`);
    }
    return res.changes;
  };

  // Boot purge — non-fatal (a startup DB hiccup must not crash the server).
  void runOnce().catch((err) => console.warn(`[retention] boot purge failed: ${(err as Error).message}`));

  const timer = setInterval(() => {
    void runOnce().catch((err) => console.warn(`[retention] purge failed: ${(err as Error).message}`));
  }, opts?.intervalMs ?? DAILY_MS);
  if (typeof timer.unref === "function") timer.unref();

  return { runOnce, stop: () => clearInterval(timer) };
}
