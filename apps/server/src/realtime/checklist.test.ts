/**
 * 會中待講清單 —— 契約 §10 的最低測試集（行為驗證，非自述）。
 *
 *  1. markCovered **只動 pending**：已 manual covered 的項目不被自動路徑覆寫。
 *  2. markCovered 無變化 → 回空陣列（→ hub 不廣播）。
 *  3. 跨 org：A org 對 B org 的 meeting 做 list／setStatus → 空／null，**零副作用**。
 *  4. `checklist_action` 非 presenter 被拒（經**真** ws-server，比照 ws-presenter-authz.test.ts）。
 *  5. 分析 sanitize：回傳不在 pending 集合的 id 被丟棄（防幻覺 id）。
 *  6. 翻頁勾稽：停留 <20 秒不 cover、≥20 秒才 cover。
 *  7. I3：checklist snapshot 只到 hud——present／capture 連線一則都收不到。
 *  8. §7.5 手動 uncheck 冷卻期：冷卻期內 transcript 自動 cover 被跳過、期滿放行、
 *     同期間 'slide' 與手動 check 不受影響。
 */
import { describe, it, expect, vi } from "vitest";
import { WebSocket } from "ws";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createCrmCore } from "@meetcopilot/crm";
import type { CrmCore } from "@meetcopilot/crm";
import { SLIDE_DWELL_COVER_MS, WS_PATH, type NewChecklistItem, type SignalItem } from "@meetcopilot/shared";
import { RealtimeHub } from "./hub.js";
import { attachRealtimeWs } from "./ws-server.js";
import { mintWsToken } from "./ws-token.js";
import { UNCHECK_COOLDOWN_MS } from "./session-runtime.js";
import { createGeminiClient } from "../gemini.js";
import { RollingWindowAnalysisEngine, WINDOW_MAX_AGE_MS } from "../analysis/gemini-analysis.js";
import type { AnalysisResult } from "../analysis/analysis-engine.js";
import {
  TEST_JWT_SECRET as SECRET,
  fakeSocket,
  passingHandshakeRow,
  testConfig,
  tick as sleep,
} from "./test-support.js";
import type { ConnMeta } from "./types.js";
import type { GeminiClient } from "../gemini.js";

function items(...rows: Partial<NewChecklistItem>[]): NewChecklistItem[] {
  return rows.map((r, idx) => ({
    idx: r.idx ?? idx,
    category: r.category ?? "talk",
    title: r.title ?? `項目 ${idx}`,
    detail: r.detail,
    slideIdx: r.slideIdx,
    keywords: r.keywords ?? ["關鍵詞"],
    priority: r.priority ?? "must",
  }));
}

describe("ChecklistRepository 語意（契約 §3／§10 第 1–3 項）", () => {
  it("markCovered 只動 pending：manual covered 的項目不被自動路徑覆寫", async () => {
    const core = await createCrmCore(":memory:");
    try {
      await core.migrate();
      const org = await core.orgs.create({ name: "Org A" });
      const stored = await core.checklist.replaceAll(org.id, "m1", items({ title: "手動勾的" }, { title: "還沒講的" }));
      const manual = stored[0]!;
      const pending = stored[1]!;

      // 報告者手動勾掉第一項（covered_by='manual'）。
      await core.checklist.setStatus(org.id, "m1", manual.id, "covered", "manual");

      // 自動路徑（對話勾稽）同時把兩項都送進 markCovered。
      const changed = await core.checklist.markCovered(org.id, "m1", [manual.id, pending.id], "transcript", "逐字片段");

      expect(changed.map((c) => c.id)).toEqual([pending.id]); // 只有本來 pending 的那項被改
      const after = await core.checklist.list(org.id, "m1");
      const manualAfter = after.find((i) => i.id === manual.id)!;
      expect(manualAfter.coveredBy).toBe("manual"); // 手動來源未被覆寫（報告者是最終權威）
      expect(manualAfter.evidence).toBeUndefined();
      expect(after.find((i) => i.id === pending.id)!.coveredBy).toBe("transcript");
    } finally {
      core.close();
    }
  });

  it("markCovered 無變化時回空陣列（呼叫端據此不廣播）", async () => {
    const core = await createCrmCore(":memory:");
    try {
      await core.migrate();
      const org = await core.orgs.create({ name: "Org A" });
      const [only] = await core.checklist.replaceAll(org.id, "m1", items({ title: "只有一項" }));
      expect(await core.checklist.markCovered(org.id, "m1", [only!.id], "slide", "第 1 頁")).toHaveLength(1);
      // 第二次（冪等）＋不存在的 id ＋空陣列 → 一律空陣列。
      expect(await core.checklist.markCovered(org.id, "m1", [only!.id], "slide", "第 1 頁")).toEqual([]);
      expect(await core.checklist.markCovered(org.id, "m1", ["no-such-id"], "transcript")).toEqual([]);
      expect(await core.checklist.markCovered(org.id, "m1", [], "transcript")).toEqual([]);
    } finally {
      core.close();
    }
  });

  it("跨 org：A 對 B 的 meeting 做 list／setStatus／markCovered → 空／null，零副作用", async () => {
    const core = await createCrmCore(":memory:");
    try {
      await core.migrate();
      const orgA = await core.orgs.create({ name: "Org A" });
      const orgB = await core.orgs.create({ name: "Org B" });
      const [victim] = await core.checklist.replaceAll(orgB.id, "mB", items({ title: "B 的機密項目" }));

      expect(await core.checklist.list(orgA.id, "mB")).toEqual([]); // 讀不到別人的清單
      expect(await core.checklist.setStatus(orgA.id, "mB", victim!.id, "skipped")).toBeNull();
      expect(await core.checklist.markCovered(orgA.id, "mB", [victim!.id], "manual")).toEqual([]);

      // 零副作用：B 的項目仍是 pending、沒有 cover 三欄。
      const after = await core.checklist.list(orgB.id, "mB");
      expect(after).toHaveLength(1);
      expect(after[0]!.status).toBe("pending");
      expect(after[0]!.coveredBy).toBeUndefined();
    } finally {
      core.close();
    }
  });
});

describe("分析 sanitize 防幻覺 id（契約 §7.1／§10 第 5 項）", () => {
  const inertGemini: GeminiClient = {
    isConfigured: () => false,
    embed: async () => [],
    embedMetered: async () => ({ value: [], usage: { model: "t" } }),
    generateJson: async <T>() => ({}) as T,
    generateJsonMetered: async <T>() => ({ value: {} as T, usage: { model: "t" } }),
    generateGrounded: async () => ({ answer: "", citations: [] }),
  };

  it("只保留 pending 集合內的 id；幻覺 id／非字串／重複一律丟棄", () => {
    const engine = new RollingWindowAnalysisEngine(inertGemini, "e", "sess-1");
    engine.setPendingChecklist([
      { id: "real-1", title: "說明導入時程", keywords: ["時程", "上線"] },
      { id: "real-2", title: "問預算區間", keywords: ["預算"] },
    ]);
    const out = engine.sanitize({
      signals: [{ kind: "interest", label: "有興趣", confidence: 0.9 }],
      coveredItemIds: ["real-1", "ghost-id", "real-1", 42, "#real-2"],
    });
    expect(out.coveredItemIds).toEqual(["real-1", "real-2"]); // 幻覺 id 丟棄、去重、容忍 `#` 前綴
    expect(out.signals).toHaveLength(1);
  });

  it("pending 為空 → coveredItemIds 全被丟棄（模型無從得知任何 id）", () => {
    const engine = new RollingWindowAnalysisEngine(inertGemini, "e", "sess-2");
    const out = engine.sanitize({ signals: [], coveredItemIds: ["anything"] });
    expect(out.coveredItemIds).toBeUndefined();
  });
});

describe("翻頁勾稽 + I3 投遞面（契約 §7.2／§7.4／§10 第 6 項）", () => {
  async function harness() {
    const core: CrmCore = await createCrmCore(":memory:");
    await core.migrate();
    const org = await core.orgs.create({ name: "Org A" });
    const cfg = testConfig();
    const hub = new RealtimeHub(core, cfg, createGeminiClient(cfg.gemini));
    const meeting = await hub.store.create(org.id, { title: "M", presenterUserId: "pres" });
    hub.registerMeeting(meeting.id, { orgId: org.id, presenterUserId: "pres", deckId: "deck1" });
    const hud = fakeSocket();
    const meta: ConnMeta = {
      userId: "pres",
      orgId: org.id,
      meetingId: meeting.id,
      role: "hud",
      isPresenter: true,
    };
    hub.attach(hud as unknown as WebSocket, meta);
    await sleep(20); // ensureRuntime + state 落定
    const runtime = hub.getRuntime(meeting.id)!;
    // disposeAll 會清掉 checklist 的 debounce timer（L13 bounded teardown）——否則殘留 timer 會在
    // core.close() 之後才觸發廣播並吐 "database connection is not open"。
    const dispose = () => {
      hub.disposeAll();
      core.close();
    };
    return { core, hub, org, meeting, hud, meta, runtime, dispose };
  }

  it("前一頁停留 <20 秒 → 不 cover；≥20 秒 → 才 cover（evidence＝第 N 頁）", async () => {
    const h = await harness();
    try {
      const [bound] = await h.core.checklist.replaceAll(
        h.org.id,
        h.meeting.id,
        items({ title: "講第 1 頁", slideIdx: 0 }),
      );

      // (a) 停留 5 秒就翻頁 → 不算講到。
      h.runtime.lastCommitAt = Date.now() - 5_000;
      h.hub.onPageCommitted(h.runtime, 0);
      await sleep(60);
      expect((await h.core.checklist.list(h.org.id, h.meeting.id))[0]!.status).toBe("pending");

      // (b) 停留超過 SLIDE_DWELL_COVER_MS → 劃掉，evidence 記頁碼（1-based 人類頁號）。
      h.runtime.lastCommitAt = Date.now() - (SLIDE_DWELL_COVER_MS + 1_000);
      h.hub.onPageCommitted(h.runtime, 0);
      await sleep(80);
      const after = (await h.core.checklist.list(h.org.id, h.meeting.id))[0]!;
      expect(after.status).toBe("covered");
      expect(after.coveredBy).toBe("slide");
      expect(after.evidence).toBe("第 1 頁");
      expect(after.id).toBe(bound!.id);
    } finally {
      h.dispose();
    }
  });

  it("第一次翻頁（無 lastCommitAt）不 cover，且 onPageCommitted 會推進 lastCommitAt", async () => {
    const h = await harness();
    try {
      await h.core.checklist.replaceAll(h.org.id, h.meeting.id, items({ title: "講第 1 頁", slideIdx: 0 }));
      expect(h.runtime.lastCommitAt).toBeUndefined();
      h.hub.onPageCommitted(h.runtime, 0);
      await sleep(60);
      expect((await h.core.checklist.list(h.org.id, h.meeting.id))[0]!.status).toBe("pending");
      expect(typeof h.runtime.lastCommitAt).toBe("number");
    } finally {
      h.dispose();
    }
  });

  it("I3：狀態改變後的 snapshot 只送 hud——present／capture 一則 checklist 都收不到", async () => {
    const h = await harness();
    try {
      const present = fakeSocket();
      const capture = fakeSocket();
      h.hub.attach(present as unknown as WebSocket, { ...h.meta, role: "present" });
      h.hub.attach(capture as unknown as WebSocket, { ...h.meta, role: "capture" });
      await sleep(20);

      const [row] = await h.core.checklist.replaceAll(h.org.id, h.meeting.id, items({ title: "手動勾" }));
      h.hub.checklistAction(h.org.id, h.meeting.id, row!.id, "check");
      await sleep(450); // > 300ms debounce

      const hudChecklist = h.hud.sent.filter((m) => m.type === "checklist");
      expect(hudChecklist.length).toBeGreaterThan(0);
      expect(present.sent.some((m) => m.type === "checklist")).toBe(false);
      expect(capture.sent.some((m) => m.type === "checklist")).toBe(false);

      const last = hudChecklist[hudChecklist.length - 1]!;
      expect(last.status).toBe("ready");
      const snapshot = last.items as Array<Record<string, unknown>>;
      expect(snapshot).toHaveLength(1); // 全量 snapshot、replace 語意
      expect(snapshot[0]!.status).toBe("covered");
      expect(snapshot[0]!.coveredBy).toBe("manual");
    } finally {
      h.dispose();
    }
  });

  it("無改變不廣播：對已 covered 的項目再跑一次自動勾稽 → hud 沒有新 snapshot", async () => {
    const h = await harness();
    try {
      const [row] = await h.core.checklist.replaceAll(
        h.org.id,
        h.meeting.id,
        items({ title: "講第 1 頁", slideIdx: 0 }),
      );
      await h.core.checklist.setStatus(h.org.id, h.meeting.id, row!.id, "covered", "manual");
      const before = h.hud.sent.filter((m) => m.type === "checklist").length;

      h.runtime.lastCommitAt = Date.now() - (SLIDE_DWELL_COVER_MS + 1_000);
      h.hub.onPageCommitted(h.runtime, 0);
      await sleep(450);

      expect(h.hud.sent.filter((m) => m.type === "checklist").length).toBe(before);
    } finally {
      h.dispose();
    }
  });

  it("hud 一連上就補一份 snapshot（斷線重連自我修復）；present 連線不會收到", async () => {
    const h = await harness();
    try {
      await h.core.checklist.replaceAll(h.org.id, h.meeting.id, items({ title: "重連也看得到" }));
      const hud2 = fakeSocket();
      const present = fakeSocket();
      h.hub.attach(hud2 as unknown as WebSocket, { ...h.meta, role: "hud" });
      h.hub.attach(present as unknown as WebSocket, { ...h.meta, role: "present" });
      await sleep(60);
      expect(hud2.sent.some((m) => m.type === "checklist")).toBe(true);
      expect(present.sent.some((m) => m.type === "checklist")).toBe(false);
    } finally {
      h.dispose();
    }
  });

  it("本場沒有 checklist（無生成、DB 無資料）→ hud 連上時什麼都不送", async () => {
    const h = await harness();
    try {
      const hud2 = fakeSocket();
      h.hub.attach(hud2 as unknown as WebSocket, { ...h.meta, role: "hud" });
      await sleep(60);
      expect(hud2.sent.some((m) => m.type === "checklist")).toBe(false);
    } finally {
      h.dispose();
    }
  });

  it("缺 deckId 且缺 companyId → startChecklistGeneration 不生成、不廣播", async () => {
    const core = await createCrmCore(":memory:");
    try {
      await core.migrate();
      const org = await core.orgs.create({ name: "Org A" });
      const cfg = testConfig();
      const hub = new RealtimeHub(core, cfg, createGeminiClient(cfg.gemini));
      const meeting = await hub.store.create(org.id, { title: "M", presenterUserId: "pres" });
      hub.registerMeeting(meeting.id, { orgId: org.id, presenterUserId: "pres" });
      const hud = fakeSocket();
      hub.attach(hud as unknown as WebSocket, {
        userId: "pres",
        orgId: org.id,
        meetingId: meeting.id,
        role: "hud",
        isPresenter: true,
      });
      await sleep(20);
      hub.startChecklistGeneration(meeting.id);
      await sleep(60);
      expect(hud.sent.some((m) => m.type === "checklist")).toBe(false);
      expect(await core.checklist.list(org.id, meeting.id)).toEqual([]);
    } finally {
      core.close();
    }
  });
});

// ── §7.5 手動 uncheck 的冷卻期（打地鼠修正）──────────────────────────────
describe("手動 uncheck 冷卻期（契約 §7.5）", () => {
  /**
   * 取出 hub 註冊到本場分析引擎上的 `onSignals` 回呼，讓測試能「假裝模型這一輪回報了 coveredItemIds」——
   * 走的是**真的** hub.onSignals → coverChecklist(..., 'transcript') 路徑（不是繞過去直接呼 repo）。
   *
   * ⚠️ 2026-08-19 改為 **attach 後直接讀 live engine 的 `signalsCb`**，取代原本「attach 前先 spy
   * `RollingWindowAnalysisEngine.prototype.onSignals`」的作法。原因：Windows 上 vitest/vite 偶爾會把同一個
   * 檔案以不同的磁碟機代號大小寫（`c:/…` vs `C:/…`）當成兩個模組各求值一次 → 本檔 import 到的 class 物件
   * 與 `hub.ts` 實際 new 出來的**不是同一個**，prototype spy 就靜默不觸發，`emit` 永遠是 undefined
   *（實測全 repo `npm test` 約 50% 機率出現 `TypeError: emit is not a function`，本區塊 6 個測試同時倒；
   * 同一根因也讓 `packages/crm` 的 `to be an instance of I1ViolationError` 間歇性失敗）。
   * 從**實例**上取值不經過 class 物件，因此免疫。時序上安全：`ensureRuntime` 是先 `engine.onSignals(cb)`
   * 才 `sessions.set(...)`，所以只要 `getRuntime` 拿得到 runtime，回呼必已註冊。
   */
  async function harness() {
    const core: CrmCore = await createCrmCore(":memory:");
    await core.migrate();
    const org = await core.orgs.create({ name: "Org A" });
    const cfg = testConfig();
    const hub = new RealtimeHub(core, cfg, createGeminiClient(cfg.gemini));
    const meeting = await hub.store.create(org.id, { title: "M", presenterUserId: "pres" });
    hub.registerMeeting(meeting.id, { orgId: org.id, presenterUserId: "pres", deckId: "deck1" });

    const hud = fakeSocket();
    const meta: ConnMeta = { userId: "pres", orgId: org.id, meetingId: meeting.id, role: "hud", isPresenter: true };
    hub.attach(hud as unknown as WebSocket, meta);
    await sleep(20);
    const runtime = hub.getRuntime(meeting.id)!;
    /** hub 掛在本場 engine 上的 signals 回呼（見上方 doc：從實例取，不從 class prototype spy）。 */
    const emit = (): ((items: SignalItem[], result: AnalysisResult) => void) => {
      const cb = (runtime.engine as { signalsCb?: (items: SignalItem[], result: AnalysisResult) => void }).signalsCb;
      if (typeof cb !== "function") throw new Error("hub did not register onSignals on this meeting's engine");
      return cb;
    };
    const status = async (id: string) => (await core.checklist.list(org.id, meeting.id)).find((i) => i.id === id)!;

    /**
     * 推進**音訊時鐘**（§7.5 v1.2 的計時基準）：往真的 engine 餵一段逐字段，走的正是產線路徑
     * （`hub.onAsrFinal` → `engine.ingest`），`seg.t` 就是本場共用的取樣時鐘
     * （`LiveSessionRuntime.advanceAudioClock`，16 取樣＝1ms）。
     * gemini 未設定（apiKey 空）→ `maybeAnalyze` 直接 return，不會打任何 LLM。
     * **刻意不碰 `Date.now()`**：牆鐘與音訊時鐘的分離正是本節要測的東西。
     */
    let audioT = 0;
    const advanceAudio = (ms: number): number => {
      audioT += ms;
      runtime.engine.ingest(meeting.id, { t: audioT, text: `逐字段 @${audioT}ms` });
      return audioT;
    };

    return {
      core,
      hub,
      org,
      meeting,
      runtime,
      status,
      advanceAudio,
      /** 目前音訊時鐘高水位（單一真相＝分析引擎窗內最新的 t）。 */
      audioClock: () => runtime.audioClockMs(),
      /** 模型這一輪回報「這些 id 已被涵蓋」（signals 為空也會走勾稽路徑）。 */
      emitCovered: (ids: string[]) => emit()([], { signals: [], coveredItemIds: ids }),
      dispose: () => {
        hub.disposeAll();
        core.close();
      },
    };
  }

  it("冷卻長度＝分析滾動窗最大年齡（單一真相，不是兩處各寫一個 90000）", () => {
    expect(UNCHECK_COOLDOWN_MS).toBe(WINDOW_MAX_AGE_MS);
  });

  it("冷卻的時鐘＝音訊時鐘（存取器單一真相）：窗空→undefined，餵段後＝窗內最新的 t", async () => {
    const h = await harness();
    try {
      expect(h.audioClock()).toBeUndefined(); // 音訊還沒開始流 → 沒有高水位可用
      h.advanceAudio(4_000);
      expect(h.audioClock()).toBe(4_000);
      h.advanceAudio(6_000);
      expect(h.audioClock()).toBe(10_000); // 只隨 PCM/逐字段前進，與牆鐘無關
    } finally {
      h.dispose();
    }
  });

  it("uncheck 後冷卻期內：同一段逐字稿再回報同一個 id → 自動 cover 被跳過（不打地鼠）", async () => {
    const h = await harness();
    try {
      const [row] = await h.core.checklist.replaceAll(h.org.id, h.meeting.id, items({ title: "被誤判的項目" }));
      const id = row!.id;
      h.advanceAudio(4_000); // 音訊開始流動：那段害它被誤判的逐字稿此刻就在窗裡

      // (a) 基準：沒有冷卻紀錄時，transcript 勾稽會 cover（證明這條路徑本來是通的）。
      h.emitCovered([id]);
      await sleep(60);
      expect((await h.status(id)).status).toBe("covered");
      expect((await h.status(id)).coveredBy).toBe("transcript");

      // (b) 報告者發現誤判 → uncheck（語意＝「我還沒講」，不是 skip）。
      h.hub.checklistAction(h.org.id, h.meeting.id, id, "uncheck");
      await sleep(60);
      expect((await h.status(id)).status).toBe("pending");

      // (c) 害它被誤判的那段逐字稿還在分析窗裡（音訊時鐘只前進 4 秒 ≪ 90 秒）→ 模型又回報同一個 id。
      //     修正前：markCovered 只擋非 pending，這裡會**又**被劃掉；修正後必須原地不動。
      h.advanceAudio(4_000);
      h.emitCovered([id]);
      await sleep(60);
      const after = await h.status(id);
      expect(after.status).toBe("pending");
      expect(after.coveredBy).toBeUndefined();
      expect(after.evidence).toBeUndefined();
    } finally {
      h.dispose();
    }
  });

  it("冷卻期過後放行：**音訊時鐘**走完一個窗，模型仍回報 → 視為真的講到了", async () => {
    const h = await harness();
    try {
      const [row] = await h.core.checklist.replaceAll(h.org.id, h.meeting.id, items({ title: "後來真的講到了" }));
      const id = row!.id;
      h.advanceAudio(4_000);
      h.hub.checklistAction(h.org.id, h.meeting.id, id, "uncheck");
      await sleep(60);
      expect((await h.status(id)).status).toBe("pending");

      // 冷卻期內先確認仍被擋（同一個 harness 內對照，排除「其實根本沒生效」的假綠）。
      h.advanceAudio(1_000);
      h.emitCovered([id]);
      await sleep(60);
      expect((await h.status(id)).status).toBe("pending");

      // 音訊時鐘真的前進超過一個窗的最大年齡（窗已整輪替過）→ 放行。
      h.advanceAudio(UNCHECK_COOLDOWN_MS);
      h.emitCovered([id]);
      await sleep(60);
      const after = await h.status(id);
      expect(after.status).toBe("covered");
      expect(after.coveredBy).toBe("transcript");
    } finally {
      h.dispose();
    }
  });

  it("冷卻期內：翻頁勾稽（'slide'）與手動 check 都不受影響", async () => {
    const h = await harness();
    try {
      const [row] = await h.core.checklist.replaceAll(
        h.org.id,
        h.meeting.id,
        items({ title: "綁第 1 頁", slideIdx: 0 }),
      );
      const id = row!.id;
      h.advanceAudio(4_000);

      // 製造冷卻紀錄（uncheck 一個仍 pending 的項目也會記；報告者本來就可以這樣點）。
      h.hub.checklistAction(h.org.id, h.meeting.id, id, "uncheck");
      await sleep(60);

      // 'slide'＝報告者自己的導覽行為，不是 AI 誤判來源 → 停留 ≥20 秒照樣 cover。
      h.runtime.lastCommitAt = Date.now() - (SLIDE_DWELL_COVER_MS + 1_000);
      h.hub.onPageCommitted(h.runtime, 0);
      await sleep(80);
      const bySlide = await h.status(id);
      expect(bySlide.status).toBe("covered");
      expect(bySlide.coveredBy).toBe("slide");

      // 手動 check＝報告者的直接指令 → 冷卻期內立即生效。
      h.hub.checklistAction(h.org.id, h.meeting.id, id, "uncheck");
      await sleep(60);
      expect((await h.status(id)).status).toBe("pending");
      h.hub.checklistAction(h.org.id, h.meeting.id, id, "check");
      await sleep(60);
      const byManual = await h.status(id);
      expect(byManual.status).toBe("covered");
      expect(byManual.coveredBy).toBe("manual");

      // 同一時間 transcript 仍被冷卻（對照組：證明上面兩條不是因為冷卻整體失效才通過）。
      h.hub.checklistAction(h.org.id, h.meeting.id, id, "uncheck");
      await sleep(60);
      h.emitCovered([id]);
      await sleep(60);
      expect((await h.status(id)).status).toBe("pending");
    } finally {
      h.dispose();
    }
  });

  it("冷卻只針對被 uncheck 的那一項；同批其他 id 照常被 cover", async () => {
    const h = await harness();
    try {
      const rows = await h.core.checklist.replaceAll(
        h.org.id,
        h.meeting.id,
        items({ title: "被 uncheck 的" }, { title: "無關的另一項" }),
      );
      const cooled = rows[0]!.id;
      const other = rows[1]!.id;
      h.advanceAudio(4_000);
      h.hub.checklistAction(h.org.id, h.meeting.id, cooled, "uncheck");
      await sleep(60);

      h.advanceAudio(2_000);
      h.emitCovered([cooled, other]);
      await sleep(60);
      expect((await h.status(cooled)).status).toBe("pending");
      expect((await h.status(other)).status).toBe("covered");
    } finally {
      h.dispose();
    }
  });

  /**
   * §7.5 v1.2 的**原始缺口回歸**（牆鐘 vs 音訊時鐘）。實測情境：報告者 uncheck 一個誤判項後按「撤回同意」
   * 做 2 分鐘內部討論——`pushAudio` 在 `!consent` 時直接 return，**音訊時鐘完全凍結**，且 consent handler
   * 不清 engine 的窗；牆鐘卻照走。牆鐘版冷卻在此提早到期，而害它被誤判的逐字稿**還在窗裡**
   * → 恢復後第一輪分析（節流 5 秒）就把同一項再劃掉＝打地鼠原樣復活。
   * 停止分享導致 capture socket 斷線（HUD 仍在，runtime 不被回收）亦同。
   */
  it("牆鐘過 90 秒但音訊時鐘凍結（撤回同意）→ 仍被跳過；音訊時鐘也走完才放行", async () => {
    const h = await harness();
    const realNow = Date.now();
    try {
      const [row] = await h.core.checklist.replaceAll(h.org.id, h.meeting.id, items({ title: "被誤判的項目" }));
      const id = row!.id;

      h.advanceAudio(4_000); // 誤判來源的逐字稿進窗（音訊時鐘 4s）
      h.hub.checklistAction(h.org.id, h.meeting.id, id, "uncheck");
      await sleep(60);
      expect((await h.status(id)).status).toBe("pending");

      // 撤回同意 2 分鐘：牆鐘 +120 秒（> 90 秒冷卻），音訊時鐘一動也不動。
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(realNow + UNCHECK_COOLDOWN_MS + 30_000);
      try {
        expect(Date.now() - realNow).toBeGreaterThan(UNCHECK_COOLDOWN_MS); // 牆鐘確實已到期
        expect(h.audioClock()).toBe(4_000); // 音訊時鐘凍結在 uncheck 當時
        h.emitCovered([id]); // 恢復前/後第一輪分析：窗還是同一份，模型又回報同一個 id
        await sleep(60);
        const after = await h.status(id);
        expect(after.status).toBe("pending"); // 牆鐘到期不算數 → 仍被跳過（不打地鼠）
        expect(after.coveredBy).toBeUndefined();
      } finally {
        nowSpy.mockRestore();
      }

      // 恢復同意、音訊重新流動並真的走完一整個窗 → 模型此時仍回報＝來自**新的**對話內容 → 放行。
      h.advanceAudio(UNCHECK_COOLDOWN_MS + 1_000);
      h.emitCovered([id]);
      await sleep(60);
      const after2 = await h.status(id);
      expect(after2.status).toBe("covered");
      expect(after2.coveredBy).toBe("transcript");
    } finally {
      h.dispose();
    }
  });

  it("音訊還沒開始流時 uncheck（窗空、無高水位）→ fail-safe 仍算冷卻；基準改由音訊恢復後第一個高水位起算", async () => {
    const h = await harness();
    try {
      const [row] = await h.core.checklist.replaceAll(h.org.id, h.meeting.id, items({ title: "還沒有音訊就被 uncheck" }));
      const id = row!.id;

      expect(h.audioClock()).toBeUndefined();
      h.hub.checklistAction(h.org.id, h.meeting.id, id, "uncheck");
      await sleep(60);
      expect(h.runtime.isUncheckCooling(id)).toBe(true); // 取不到時鐘 → fail-safe 成「仍在冷卻」

      // 音訊開始流 → 以第一個讀到的高水位當基準；此刻離基準 0ms，仍冷卻。
      h.advanceAudio(4_000);
      h.emitCovered([id]);
      await sleep(60);
      expect((await h.status(id)).status).toBe("pending");

      // 從那個基準起算走完一個窗 → 放行（冷卻仍是有界的，不會永久卡住）。
      h.advanceAudio(UNCHECK_COOLDOWN_MS);
      h.emitCovered([id]);
      await sleep(60);
      expect((await h.status(id)).status).toBe("covered");
    } finally {
      h.dispose();
    }
  });

  it("dispose() 清空冷卻紀錄（L13 bounded teardown）", async () => {
    const h = await harness();
    try {
      h.advanceAudio(4_000);
      h.runtime.noteUnchecked("item-x");
      expect(h.runtime.isUncheckCooling("item-x")).toBe(true);
      h.runtime.dispose();
      expect(h.runtime.isUncheckCooling("item-x")).toBe(false); // 紀錄已清空 → 不再有殘留狀態
    } finally {
      h.dispose();
    }
  });
});

// ── I2：checklist_action 經真 ws-server 的身分閘（契約 §10 第 4 項）─────────
const presenterToken = mintWsToken(SECRET, { meetingId: "m1", orgId: "org1", userId: "pres", presenterUserId: "pres" });
const attackerToken = mintWsToken(SECRET, { meetingId: "m1", orgId: "org1", userId: "attacker", presenterUserId: "pres" });
const crossOrgToken = mintWsToken(SECRET, { meetingId: "m1", orgId: "org2", userId: "outsider", presenterUserId: "pres" });

// 握手閘（ws-handshake-gate.ts）同一次查詢也讀 meeting status：row 少一欄，這裡每條連線都會在握手就被
// 1000 關掉（會議查不到＝視同已結束），I2 身分閘根本跑不到——**測試全綠卻什麼都沒驗**。
// 故 row 形狀由 `test-support.ts` 的 `passingHandshakeRow()` 單一擁有，且以閘自己的 `WsHandshakeRow`
// 為回傳型別：閘多讀一欄時該函式直接編譯失敗，不會靜默把這一整組測試掏空。
const activeCore = {
  db: { get: async () => passingHandshakeRow() },
} as unknown as CrmCore;

function makeFakeHub() {
  const checklistAction = vi.fn();
  const hub = {
    attach: vi.fn(),
    detach: vi.fn(),
    patch: { act: vi.fn() },
    getRuntime: vi.fn(() => ({ orgId: "org1", deckId: "deck1", committedIndex: -1, deckLength: 0 })),
    broadcastState: vi.fn(),
    setDeckCommitted: vi.fn(),
    onPageCommitted: vi.fn(),
    checklistAction,
  } as unknown as RealtimeHub;
  return { hub, checklistAction };
}

async function startServer(hub: RealtimeHub, core: CrmCore) {
  const http = createServer();
  const wss = attachRealtimeWs(http, hub, SECRET, core);
  await new Promise<void>((r) => http.listen(0, () => r()));
  const port = (http.address() as AddressInfo).port;
  return {
    url: (token: string, role: string) => `ws://127.0.0.1:${port}${WS_PATH}?token=${token}&meetingId=m1&role=${role}`,
    close: async () => {
      wss.close();
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}

/** 開一條 WS、（帳號閘放行後）送一則訊息、收集回覆。比照 ws-presenter-authz.test.ts。 */
function exchange(url: string, send?: object): Promise<Array<{ type?: string; code?: string }>> {
  return new Promise((resolve) => {
    const msgs: Array<{ type?: string; code?: string }> = [];
    let settled = false;
    const ws = new WebSocket(url);
    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(msgs);
    };
    ws.on("message", (d) => {
      try {
        msgs.push(JSON.parse(d.toString()));
      } catch {
        /* ignore */
      }
    });
    ws.on("close", finish);
    ws.on("error", () => {
      /* rejection paths surface via close/message */
    });
    ws.on("open", () => {
      setTimeout(() => {
        if (send && ws.readyState === ws.OPEN) ws.send(JSON.stringify(send));
        setTimeout(finish, 60);
      }, 20);
    });
    setTimeout(finish, 800);
  });
}

describe("checklist_action I2 身分閘（經真 ws-server）", () => {
  it("ACCEPTS：presenter 身分在 role=hud／present 都能改", async () => {
    for (const role of ["hud", "present"]) {
      const { hub, checklistAction } = makeFakeHub();
      const srv = await startServer(hub, activeCore);
      try {
        const msgs = await exchange(srv.url(presenterToken, role), {
          type: "checklist_action",
          itemId: "item-1",
          action: "check",
        });
        expect(msgs.find((m) => m.code === "forbidden_not_presenter"), `role=${role}`).toBeUndefined();
        expect(checklistAction, `role=${role}`).toHaveBeenCalledWith("org1", "m1", "item-1", "check");
      } finally {
        await srv.close();
      }
    }
  });

  it("REJECTS：非 presenter 的合法 token 在**每個** role 都被拒（攻擊者憑證）", async () => {
    for (const role of ["hud", "present", "capture"]) {
      const { hub, checklistAction } = makeFakeHub();
      const srv = await startServer(hub, activeCore);
      try {
        const msgs = await exchange(srv.url(attackerToken, role), {
          type: "checklist_action",
          itemId: "item-1",
          action: "check",
        });
        expect(
          msgs.find((m) => m.type === "error" && m.code === "forbidden_not_presenter"),
          `role=${role}`,
        ).toBeDefined();
        expect(checklistAction, `role=${role}`).not.toHaveBeenCalled();
      } finally {
        await srv.close();
      }
    }
  });

  it("REJECTS：跨 org 的非 presenter token 也被拒", async () => {
    const { hub, checklistAction } = makeFakeHub();
    const srv = await startServer(hub, activeCore);
    try {
      const msgs = await exchange(srv.url(crossOrgToken, "hud"), {
        type: "checklist_action",
        itemId: "item-1",
        action: "skip",
      });
      expect(msgs.find((m) => m.type === "error" && m.code === "forbidden_not_presenter")).toBeDefined();
      expect(checklistAction).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it("presenter 送畸形 payload（缺 itemId／非法 action）→ bad_message，不進 hub", async () => {
    const { hub, checklistAction } = makeFakeHub();
    const srv = await startServer(hub, activeCore);
    try {
      const a = await exchange(srv.url(presenterToken, "hud"), { type: "checklist_action", action: "check" });
      expect(a.find((m) => m.code === "bad_message")).toBeDefined();
      const b = await exchange(srv.url(presenterToken, "hud"), {
        type: "checklist_action",
        itemId: "i",
        action: "delete",
      });
      expect(b.find((m) => m.code === "bad_message")).toBeDefined();
      expect(checklistAction).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });
});
