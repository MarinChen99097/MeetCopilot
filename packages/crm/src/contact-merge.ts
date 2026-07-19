/**
 * 主管（contacts）合併工具——兩處共用：
 *  (1) upsert fallback（child-upsert.ts CONTACT_SPEC ＋ repos-prospect.ts 深度路徑）：
 *      full_name 精配落空且 incoming fullNameZh 非空 → 以 full_name_zh 再配一次，命中即 fill-empty＋mergeTitle。
 *  (2) dedupeCompanyContacts：深度/more 研究落庫完成後，收斂同一人的多筆重複列
 *      （zh 鍵＝full_name_zh 或 full_name 內嵌 CJK 段；仍無鍵者以 full_name 羅馬正規化嚴格全等橋接）。
 *
 * 雙語不變量：主要欄留來源語言、*Zh 為 gloss；title/titleZh 各自累加。provenance「值與來源同一 tx 不漂移」沿用。
 * crm 刻意零 runtime 依賴 @meetcopilot/shared（見 ports.ts 分層註解）：本檔只用 DbPort ＋ mappers。
 */
import type { DbPort } from "./ports.js";
import { CONTACT_DEFS } from "./mappers.js";

/** title 段落分隔符：頓號、間隔號、全形/半形斜線。 */
const TITLE_SEP_RE = /[、·／/]/;
/** title/titleZh 累加上限段數。 */
const TITLE_MAX_SEGMENTS = 4;

/**
 * 合併兩個 title 字串：各以 [、·／/] 切段、trim＋收斂內部空白、去重（大小寫不敏感），
 * existing 段在前、incoming 段在後，「 · 」串接，上限 4 段。兩者皆空 → undefined。
 */
export function mergeTitle(existing: unknown, incoming: unknown): string | undefined {
  const segs: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown): void => {
    if (raw === null || raw === undefined) return;
    for (const part of String(raw).split(TITLE_SEP_RE)) {
      if (segs.length >= TITLE_MAX_SEGMENTS) return;
      const seg = part.trim().replace(/\s+/g, " ");
      if (!seg) continue;
      const norm = seg.toLowerCase();
      if (seen.has(norm)) continue;
      seen.add(norm);
      segs.push(seg);
    }
  };
  push(existing);
  push(incoming);
  return segs.length === 0 ? undefined : segs.join(" · ");
}

/** 空值判準（fill-empty 用）：null/undefined 或 trim 後空字串為空；數字 0 不算空。 */
export function isEmptyVal(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  return false;
}

/**
 * 就地調整「待寫入的 snake_case record」rec，使其符合合併語意：
 *  - accumulateCols（title/title_zh）：rec 若帶該欄 → 與 existing 值 mergeTitle 累加。
 *  - fillEmpty（fallback 命中時 true）：existing 已非空的欄一律不覆寫（accumulateCols 除外，已累加）。
 * 兩條 upsert 路徑（child-upsert / 深度）共用；rec 與 existingRow 皆為 DB snake_case。
 */
export function accumulateAndFillEmpty(
  rec: Record<string, unknown>,
  existingRow: Record<string, unknown>,
  opts: { accumulateCols: string[]; fillEmpty: boolean },
): void {
  const acc = new Set(opts.accumulateCols);
  for (const col of opts.accumulateCols) {
    if (!(col in rec)) continue;
    const merged = mergeTitle(existingRow[col], rec[col]);
    if (merged === undefined) delete rec[col];
    else rec[col] = merged;
  }
  if (opts.fillEmpty) {
    for (const col of Object.keys(rec)) {
      if (acc.has(col)) continue;
      if (!isEmptyVal(existingRow[col])) delete rec[col];
    }
  }
}

// ─────────────────────────────────────────────────────────────
// dedupeCompanyContacts — 收斂同一人的多筆重複列
//   （zh 鍵：full_name_zh／full_name 內嵌 CJK；羅馬鍵：full_name 正規化嚴格全等橋接）
// ─────────────────────────────────────────────────────────────

/** 合併時不從 victim 填入 survivor 的系統/驗證欄（fill-empty 略過）。 */
const DEDUPE_SKIP_COLS = new Set([
  "id",
  "org_id",
  "company_id",
  "created_at",
  "updated_at",
  "verified_status",
  "verified_by",
  "verified_at",
]);

/** dedupe 累加欄（各自 mergeTitle）。 */
const DEDUPE_ACC_COLS = ["title", "title_zh"];

/** contacts domain key → DB col（provenance fieldName 對映用）。 */
export const CONTACT_KEY_TO_COL: ReadonlyMap<string, string> = new Map(
  CONTACT_DEFS.map((d) => [d.key, d.col] as const),
);

export interface DedupeResult {
  /** 實際合併（≥1 victim 併入 survivor）的群數。 */
  groupsMerged: number;
  /** 被刪除的冗餘 contact 列數。 */
  contactsRemoved: number;
  /** 因群內 ≥2 human-verified 而跳過的群數。 */
  groupsSkipped: number;
}

interface ContactGroupRow {
  id: string;
  full_name: string | null;
  full_name_zh: string | null;
  created_at: number;
  verified_status: string | null;
}

/** 連續 CJK 段（≥2 字）——沿用 repo 慣例 /[㐀-鿿豈-﫿]/ 範圍（CJK Ext-A＋統一＋相容表意）。 */
const CJK_NAME_SEG_RE = /[㐀-鿿豈-﫿]{2,}/;

/**
 * 非人名 CJK 段黑名單（**完全相等才擋**）：地名/公司後綴/職稱等，避免把「John (台北)」「Mary (台北)」的地名
 * 誤當人名鍵而錯併不同人。僅擋整段完全相等者——不做子字串比對（如「科技部」不因含「科技」而被擋，保守）。
 */
const CJK_NON_NAME_STOPLIST = new Set([
  "台北", "臺北", "台中", "臺中", "台南", "臺南", "高雄", "新竹", "桃園", "台灣", "臺灣",
  "香港", "澳門", "中國", "北京", "上海", "深圳", "廣州",
  "公司", "集團", "股份", "有限", "科技", "企業", "總部", "分公司",
  "董事", "經理", "總監", "總裁", "顧問",
]);

/**
 * 從 full_name 抽第一段連續 CJK 當人名鍵（如「Cheng Chun-hung (程峻宏)」→「程峻宏」）；不合則 undefined。
 * 兩道護欄（防把地名/公司/描述誤當人名鍵而錯併不同人）：
 *  (a) 長度 2–4 字才收——中文姓名典型長度；≥5 字（如「台北辦公室」「股份有限公司」）多為機構/描述，一律略過。
 *  (b) 完全等於 CJK_NON_NAME_STOPLIST 的段（台北/公司/董事…）略過。
 * 只看第一段連續 CJK（保守）：首段不合即回 undefined，該列改走 Pass 2 羅馬拼音橋接。
 */
function extractEmbeddedCjkName(fullName: string | null | undefined): string | undefined {
  if (!fullName) return undefined;
  const m = CJK_NAME_SEG_RE.exec(fullName);
  if (!m) return undefined;
  const seg = m[0];
  const len = [...seg].length;
  if (len < 2 || len > 4) return undefined; // (a) 2–4 字才是典型人名
  if (CJK_NON_NAME_STOPLIST.has(seg)) return undefined; // (b) 地名/公司/職稱等非人名段
  return seg;
}

/**
 * 羅馬拼音正規化鍵：去括號內容（半/全形圓括號）、lowercase、去所有非 a-z0-9（連字號/空白/標點/CJK 一併去除）。
 * 供「仍無 zh 鍵的列」做**嚴格全等**橋接（保守零模糊）：
 *   「Cheng Chun-Hung」→ chengchunhung；「Cheng Chun-hung (程峻宏)」→ chengchunhung（相等→同人）。
 *   「David Chen」→ davidchen ≠「David Cheng」→ davidcheng（不併）。空字串＝無可用鍵。
 */
function normalizeRomanName(fullName: string | null | undefined): string {
  if (!fullName) return "";
  const noParen = fullName.replace(/[（(][^）)]*[）)]/g, " ");
  return noParen.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** 分組結果：一群待收斂的重複列（＋供回填的中文名，僅 zh 鍵群有）。 */
interface DedupeGroup {
  /** console.warn／稽核顯示鍵（zh 名或羅馬正規化字串）。 */
  displayKey: string;
  rows: ContactGroupRow[];
  /** 群的中文名（zh 鍵群才有）——合併時回填 survivor 空的 full_name_zh。 */
  zhName?: string;
}

/**
 * 分組（保守零模糊，見各 helper 註解）：
 *  Pass 1（zh 鍵）：full_name_zh 非空，或 full_name 內嵌 ≥2 字 CJK 段抽出，當分組鍵。
 *  Pass 2（羅馬鍵）：仍無鍵的列做 full_name 正規化——先橋接到某 zh 群（該群某成員 full_name 正規化嚴格相等），
 *                    否則彼此正規化嚴格相等才成新羅馬群。嚴格全等、不做部分匹配/模糊。
 * 群鍵優先序：zh 群優先；羅馬鍵只在能橋接到 zh 群成員或彼此相等時成群。
 */
function groupContactRows(rows: ContactGroupRow[]): DedupeGroup[] {
  // ── Pass 1：zh 鍵分組。─────────────────────────────────────
  const zhGroups = new Map<string, ContactGroupRow[]>();
  const keyless: ContactGroupRow[] = [];
  for (const r of rows) {
    let zhKey = (r.full_name_zh ?? "").trim();
    if (!zhKey) zhKey = extractEmbeddedCjkName(r.full_name) ?? "";
    if (zhKey) {
      const g = zhGroups.get(zhKey);
      if (g) g.push(r);
      else zhGroups.set(zhKey, [r]);
    } else {
      keyless.push(r);
    }
  }

  // zh 群成員的羅馬正規化名 → zhKey（供 keyless 列橋接；先到先得）。
  const romanToZhKey = new Map<string, string>();
  for (const [zhKey, grp] of zhGroups) {
    for (const r of grp) {
      const roman = normalizeRomanName(r.full_name);
      if (roman && !romanToZhKey.has(roman)) romanToZhKey.set(roman, zhKey);
    }
  }

  // ── Pass 2：仍無鍵的列——羅馬正規化嚴格全等才成群。────────────
  const romanGroups = new Map<string, ContactGroupRow[]>();
  for (const r of keyless) {
    const roman = normalizeRomanName(r.full_name);
    if (!roman) continue; // 無可用鍵 → 落單（不併）
    const zhKey = romanToZhKey.get(roman);
    if (zhKey) {
      zhGroups.get(zhKey)!.push(r); // 橋接進 zh 群（zh 鍵優先）
    } else {
      const g = romanGroups.get(roman);
      if (g) g.push(r);
      else romanGroups.set(roman, [r]);
    }
  }

  const out: DedupeGroup[] = [];
  for (const [zhKey, grp] of zhGroups) out.push({ displayKey: zhKey, rows: grp, zhName: zhKey });
  for (const [roman, grp] of romanGroups) out.push({ displayKey: roman, rows: grp });
  return out;
}

/** 該 contact 是否 human-verified：verified_status∈{verified,partial} 或有 human/verified 的現行 provenance。 */
async function isHumanVerified(
  db: DbPort,
  orgId: string,
  contactId: string,
  verifiedStatus: string | null,
): Promise<boolean> {
  if (verifiedStatus === "verified" || verifiedStatus === "partial") return true;
  const row = await db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM field_provenance
       WHERE org_id = ? AND entity_type = 'contact' AND entity_id = ? AND superseded_by IS NULL
         AND (filled_by = 'human' OR verified = 1)`,
    [orgId, contactId],
  );
  return (row?.n ?? 0) > 0;
}

/** 把 victim 的所有 contact_id/entity_id 參照 re-point 到 survivor（deal_contacts PK 撞先刪）。 */
async function repointContactRefs(
  db: DbPort,
  orgId: string,
  victimId: string,
  survivorId: string,
): Promise<void> {
  // deal_contacts：PK (deal_id, contact_id)。survivor 已在同 deal 的列 → 先刪 victim 重複列，其餘 re-point。
  await db.run(
    `DELETE FROM deal_contacts
       WHERE org_id = ? AND contact_id = ?
         AND deal_id IN (SELECT deal_id FROM deal_contacts WHERE org_id = ? AND contact_id = ?)`,
    [orgId, victimId, orgId, survivorId],
  );
  await db.run("UPDATE deal_contacts SET contact_id = ? WHERE org_id = ? AND contact_id = ?", [
    survivorId,
    orgId,
    victimId,
  ]);
  await db.run("UPDATE company_product_people SET contact_id = ? WHERE org_id = ? AND contact_id = ?", [
    survivorId,
    orgId,
    victimId,
  ]);
  // 組織圖 self-ref：避免 survivor 指向自己。
  await db.run(
    "UPDATE contacts SET reports_to_contact_id = ? WHERE org_id = ? AND reports_to_contact_id = ? AND id != ?",
    [survivorId, orgId, victimId, survivorId],
  );
  await db.run("UPDATE company_departments SET head_contact_id = ? WHERE org_id = ? AND head_contact_id = ?", [
    survivorId,
    orgId,
    victimId,
  ]);
  await db.run("UPDATE deals SET primary_contact_id = ? WHERE org_id = ? AND primary_contact_id = ?", [
    survivorId,
    orgId,
    victimId,
  ]);
  await db.run("UPDATE deals SET economic_buyer_contact_id = ? WHERE org_id = ? AND economic_buyer_contact_id = ?", [
    survivorId,
    orgId,
    victimId,
  ]);
  await db.run("UPDATE deals SET champion_contact_id = ? WHERE org_id = ? AND champion_contact_id = ?", [
    survivorId,
    orgId,
    victimId,
  ]);
  // meetings 側的 contact 參照＝meeting_attendees.contact_id（meetings 本表無 contact_id 欄）。
  await db.run("UPDATE meeting_attendees SET contact_id = ? WHERE org_id = ? AND contact_id = ?", [
    survivorId,
    orgId,
    victimId,
  ]);
  await db.run(
    "UPDATE meeting_transcript_segments SET speaker_contact_id = ? WHERE org_id = ? AND speaker_contact_id = ?",
    [survivorId, orgId, victimId],
  );
  await db.run("UPDATE activities SET contact_id = ? WHERE org_id = ? AND contact_id = ?", [
    survivorId,
    orgId,
    victimId,
  ]);
  await db.run("UPDATE training_sessions SET contact_id = ? WHERE org_id = ? AND contact_id = ?", [
    survivorId,
    orgId,
    victimId,
  ]);
  await db.run("UPDATE notes SET entity_id = ? WHERE org_id = ? AND entity_type = 'contact' AND entity_id = ?", [
    survivorId,
    orgId,
    victimId,
  ]);
}

/** 刪除某 contact 的 contact_card 檢索殘留（embeddings＋profile_cards）；indexer 之後會重建。 */
async function deleteStaleContactCards(db: DbPort, orgId: string, contactId: string): Promise<void> {
  await db.run("DELETE FROM embeddings WHERE org_id = ? AND entity_type = 'contact_card' AND entity_id = ?", [
    orgId,
    contactId,
  ]);
  await db.run("DELETE FROM profile_cards WHERE org_id = ? AND entity_type = 'contact_card' AND entity_id = ?", [
    orgId,
    contactId,
  ]);
}

/** 合併單一群（survivor 已定）：fill-empty＋mergeTitle＋provenance 併入＋re-point＋刪 stale 卡＋刪冗餘列。單群一交易。 */
async function mergeGroup(
  db: DbPort,
  orgId: string,
  survivorId: string,
  victims: ContactGroupRow[],
  backfillZh?: string,
): Promise<void> {
  await db.tx(async () => {
    const survivorRow = await db.get<Record<string, unknown>>("SELECT * FROM contacts WHERE org_id = ? AND id = ?", [
      orgId,
      survivorId,
    ]);
    if (!survivorRow) return;
    const merged: Record<string, unknown> = { ...survivorRow };

    // survivor 現行 provenance 欄集合（provenance 併入時用來擋重複 current 列）。
    const survProvFields = new Set<string>(
      (
        await db.all<{ field_name: string }>(
          `SELECT field_name FROM field_provenance
             WHERE org_id = ? AND entity_type = 'contact' AND entity_id = ? AND superseded_by IS NULL`,
          [orgId, survivorId],
        )
      ).map((r) => r.field_name),
    );

    // victim 依 created_at 由舊到新（早入者先填 survivor 空欄；provenance 早者勝）。
    const ordered = [...victims].sort((a, b) => a.created_at - b.created_at);
    for (const victim of ordered) {
      const vRow = await db.get<Record<string, unknown>>("SELECT * FROM contacts WHERE org_id = ? AND id = ?", [
        orgId,
        victim.id,
      ]);
      if (!vRow) continue;

      // (1) scalar fill-empty（不覆寫 survivor 非空；系統/驗證欄與累加欄除外）。
      for (const col of Object.keys(vRow)) {
        if (DEDUPE_SKIP_COLS.has(col) || col === "title" || col === "title_zh") continue;
        if (isEmptyVal(merged[col]) && !isEmptyVal(vRow[col])) merged[col] = vRow[col];
      }
      // (2) title/title_zh 各自 mergeTitle 累加。
      merged.title = mergeTitle(merged.title, vRow.title) ?? merged.title ?? null;
      merged.title_zh = mergeTitle(merged.title_zh, vRow.title_zh) ?? merged.title_zh ?? null;

      // (3) provenance 併入 survivor：survivor 已有的欄 → 刪 victim 該欄（survivor 勝）；其餘 re-point。
      if (survProvFields.size > 0) {
        const ph = [...survProvFields].map(() => "?").join(", ");
        await db.run(
          `DELETE FROM field_provenance
             WHERE org_id = ? AND entity_type = 'contact' AND entity_id = ? AND field_name IN (${ph})`,
          [orgId, victim.id, ...survProvFields],
        );
      }
      const vCurrent = await db.all<{ field_name: string }>(
        `SELECT field_name FROM field_provenance
           WHERE org_id = ? AND entity_type = 'contact' AND entity_id = ? AND superseded_by IS NULL`,
        [orgId, victim.id],
      );
      for (const f of vCurrent) survProvFields.add(f.field_name);
      await db.run(
        "UPDATE field_provenance SET entity_id = ? WHERE org_id = ? AND entity_type = 'contact' AND entity_id = ?",
        [survivorId, orgId, victim.id],
      );

      // (4) re-point 所有 FK 參照 ＋ (5) 刪 victim 的 stale 卡 ＋ (6) 刪 victim 列。
      await repointContactRefs(db, orgId, victim.id, survivorId);
      await deleteStaleContactCards(db, orgId, victim.id);
      await db.run("DELETE FROM contacts WHERE org_id = ? AND id = ?", [orgId, victim.id]);
    }

    // (backfill) survivor.full_name_zh 仍空 → 用群的中文名（來自 full_name_zh 或 full_name 內嵌 CJK 抽取）回填。
    if (backfillZh && isEmptyVal(merged.full_name_zh)) merged.full_name_zh = backfillZh;

    // 寫回合併後的 survivor（id/org_id 走 WHERE，不進 SET）。
    merged.updated_at = Date.now();
    const cols = Object.keys(merged).filter((c) => c !== "id" && c !== "org_id");
    if (cols.length > 0) {
      await db.run(
        `UPDATE contacts SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE org_id = ? AND id = ?`,
        [...cols.map((c) => merged[c] ?? null), orgId, survivorId],
      );
    }
    // survivor 卡也已 stale（資料變了）→ 刪除，讓 indexer 以合併後資料重建。
    await deleteStaleContactCards(db, orgId, survivorId);
  });
}

/**
 * 收斂一家公司的重複主管列（≥2 列的群；分組見 groupContactRows）。分組鍵（保守零模糊）：
 *  (1) zh 鍵：full_name_zh 非空，或 full_name 內嵌 ≥2 字 CJK 段抽出（合併時回填 survivor 空的 full_name_zh）。
 *  (2) 羅馬鍵：仍無鍵者做 full_name 正規化（去括號/lowercase/去連字號空白標點）後**嚴格全等**才同群，
 *      且需能橋接到某 zh 群成員或彼此相等（David Chen≠David Cheng）。
 * survivor＝唯一 human-verified 列；否則 created_at 最舊。群內 ≥2 human-verified → 跳過＋console.warn。
 * 深度/more 研究落庫完成後由 orchestrator 呼叫（傳入 core.db）。
 */
export async function dedupeCompanyContacts(
  db: DbPort,
  orgId: string,
  companyId: string,
): Promise<DedupeResult> {
  const rows = await db.all<ContactGroupRow>(
    "SELECT id, full_name, full_name_zh, created_at, verified_status FROM contacts WHERE org_id = ? AND company_id = ?",
    [orgId, companyId],
  );

  const groups = groupContactRows(rows);

  const result: DedupeResult = { groupsMerged: 0, contactsRemoved: 0, groupsSkipped: 0 };

  for (const group of groups) {
    const grp = group.rows;
    if (grp.length < 2) continue;

    // human-verified 旗標（決定 survivor 與護欄）。
    const flags = await Promise.all(grp.map((r) => isHumanVerified(db, orgId, r.id, r.verified_status)));
    const verifiedRows = grp.filter((_, i) => flags[i]);
    if (verifiedRows.length >= 2) {
      // eslint-disable-next-line no-console
      console.warn(
        `[crm] dedupeCompanyContacts: 群「${group.displayKey}」有 ${verifiedRows.length} 筆 human-verified，跳過（需人工判斷）。org=${orgId} company=${companyId}`,
      );
      result.groupsSkipped++;
      continue;
    }

    let survivor: ContactGroupRow;
    if (verifiedRows.length === 1) {
      survivor = verifiedRows[0]!;
    } else {
      survivor = grp.reduce((a, b) => (a.created_at <= b.created_at ? a : b));
    }
    const victims = grp.filter((r) => r.id !== survivor.id);
    if (victims.length === 0) continue;

    await mergeGroup(db, orgId, survivor.id, victims, group.zhName);
    result.groupsMerged++;
    result.contactsRemoved += victims.length;
  }

  return result;
}
