/**
 * ChecklistRepository 驗收（vitest, in-memory DB）：023 DDL ＋ replaceAll/list 往返、
 * markCovered「只動 pending」＋空回傳語意、setStatus 三態、org 隔離、keywords_json 爛資料韌性。
 * 契約：docs/MEETING_CHECKLIST_CONTRACT.md §2/§3。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestCore } from "../src/test-helpers.js";
import type { CrmCore } from "../src/ports.js";
import type { NewChecklistItem } from "@meetcopilot/shared";

let core: CrmCore;
const ORG = "org-checklist-test";
const OTHER_ORG = "org-attacker";
const MEETING = "meeting-1";

function item(idx: number, over: Partial<NewChecklistItem> = {}): NewChecklistItem {
  return {
    idx,
    category: "talk",
    title: `項目 ${idx}`,
    keywords: [`kw${idx}`],
    priority: "must",
    ...over,
  };
}

beforeEach(async () => {
  core = await makeTestCore();
  await core.migrate();
});
afterEach(() => core.close());

describe("ChecklistRepository", () => {
  it("replaceAll → list 往返：欄位完整保存、依 idx 排序、整份取代（非累加）", async () => {
    const saved = await core.checklist.replaceAll(ORG, MEETING, [
      item(1, { category: "ask", title: "問預算", detail: "問到金額區間", keywords: ["預算", "budget"] }),
      item(0, { slideIdx: 2, priority: "nice" }),
    ]);
    expect(saved.map((i) => i.idx)).toEqual([0, 1]); // 回傳已依 idx 排序

    const listed = await core.checklist.list(ORG, MEETING);
    expect(listed).toHaveLength(2);
    const first = listed[0]!;
    const second = listed[1]!;
    expect(first.slideIdx).toBe(2);
    expect(first.priority).toBe("nice");
    expect(first.status).toBe("pending");
    expect(first.coveredBy).toBeUndefined();
    expect(second.category).toBe("ask");
    expect(second.detail).toBe("問到金額區間");
    expect(second.keywords).toEqual(["預算", "budget"]);
    expect(first.id).not.toBe(second.id);

    // 再 replaceAll 一次 → 整份取代（舊列消失，不是 append）
    const again = await core.checklist.replaceAll(ORG, MEETING, [item(0, { title: "全新的" })]);
    expect(again).toHaveLength(1);
    expect(again[0]!.title).toBe("全新的");
    expect(await core.checklist.list(ORG, MEETING)).toHaveLength(1);
  });

  it("markCovered 只動 pending：已 manual covered 的項目不被自動路徑覆寫", async () => {
    const items = await core.checklist.replaceAll(ORG, MEETING, [item(0), item(1)]);
    const a = items[0]!;
    const b = items[1]!;

    // 報告者先手動勾掉 a
    await core.checklist.setStatus(ORG, MEETING, a.id, "covered");

    // 自動路徑（transcript）同時報 a 與 b → 只有 b 真的被改
    const changed = await core.checklist.markCovered(ORG, MEETING, [a.id, b.id], "transcript", "對方問到這題");
    expect(changed.map((i) => i.id)).toEqual([b.id]);
    expect(changed[0]!.coveredBy).toBe("transcript");
    expect(changed[0]!.evidence).toBe("對方問到這題");

    // a 的 manual 背書完好無損
    const after = await core.checklist.list(ORG, MEETING);
    const aAfter = after.find((i) => i.id === a.id)!;
    expect(aAfter.status).toBe("covered");
    expect(aAfter.coveredBy).toBe("manual"); // ← 未被 'transcript' 覆寫
    expect(aAfter.evidence).toBeUndefined();
  });

  it("markCovered 無變化時回空陣列（→ 呼叫端不廣播）；重跑冪等", async () => {
    const items = await core.checklist.replaceAll(ORG, MEETING, [item(0)]);
    const a = items[0]!;

    expect(await core.checklist.markCovered(ORG, MEETING, [], "slide")).toEqual([]); // 空輸入
    expect(await core.checklist.markCovered(ORG, MEETING, [a.id], "slide", "第 1 頁")).toHaveLength(1);
    expect(await core.checklist.markCovered(ORG, MEETING, [a.id], "slide", "第 1 頁")).toEqual([]); // 第二次＝零變化
    expect(await core.checklist.markCovered(ORG, MEETING, ["不存在的 id"], "transcript")).toEqual([]);

    // skipped 也不被自動路徑覆寫
    const skipped = await core.checklist.replaceAll(ORG, MEETING, [item(0)]);
    const s = skipped[0]!;
    await core.checklist.setStatus(ORG, MEETING, s.id, "skipped");
    expect(await core.checklist.markCovered(ORG, MEETING, [s.id], "transcript")).toEqual([]);
    expect((await core.checklist.list(ORG, MEETING))[0]!.status).toBe("skipped");
  });

  it("setStatus：uncheck 清空 cover 三欄、skip 亦清空、covered 記 manual", async () => {
    const items = await core.checklist.replaceAll(ORG, MEETING, [item(0)]);
    const a = items[0]!;

    await core.checklist.markCovered(ORG, MEETING, [a.id], "transcript", "逐字稿片段");
    const unchecked = await core.checklist.setStatus(ORG, MEETING, a.id, "pending");
    expect(unchecked?.status).toBe("pending");
    expect(unchecked?.coveredBy).toBeUndefined();
    expect(unchecked?.coveredAt).toBeUndefined();
    expect(unchecked?.evidence).toBeUndefined();

    const checked = await core.checklist.setStatus(ORG, MEETING, a.id, "covered");
    expect(checked?.coveredBy).toBe("manual");
    expect(typeof checked?.coveredAt).toBe("number");

    const skipped = await core.checklist.setStatus(ORG, MEETING, a.id, "skipped");
    expect(skipped?.status).toBe("skipped");
    expect(skipped?.coveredBy).toBeUndefined();
    expect(skipped?.coveredAt).toBeUndefined();
  });

  it("setStatus('covered') 換來源時清掉舊 evidence（隱私：transcript→manual 不得帶著逐字稿位元組）", async () => {
    // 攻擊時序（對抗式復驗實測過的洞）：對話勾稽先寫入逐字 evidence，但 HUD snapshot 有 300ms debounce，
    // 這段時間報告者看到的仍是 pending → 點 checkbox → setStatus(...,'covered','manual')。
    // 舊實作 evidence 不動 → 該列從此不符 TTL purge 的來源條件 → 逐字內容永久留存。
    const QUOTE = "對方說預算大概三百萬";
    const items = await core.checklist.replaceAll(ORG, MEETING, [item(0)]);
    const a = items[0]!;

    await core.checklist.markCovered(ORG, MEETING, [a.id], "transcript", QUOTE);
    const raw0 = await core.db.get<{ evidence: string | null }>(
      "SELECT evidence FROM meeting_checklist_items WHERE id = ?",
      [a.id],
    );
    expect(raw0!.evidence).toBe(QUOTE); // 前提：DB 裡確實有逐字內容

    const flipped = await core.checklist.setStatus(ORG, MEETING, a.id, "covered", "manual");
    expect(flipped!.status).toBe("covered");
    expect(flipped!.coveredBy).toBe("manual");
    expect(flipped!.evidence).toBeUndefined(); // ← 來源換人 → 舊證據當下清掉
    const raw1 = await core.db.get<{ evidence: string | null }>(
      "SELECT evidence FROM meeting_checklist_items WHERE id = ?",
      [a.id],
    );
    expect(raw1!.evidence).toBeNull(); // 落庫層面也真的是 NULL，不只是回傳值

    // slide → manual 同樣算換來源（「第 N 頁」不需要留，但重點是行為一致）
    const items2 = await core.checklist.replaceAll(ORG, MEETING, [item(0)]);
    const b = items2[0]!;
    await core.checklist.markCovered(ORG, MEETING, [b.id], "slide", "第 3 頁");
    expect((await core.checklist.setStatus(ORG, MEETING, b.id, "covered", "manual"))!.evidence).toBeUndefined();
  });

  it("setStatus('covered') 同來源重複勾選時保留 evidence（不是無條件清空）", async () => {
    const items = await core.checklist.replaceAll(ORG, MEETING, [item(0)]);
    const a = items[0]!;
    // 先變成 manual（此時 evidence NULL），再硬塞一個 manual 自帶的備註，然後同來源再勾一次。
    await core.checklist.setStatus(ORG, MEETING, a.id, "covered", "manual");
    await core.db.run("UPDATE meeting_checklist_items SET evidence = ? WHERE id = ?", ["報告者自己的備註", a.id]);
    const again = await core.checklist.setStatus(ORG, MEETING, a.id, "covered", "manual");
    expect(again!.coveredBy).toBe("manual");
    expect(again!.evidence).toBe("報告者自己的備註"); // 來源沒變 → 不清（維持既有語意）

    // 反向對照：同一列被自動 slide 路徑接手也不可能發生（markCovered 只動 pending），
    // 但顯式改成別的來源就必須清掉。
    const switched = await core.checklist.setStatus(ORG, MEETING, a.id, "covered", "slide");
    expect(switched!.coveredBy).toBe("slide");
    expect(switched!.evidence).toBeUndefined();
  });

  it("setStatus('covered') 同來源重勾不刷新 covered_at（TTL 時鐘不得歸零），換來源才更新", async () => {
    // 為什麼重要：retention purge 的年齡判準是 COALESCE(covered_at, created_at)
    // （apps/server/src/realtime/transcript-retention.ts:75）。若同來源重勾也把 covered_at 刷成 now，
    // 一列「已過期、帶著逐字殘留」的 manual 列只要在 purge 跑之前被再點一次，TTL 時鐘就歸零。
    const items = await core.checklist.replaceAll(ORG, MEETING, [item(0)]);
    const a = items[0]!;
    await core.checklist.setStatus(ORG, MEETING, a.id, "covered", "manual");

    // 模擬「本修法之前留下的舊資料」：manual 列帶著逐字殘留，且 covered_at 已是 40 天前（早該被 purge）。
    const OLD = Date.now() - 40 * 24 * 60 * 60 * 1000;
    await core.db.run("UPDATE meeting_checklist_items SET covered_at = ?, evidence = ? WHERE id = ?", [
      OLD,
      "對方說預算大概三百萬",
      a.id,
    ]);

    const again = await core.checklist.setStatus(ORG, MEETING, a.id, "covered", "manual");
    expect(again!.coveredBy).toBe("manual");
    expect(again!.coveredAt).toBe(OLD); // ← 同來源重勾＝什麼都沒變，時間戳不動（purge 這輪照樣抓得到它）
    expect(again!.evidence).toBe("對方說預算大概三百萬"); // evidence 仍保留（既有語意不變）

    // 換來源＝新的判定事件 → covered_at 更新、舊 evidence 清空。
    const switched = await core.checklist.setStatus(ORG, MEETING, a.id, "covered", "slide");
    expect(switched!.coveredBy).toBe("slide");
    expect(switched!.coveredAt!).toBeGreaterThan(OLD);
    expect(switched!.evidence).toBeUndefined();
  });

  it("setStatus('covered') 首次勾選（pending → covered）仍會寫入當下的 covered_at", async () => {
    const items = await core.checklist.replaceAll(ORG, MEETING, [item(0)]);
    const a = items[0]!;
    const before = Date.now() - 1;
    const checked = await core.checklist.setStatus(ORG, MEETING, a.id, "covered", "manual");
    expect(checked!.coveredAt!).toBeGreaterThanOrEqual(before); // 舊值 NULL → 走 ELSE 分支（視為換來源）
    // skipped → covered 也一樣（covered_by 舊值為 NULL）。
    await core.checklist.setStatus(ORG, MEETING, a.id, "skipped");
    const recovered = await core.checklist.setStatus(ORG, MEETING, a.id, "covered", "manual");
    expect(typeof recovered!.coveredAt).toBe("number");
  });

  it("org 隔離：攻擊者 org 的 list 回空、setStatus/markCovered 回空/null 且零副作用", async () => {
    const items = await core.checklist.replaceAll(ORG, MEETING, [item(0), item(1)]);
    const a = items[0]!;

    expect(await core.checklist.list(OTHER_ORG, MEETING)).toEqual([]);
    expect(await core.checklist.setStatus(OTHER_ORG, MEETING, a.id, "covered")).toBeNull();
    expect(await core.checklist.markCovered(OTHER_ORG, MEETING, [a.id], "manual")).toEqual([]);

    // 零副作用：受害 org 的資料完全沒被動到
    const victim = await core.checklist.list(ORG, MEETING);
    expect(victim).toHaveLength(2);
    expect(victim.every((i) => i.status === "pending")).toBe(true);

    // 同 org 但錯的 meetingId 一樣拿不到
    expect(await core.checklist.list(ORG, "meeting-other")).toEqual([]);
    expect(await core.checklist.setStatus(ORG, "meeting-other", a.id, "covered")).toBeNull();
  });

  it("keywords_json 爛資料不 crash：非 JSON → []、非陣列 → []、含非字串元素則過濾", async () => {
    const items = await core.checklist.replaceAll(ORG, MEETING, [item(0), item(1), item(2)]);
    const [a, b, c] = [items[0]!, items[1]!, items[2]!];
    await core.db.run("UPDATE meeting_checklist_items SET keywords_json = ? WHERE id = ?", ["not json{", a.id]);
    await core.db.run("UPDATE meeting_checklist_items SET keywords_json = ? WHERE id = ?", ['{"a":1}', b.id]);
    await core.db.run("UPDATE meeting_checklist_items SET keywords_json = ? WHERE id = ?", ['["ok",5,null]', c.id]);

    const listed = await core.checklist.list(ORG, MEETING);
    expect(listed[0]!.keywords).toEqual([]);
    expect(listed[1]!.keywords).toEqual([]);
    expect(listed[2]!.keywords).toEqual(["ok"]);
  });
});
