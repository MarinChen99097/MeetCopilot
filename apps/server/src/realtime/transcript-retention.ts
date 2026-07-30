/**
 * transcript-retention — TTL purge of persisted transcript segments (M5 §A).
 *
 * Only opted-in meetings (persist_transcript=1) ever write to meeting_transcript_segments; this routine deletes
 * those rows once they age past their meeting's retention_days (per-meeting; NULL → the 30-day service default).
 * Runs once on boot and then daily. The interval is unref'd so it never keeps the process alive on its own, and
 * a failed purge is logged (count only — NEVER any transcript text/PII) without tearing anything down.
 *
 * Second surface (023 checklist): `meeting_checklist_items.evidence` holds a **prefix of the very same transcript
 * string** whenever `covered_by='transcript'` (hub.ts writes `route.persist?.text`, the same value that goes into
 * meeting_transcript_segments). It must therefore age out under the same TTL, or transcript bytes would survive
 * forever in a second table. Only the `evidence` column is nulled — the checklist rows themselves are meeting
 * artefacts (post-meeting review needs them).
 *
 * The predicate **excludes `covered_by='slide'` rather than matching only `'transcript'`** (privacy hole found in
 * adversarial review): `setStatus(...,'covered','manual')` rewrites `covered_by` and — before the repo-side fix —
 * left `evidence` alone, so a presenter who ticked a checkbox during the 300 ms snapshot-broadcast debounce (item
 * still shown as pending on the HUD, already covered by transcript in the DB) flipped the row to `'manual'` while
 * it kept the transcript prefix → a `covered_by='transcript'` predicate would never see it again and the transcript
 * bytes would outlive the TTL forever. `'slide'` is the only source whose evidence is provably not transcript
 * content ("第 N 頁"), so it is the only one excluded; clearing a genuinely-manual row's evidence is a no-op
 * (it is NULL by construction). repos-checklist.setStatus also nulls evidence on a source change — belt and braces.
 */
import type { DbPort } from "@meetcopilot/crm";

const DAY_MS = 86_400_000;
/** Fallback when a meeting's retention_days is NULL (M5 §A / migration 009 comment). */
const DEFAULT_RETENTION_DAYS = 30;
const DAILY_MS = 24 * 60 * 60 * 1000;

export interface RetentionHandle {
  /**
   * Run a purge immediately (also used by tests); resolves to the number of transcript segment rows **deleted**.
   * Checklist `evidence` columns nulled in the same pass are counted/logged separately (nothing is deleted there).
   */
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

    // Same TTL, second surface: null out checklist evidence that *may be* transcript bytes (see file header).
    // The age predicate is the very same expression as the DELETE above (COALESCE(retention_days, 30) * DAY_MS);
    // only the row timestamp differs — `covered_at` is the moment the transcript prefix was copied in
    // (markCovered sets covered_by/covered_at/evidence together), i.e. the counterpart of a segment's created_at.
    // COALESCE(..., created_at) is defence-in-depth only, so a hand-mangled NULL covered_at can never mean
    // "never expires". Bounded single statement; logs count only, never any text.
    // `covered_by IS NULL OR covered_by <> 'slide'` (NOT `IS DISTINCT FROM` — unsupported by older SQLite):
    // everything except "第 N 頁" is treated as potentially transcript-derived. See header for the 'manual' path.
    const ev = await db.run(
      `UPDATE meeting_checklist_items
          SET evidence = NULL, updated_at = ?
        WHERE (covered_by IS NULL OR covered_by <> 'slide')
          AND evidence IS NOT NULL
          AND COALESCE(covered_at, created_at) < ? - (COALESCE(
            (SELECT m.retention_days FROM meetings m WHERE m.id = meeting_checklist_items.meeting_id),
            ?
          ) * ?)`,
      [now, now, DEFAULT_RETENTION_DAYS, DAY_MS],
    );
    if (ev.changes > 0) {
      console.log(`[retention] cleared transcript evidence on ${ev.changes} checklist item(s) past TTL`);
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
