/**
 * 多輪研究（RESEARCH_UPGRADE_CONTRACT §3）。round 1＝基礎角度＋社群模板；擷取後做缺口分析 → 產 follow-up 查詢
 * → round 2/3；**一輪無新增事實即提早停**。累積各輪的 sourceTexts/groundedFindings（去重）成單一 bundle 供合成。
 *
 * 「新增事實」判準：本輪帶回**先前未見過的來源 URL**（深讀來源 url ∪ citation url）數。一輪 0 新來源 → 停。
 * 另有整場軟預算閘門（opts.budgetMs，預設 DEEP_RESEARCH_BUDGET_MS）：開場定 deadline＝now＋budget，逾期不開新輪
 * ——注意 budget 是**整場**（全部輪加總）語意，非每輪；DeepResearcher.research 內部另有每次呼叫的 deadline。
 * 純函式化的迴圈（researcher 注入），可用假 DeepResearcher 單測「無新事實提早停」與「整場預算到期不開新輪」。
 */
import type { DeepResearcher, DeepResearchInput, DeepResearchBundle } from "./deep-research.js";
import { buildSocialQueries, deepBudgetMs } from "./deep-research.js";

export interface DeepRoundsResult {
  bundle: DeepResearchBundle;
  /** 實際跑了幾輪（≤ rounds）。 */
  rounds: number;
}

export interface DeepRoundsOptions {
  /** 最多輪數（DEEP_RESEARCH_ROUNDS）。 */
  rounds: number;
  /**
   * **整場**（全部輪加總）軟預算（ms，預設 DEEP_RESEARCH_BUDGET_MS）。開場即算 deadline＝now＋budget；
   * 每輪開始前檢查，逾期不開新輪。注意 DeepResearcher.research 內部另有**每次呼叫**的 deadline，故此處是
   * 「不再開新輪」的整場閘門，已在跑的輪不強殺（由 job timeout 兜底）。
   */
  budgetMs?: number;
  /** 缺口分析 → 本輪之後的 follow-up 查詢（回 [] 表示無缺口 → 不再進下一輪）。 */
  buildFollowUps?: (bundle: DeepResearchBundle) => { angle: string; query: string }[];
  /** 每輪結束回呼（更新 crawl_jobs 進度用）：round 序號、累積來源 URL、本輪新增來源數。 */
  onRound?: (round: number, sources: string[], newSources: number) => void | Promise<void>;
}

/** 依 URL 併入（去重）；回本輪新增的來源 URL 數。 */
function mergeBundle(acc: DeepResearchBundle, b: DeepResearchBundle, seenUrls: Set<string>): number {
  let added = 0;
  for (const st of b.sourceTexts) {
    if (seenUrls.has(st.url)) continue;
    seenUrls.add(st.url);
    acc.sourceTexts.push(st);
    added++;
  }
  for (const f of b.groundedFindings) acc.groundedFindings.push(f);
  for (const c of b.citationUrls) {
    if (seenUrls.has(c)) continue;
    seenUrls.add(c);
    if (!acc.citationUrls.includes(c)) acc.citationUrls.push(c);
    added++;
  }
  return added;
}

export async function runDeepRounds(
  researcher: DeepResearcher,
  input: DeepResearchInput,
  opts: DeepRoundsOptions,
): Promise<DeepRoundsResult> {
  const acc: DeepResearchBundle = { groundedFindings: [], sourceTexts: [], citationUrls: [] };
  const seenUrls = new Set<string>();
  const maxRounds = Math.max(1, opts.rounds);
  // 整場軟 deadline：開場即定（now＋預算），逾期不開新輪——避免多輪各自吃滿每次呼叫預算而把整場乘上輪數。
  const overallDeadline = Date.now() + (opts.budgetMs ?? deepBudgetMs());
  let ran = 0;

  for (let r = 1; r <= maxRounds; r++) {
    // round 1 一律跑（至少一輪基礎研究）；第 2 輪起若整場預算已到期就不再開新輪（已在跑的輪不強殺）。
    if (r > 1 && Date.now() >= overallDeadline) break;
    let roundInput: DeepResearchInput;
    if (r === 1) {
      // round 1：基礎角度 + 社群模板（includeSocial 預設 true）。
      roundInput = { ...input, includeBaseQueries: true };
    } else {
      // follow-up round：只跑缺口分析產生的查詢（不重跑基礎/社群）。includeBaseQueries=false 時 queriesForRound
      // 不會讀 includeSocial（deep-research.ts queriesForRound），故此處不需再傳 includeSocial:false（死參數已移除）。
      const followUps = opts.buildFollowUps?.(acc) ?? [];
      if (followUps.length === 0) break; // 無缺口 → 提早停
      roundInput = { ...input, includeBaseQueries: false, extraQueries: followUps };
    }

    const b = await researcher.research(roundInput);
    ran = r;
    const newSources = mergeBundle(acc, b, seenUrls);
    await opts.onRound?.(r, [...seenUrls], newSources);

    // 一輪無新增事實（0 新來源）即提早停——但 round 1 一律保留（至少一輪基礎研究）。
    if (r > 1 && newSources === 0) break;
  }

  return { bundle: acc, rounds: ran };
}

/**
 * 缺口分析（heuristic）：依各角度（angle）累積的 citation 數，對「證據薄弱（<2）」的角度產生更深入的 follow-up 查詢。
 * 不呼叫 LLM（省成本、確定性）。上限 13 條（雙語各一，S1-A1）。社群模板已於 round 1 涵蓋，這裡聚焦結構化欄位缺口。
 */
export function buildFollowUpQueries(
  companyName: string,
  bundle: DeepResearchBundle,
): { angle: string; query: string }[] {
  const byAngle = new Map<string, number>();
  for (const f of bundle.groundedFindings) {
    byAngle.set(f.angle, (byAngle.get(f.angle) ?? 0) + f.citations.length);
  }
  const n = companyName;
  // S1-A1：gap 加深查詢**改雙語各一條**（每個證據薄弱的角度同時出 zh + en 加深查詢）。
  const deepen: Record<string, { zh: string; en: string }> = {
    overview: { zh: `${n} 公司背景 歷史 沿革 主要股東 組織架構`, en: `${n} company background history major shareholders org structure` },
    leadership: { zh: `${n} 高階主管 完整名單 董事會 職稱 學經歷`, en: `${n} executives full list board of directors titles background` },
    funding: { zh: `${n} 財務 營收 資本額 募資 投資人 歷史`, en: `${n} financials revenue capital funding investors history` },
    news: { zh: `${n} 2024 2025 最新 重大 消息 進展 公告`, en: `${n} 2024 2025 latest major news developments announcements` },
    competitors: { zh: `${n} 產業地位 市佔率 競爭格局 主要對手`, en: `${n} market position market share competitive landscape rivals` },
    products: { zh: `${n} 產品線 服務項目 完整 定價 方案`, en: `${n} product line services full pricing plans` },
  };
  const out: { angle: string; query: string }[] = [];
  for (const [angle, q] of Object.entries(deepen)) {
    if ((byAngle.get(angle) ?? 0) < 2) {
      out.push({ angle, query: q.zh });
      out.push({ angle, query: q.en });
    }
  }
  // round 1 一定跑過社群模板；若社群角度證據仍薄，補一條深入社群輿情查詢。
  if ((byAngle.get("social") ?? 0) < 2) {
    out.push({ angle: "social", query: buildSocialQueries({ companyName: n }).slice(-1)[0]?.query ?? `${n} social media` });
  }
  // 雙語各一條 → 上限放寬到 13（6 角度 × 2 + 社群 1）。仍由 ROUND_QUERY_CEIL 二次收斂。
  return out.slice(0, 13);
}
