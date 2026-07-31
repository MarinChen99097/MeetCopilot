/**
 * 「上次分數」查詢（W4）——GET /api/train/personas 每個 persona 附上最近一次對練的總分＋時間。
 *
 * 資料來源全部是**既有表**（008_training.sql）：`training_reports`（scores_json、created_at）
 * JOIN `training_sessions`（contact_id、ended_at）。**不開 migration、不新增欄位**。
 *
 * 為什麼查詢寫在 apps/server 而不是 packages/crm：與 realtime/meeting-store.ts 同一理由——
 * 這是消費端的彙總視角，不值得為它動 CRM 的凍結 repo 介面（平行開發期改 core.ts 會撞車）。
 * 一律 `org_id = ?`（兩張表都帶，join 亦帶）＝跨 org 天然隔離。
 */
import type { DbPort } from "@meetcopilot/crm";

/** 單一 contact 的「上次對練」摘要。 */
export interface LastPracticeSummary {
  /** 總分 0–100（各維度平均，四捨五入）。scores_json 壞掉/空 → 此筆整個略過（不回 0）。 */
  score: number;
  /** epoch-ms：session.ended_at 優先，缺則報告產生時間。 */
  at: number;
}

/**
 * 掃描上限：一次最多看 org 內最近 N 份報告。personas() 的候選 contact 數本身有界（掃 ≤500 家公司），
 * 而「最近 N 份報告」足以覆蓋任何近期練過的人；更早的紀錄不影響「上次分數」的正確性
 * （報告依時間 DESC，同一 contact 取第一筆即最新）。
 */
const MAX_REPORTS_SCANNED = 5000;

/**
 * 排序鍵刻意用 `COALESCE(s.ended_at, r.created_at)`——與下面回傳的 `at` **同一個值**，排序與顯示才不會打架
 * （`training_reports` 重評分時 ON CONFLICT 不更新 created_at，故 created_at 亦近似「當時練完的時間」）。
 * 次鍵 `r.id DESC` 只為打平同毫秒的並列：uuidv7 低位是隨機、選誰是任意的，但**同一份資料恆得同一答案**
 * （不隨 SQLite／Postgres 對並列的回傳順序而飄）。真實對練一場數分鐘，同毫秒並列只出現在測試裡。
 */

/**
 * scores_json → 0–100 總分。相容兩種歷史格式：
 *  - 新（TrainScores）：`[{label,score}, ...]` → score 平均。
 *  - 舊（固定四維 object）：`{objectionHandling,discovery,clarity,closing}` → 數值平均。
 * 無法解析／無任何數值 → null（呼叫端略過該筆，不編造分數）。
 */
export function overallScore(scoresJson: string | null): number | null {
  if (!scoresJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(scoresJson);
  } catch {
    return null;
  }
  const nums: number[] = [];
  if (Array.isArray(parsed)) {
    for (const d of parsed) {
      const s = (d as { score?: unknown })?.score;
      if (typeof s === "number" && Number.isFinite(s)) nums.push(s);
    }
  } else if (parsed && typeof parsed === "object") {
    for (const v of Object.values(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) nums.push(v);
    }
  }
  if (nums.length === 0) return null;
  const avg = nums.reduce((s, n) => s + n, 0) / nums.length;
  return Math.round(Math.min(100, Math.max(0, avg)));
}

/**
 * 本 org 每個 contact 的「最近一次對練」摘要。無報告的 contact 不會出現在 Map 裡
 * （呼叫端據此讓 lastScore/lastPracticedAt 維持 undefined ＝「尚未對練」）。
 */
export async function lastPracticeByContact(
  db: DbPort,
  orgId: string,
): Promise<Map<string, LastPracticeSummary>> {
  const rows = await db.all<{
    contact_id: string;
    scores_json: string | null;
    ended_at: number | null;
    created_at: number;
  }>(
    `SELECT s.contact_id AS contact_id,
            r.scores_json AS scores_json,
            s.ended_at    AS ended_at,
            r.created_at  AS created_at
       FROM training_reports r
       JOIN training_sessions s ON s.id = r.session_id AND s.org_id = r.org_id
      WHERE r.org_id = ?
      ORDER BY COALESCE(s.ended_at, r.created_at) DESC, r.id DESC
      LIMIT ?`,
    [orgId, MAX_REPORTS_SCANNED],
  );

  // DESC → 同一 contact 的**第一筆**即最新；後續（較舊）的一律略過。
  // `seen` 與 `out` 分開：最新那筆若 scores_json 壞掉，語意是「上次那場沒有可用分數」→ 回 undefined，
  // **不**退回去拿更舊的一場冒充「上次」（那會把時間與分數對不上）。
  const seen = new Set<string>();
  const out = new Map<string, LastPracticeSummary>();
  for (const r of rows) {
    if (seen.has(r.contact_id)) continue;
    seen.add(r.contact_id);
    const score = overallScore(r.scores_json);
    if (score === null) continue; // 壞資料：當作沒有上次分數，而不是顯示 0
    out.set(r.contact_id, { score, at: Number(r.ended_at ?? r.created_at) });
  }
  return out;
}
