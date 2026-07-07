/**
 * Realtime shared utilities (M3). Kept dependency-free so ASR/analysis/orchestrator can import without cycles.
 */

/**
 * Bound an external async call (Gemini transcription/analysis/grounding) so a hung upstream socket can never
 * wedge a session forever (L13: external processes/sockets MUST be bounded). The underlying request is not
 * force-aborted (@google/genai has no cheap abort here) — we simply stop awaiting and let the caller recover.
 */
export function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Clamp to [0,1] (confidence hygiene for LLM-produced numbers). */
export function clamp01(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.min(1, Math.max(0, v));
}
