/**
 * WS 握手的 meeting-status 閘（`ws-handshake-gate.ts`）——殭屍會議的**根因**回歸測試。
 *
 * 修補前：握手只驗 token（簽章／exp／meetingId 相符）＋帳號未停權，完全不查 `meetings.status`。
 * 會議結束後在 `/hud`／`/present` 按一次 F5 就是一條**全新連線**（憑證就在網址列，`readMeetingCreds()`
 * 先讀 URL query）——前端所有終態閘（close code 判定、`retry()` 封鎖、UI 不給重試鈕）全部繞過，
 * `hub.attach` → `hub.ensureRuntime` 於是替一場 `completed` 的會議重建 LiveSessionRuntime＋ASR＋分析引擎。
 *
 * 本檔全部走**真 core（:memory: SQLite，跑過 migration）＋真 hub＋真 attachRealtimeWs**，
 * 所以連閘裡那句四個 `?` 的 SQL 都是真的被執行過的（假 core 會讓 SQL 錯誤整個測不出來）。
 *
 * 四項（含硬規則 7 的攻擊者憑證視角）：
 *  1. completed → 拒，且用的是 terminal 的 1000（前端 `describeWsClose` 的 `kind:"ended"`）。
 *  2. 正控制組：進行中（'scheduled'）→ 正常通過，收得到 session_state。
 *  3. 斷線後 grace 期間重連 → 正常通過，且拿到的是**同一個 runtime**（沒被誤擋、也沒被誤回收）。
 *  4. 跨 org 憑證拿別的 org 的 meetingId → 拒，且回應與「會議根本不存在」**逐位元相同**（零存在性側信道）。
 */
import { describe, it, expect } from "vitest";
import { WebSocket } from "ws";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WS_PATH } from "@meetcopilot/shared";
import { createCrmCore, type CrmCore } from "@meetcopilot/crm";
import { RealtimeHub } from "./hub.js";
import { attachRealtimeWs } from "./ws-server.js";
import { createGeminiClient } from "../gemini.js";
import { mintWsToken } from "./ws-token.js";
import { WS_CLOSE_MEETING_ENDED } from "./types.js";
import { TEST_JWT_SECRET as SECRET, testConfig } from "./test-support.js";

interface Exchanged {
  msgs: Array<{ type?: string; code?: string; message?: string }>;
  /** 原始 JSON 字串——第 4 項要比對「跨 org」與「不存在」的回應是否**逐位元**相同。 */
  raw: string[];
  closeCode?: number;
  closed: boolean;
}

/** 開一條 WS、收完回覆與 close code。被拒的連線 server 會主動關；通過的由本函式在觀察窗後自己關。 */
function exchange(url: string, waitMs = 250): Promise<Exchanged> {
  return new Promise((resolve) => {
    const msgs: Exchanged["msgs"] = [];
    const raw: string[] = [];
    let closeCode: number | undefined;
    let closed = false;
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
      resolve({ msgs, raw, closeCode, closed });
    };
    ws.on("message", (d) => {
      const text = d.toString();
      raw.push(text);
      try {
        msgs.push(JSON.parse(text));
      } catch {
        /* ignore */
      }
    });
    ws.on("close", (code) => {
      closeCode = code;
      closed = true;
      finish();
    });
    ws.on("error", () => {
      /* 拒絕路徑一律經 message/close 呈現，不經 error */
    });
    ws.on("open", () => setTimeout(finish, waitMs));
    setTimeout(finish, 2000); // 絕對安全網
  });
}

/** 真 core（跑過 migration）＋真 hub＋真 WS server；回 url builder 與 teardown。 */
async function harness() {
  const core: CrmCore = await createCrmCore(":memory:");
  await core.migrate();
  const config = testConfig();
  const hub = new RealtimeHub(core, config, createGeminiClient(config.gemini));
  const http = createServer();
  const wss = attachRealtimeWs(http, hub, SECRET, core);
  await new Promise<void>((r) => http.listen(0, () => r()));
  const port = (http.address() as AddressInfo).port;
  return {
    core,
    hub,
    url: (token: string, meetingId: string, role = "hud") =>
      `ws://127.0.0.1:${port}${WS_PATH}?token=${token}&meetingId=${meetingId}&role=${role}`,
    dispose: async () => {
      hub.disposeAll(); // 清掉 runtime 的 timer，測試間不外洩
      wss.close();
      await new Promise<void>((r) => http.close(() => r()));
      core.close();
    },
  };
}

/** 建一個 org＋一名 active 使用者（帳號閘要求兩張 row 都在且非 suspended）。 */
async function seedOrgUser(core: CrmCore, orgName: string, email: string) {
  const org = await core.orgs.create({ name: orgName });
  const user = await core.users.create({ email, passwordHash: "x", displayName: orgName });
  await core.memberships.addMembership(org.id, user.id, "owner");
  return { org, user };
}

describe("WS handshake — meeting status gate（殭屍會議根因）", () => {
  it("1) completed 的會議：握手被拒，close code = 1000（前端 kind='ended'），且不建立 runtime", async () => {
    const h = await harness();
    try {
      const { org, user } = await seedOrgUser(h.core, "Org1", "o1@example.com");
      const meeting = await h.hub.store.create(org.id, { title: "M", presenterUserId: user.id });
      h.hub.registerMeeting(meeting.id, { orgId: org.id, presenterUserId: user.id });
      const token = mintWsToken(SECRET, {
        meetingId: meeting.id,
        orgId: org.id,
        userId: user.id,
        presenterUserId: user.id,
      });

      // 會議結束（= 報告者按了「結束這場會議」／POST /api/meetings/:id/end）。
      expect(await h.hub.endMeeting(org.id, meeting.id)).toBe(true);

      // 之後那一下 F5：全新連線，前端的終態閘完全不參與。
      const r = await exchange(h.url(token, meeting.id));
      expect(r.closed).toBe(true);
      expect(r.closeCode).toBe(WS_CLOSE_MEETING_ENDED); // 1000 → describeWsClose → {terminal:true, kind:"ended"}
      expect(r.msgs.some((m) => m.type === "error" && m.code === "meeting_ended")).toBe(true);
      // 沒有 session_state ＝ 連 attach 都沒發生。
      expect(r.msgs.some((m) => m.type === "session_state")).toBe(false);
      // 根因驗證：runtime 沒有被重建（修補前這裡會是 defined ＝ 殭屍會議）。
      expect(h.hub.getRuntime(meeting.id)).toBeUndefined();
    } finally {
      await h.dispose();
    }
  });

  it("2) 正控制組：進行中的會議握手正常通過（收得到 session_state、socket 未被關）", async () => {
    const h = await harness();
    try {
      const { org, user } = await seedOrgUser(h.core, "Org1", "o1@example.com");
      const meeting = await h.hub.store.create(org.id, { title: "M", presenterUserId: user.id });
      h.hub.registerMeeting(meeting.id, { orgId: org.id, presenterUserId: user.id });
      const token = mintWsToken(SECRET, {
        meetingId: meeting.id,
        orgId: org.id,
        userId: user.id,
        presenterUserId: user.id,
      });

      const r = await exchange(h.url(token, meeting.id));
      expect(r.msgs.some((m) => m.type === "session_state")).toBe(true);
      expect(r.msgs.some((m) => m.type === "error")).toBe(false);
      expect(h.hub.getRuntime(meeting.id)).toBeDefined();
    } finally {
      await h.dispose();
    }
  });

  it("3) 斷線後 grace 期間重連：不被誤擋，且沿用同一個 runtime", async () => {
    const h = await harness();
    try {
      const { org, user } = await seedOrgUser(h.core, "Org1", "o1@example.com");
      const meeting = await h.hub.store.create(org.id, { title: "M", presenterUserId: user.id });
      h.hub.registerMeeting(meeting.id, { orgId: org.id, presenterUserId: user.id });
      const token = mintWsToken(SECRET, {
        meetingId: meeting.id,
        orgId: org.id,
        userId: user.id,
        presenterUserId: user.id,
      });

      const first = await exchange(h.url(token, meeting.id));
      expect(first.msgs.some((m) => m.type === "session_state")).toBe(true);
      const runtimeBefore = h.hub.getRuntime(meeting.id);
      expect(runtimeBefore).toBeDefined();

      // 斷線（exchange 收尾時已 close）→ DISCONNECT_GRACE_MS 是 5 分鐘，meeting 仍是 'scheduled'。
      await new Promise((r) => setTimeout(r, 50));
      const second = await exchange(h.url(token, meeting.id));
      expect(second.msgs.some((m) => m.type === "error")).toBe(false);
      expect(second.msgs.some((m) => m.type === "session_state")).toBe(true);
      // 同一個 runtime 實例 ＝ 既沒被閘擋掉、也沒在寬限期內被回收重建。
      expect(h.hub.getRuntime(meeting.id)).toBe(runtimeBefore);
    } finally {
      await h.dispose();
    }
  });

  it("4) 跨 org 憑證：被拒，且回應與「會議不存在」逐位元相同（零存在性側信道）", async () => {
    const h = await harness();
    try {
      const a = await seedOrgUser(h.core, "OrgA", "a@example.com");
      const b = await seedOrgUser(h.core, "OrgB", "b@example.com");
      // A 的會議，**進行中**（若閘只看 status 不看 org，這一場會被判定「還活著」而放行）。
      const victim = await h.hub.store.create(a.org.id, { title: "A 的會議", presenterUserId: a.user.id });
      h.hub.registerMeeting(victim.id, { orgId: a.org.id, presenterUserId: a.user.id });

      // 攻擊者：org B 的合法身分，但 token 指向 org A 的 meetingId。
      const crossOrgToken = mintWsToken(SECRET, {
        meetingId: victim.id,
        orgId: b.org.id,
        userId: b.user.id,
        presenterUserId: a.user.id,
      });
      // 對照組：同一個攻擊者，指向一個**根本不存在**的 meetingId。
      const ghostId = "00000000-0000-4000-8000-000000000000";
      const ghostToken = mintWsToken(SECRET, {
        meetingId: ghostId,
        orgId: b.org.id,
        userId: b.user.id,
        presenterUserId: b.user.id,
      });

      const cross = await exchange(h.url(crossOrgToken, victim.id));
      const ghost = await exchange(h.url(ghostToken, ghostId));

      // 都被拒。
      expect(cross.closeCode).toBe(WS_CLOSE_MEETING_ENDED);
      expect(ghost.closeCode).toBe(WS_CLOSE_MEETING_ENDED);
      expect(cross.msgs.some((m) => m.type === "session_state")).toBe(false);
      // 兩者的訊息**逐位元相同** → 攻擊者無法分辨「別的 org 有這場會議」與「這個 id 不存在」。
      expect(cross.raw).toEqual(ghost.raw);
      expect(cross.closeCode).toBe(ghost.closeCode);

      // 受害者那場會議完全沒被動到：runtime 沒被建立、也沒被攻擊者的連線拖進 room。
      expect(h.hub.getRuntime(victim.id)).toBeUndefined();
      expect(h.hub.rolesOf(victim.id)).toEqual([]);
    } finally {
      await h.dispose();
    }
  });
});
