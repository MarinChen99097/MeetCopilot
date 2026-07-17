/**
 * migration 014：meeting_signals.type CHECK 放寬到 11 類。驗證 M 新增的 'person_mention'／'topic_shift'
 * 可經 MeetingStore.saveSignal 落庫、signals() 讀回（放寬前這兩類會被 CHECK 靜默擋掉）。
 * MeetingStore 屬 realtime（唯讀 import；本測試不修改它）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createCrmCore } from "@meetcopilot/crm";
import type { CrmCore } from "@meetcopilot/crm";
import { MeetingStore } from "../realtime/meeting-store.js";

let core: CrmCore;
const ORG = "org-sig";
const MEETING = "mtg-1";

beforeEach(async () => {
  core = await createCrmCore(":memory:");
  await core.migrate();
});

afterEach(() => core.close());

describe("meeting_signals widened CHECK (migration 014)", () => {
  it("persists person_mention + topic_shift and reads them back", async () => {
    const store = new MeetingStore(core.db);
    await store.saveSignal(ORG, MEETING, { id: "s1", kind: "person_mention", label: "客戶-王經理", confidence: 0.8 });
    await store.saveSignal(ORG, MEETING, { id: "s2", kind: "topic_shift", label: "轉向定價", confidence: 0.7 });
    // 既有類別也仍可（回歸保障）。
    await store.saveSignal(ORG, MEETING, { id: "s3", kind: "interest", label: "有興趣", confidence: 0.6 });

    const kinds = (await store.signals(ORG, MEETING)).map((s) => s.kind).sort();
    expect(kinds).toEqual(["interest", "person_mention", "topic_shift"]);
  });
});
