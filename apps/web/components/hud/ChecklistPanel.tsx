"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  CHECKLIST_CATEGORIES,
  compareChecklistOrder,
  type ChecklistCategory,
  type ChecklistItem,
  type ClientMessage,
  type ServerMessage,
} from "@meetcopilot/shared";

/** wire 上的清單狀態（從 protocol 推導，避免與凍結契約漂移）。 */
export type ChecklistWireStatus = Extract<ServerMessage, { type: "checklist" }>["status"];
/** 報告者手動動作（同上，從 protocol 推導）。 */
export type ChecklistActionKind = Extract<ClientMessage, { type: "checklist_action" }>["action"];

/**
 * 待講清單面板（MEETING_CHECKLIST_CONTRACT §8）。**HUD only（I3）**——本元件永遠不得被 `components/present/**` import。
 *
 * 兩個 variant（2026-07-30 重設計，行為完全相同、只有版面不同）：
 *  - `"bar"`（預設，/hud 手機）：收合態＝單行 ≤48px（進度「已講 4/12」＋進度條＋下一個待辦），
 *    刻意夠矮，**不把 I2 批准卡擠出首屏**；點一下展開成可勾選的完整清單（手機可用性不回退）。
 *  - `"desk"`（cockpit 右欄，設計稿 :251-269 形態）：常駐清單——標頭進度條＋混排可勾列表＋右側分類 tag，
 *    「正在講」的項目有 warn 底＋左脊。
 *
 * 分母＝pending＋covered（**排除 skipped**）。
 * I2：勾選只送 `checklist_action`，授權在 server。**前端絕不樂觀改狀態**——真相來源是 server 回的全量 snapshot；
 * 送出後只給 in-flight 視覺回饋（淡化＋aria-busy），狀態一律等下一次 snapshot 覆蓋。
 */
export function ChecklistPanel({
  items,
  status,
  currentSlideIdx,
  onAction,
  variant = "bar",
}: {
  items: ChecklistItem[];
  /** null＝本場沒有清單（server 從未廣播）→ 不佔版面。 */
  status: ChecklistWireStatus | null;
  currentSlideIdx?: number;
  onAction: (itemId: string, action: ChecklistActionKind) => void;
  variant?: "bar" | "desk";
}) {
  const t = useTranslations("hud.checklist");
  const [expanded, setExpanded] = useState(false);
  // 送出中的項目 id（僅視覺回饋）。每次收到新 snapshot（items 換新陣列）就清空——snapshot 才是真相。
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(() => new Set<string>());
  useEffect(() => {
    setInFlight(new Set<string>());
  }, [items]);

  const covered = useMemo(() => items.filter((it) => it.status === "covered").length, [items]);
  const skipped = useMemo(() => items.filter((it) => it.status === "skipped").length, [items]);
  const next = useMemo(() => nextPending(items), [items]);
  const ordered = useMemo(() => [...items].sort(compareChecklistOrder), [items]);
  const groups = useMemo(() => groupByCategory(items), [items]);

  // 本場沒有清單 → 完全不佔版面。
  if (status === null) return null;

  if (status === "generating") {
    return (
      <section className={`mc-ckl mc-ckl--${variant} is-note`} aria-label={t("title")} role="status">
        <span className="mc-ckl__spinner" aria-hidden="true" />
        <span className="mc-ckl__notetext">{t("generating")}</span>
      </section>
    );
  }

  if (status === "failed") {
    return (
      <section className={`mc-ckl mc-ckl--${variant} is-note is-failed`} aria-label={t("title")} role="status">
        <span className="mc-ckl__notetext">{t("failed")}</span>
      </section>
    );
  }

  // status==='ready' 但零項目：極簡空狀態（仍然很矮）。
  if (items.length === 0) {
    return (
      <section className={`mc-ckl mc-ckl--${variant} is-note`} aria-label={t("title")}>
        <span className="mc-ckl__notetext">{t("empty")}</span>
      </section>
    );
  }

  // 進度分母**排除 skipped**（＝pending + covered）：skipped 是報告者主動判定「這場不講」，
  // 留在分母裡會讓進度永遠追不到 100%，等於逼報告者在略過與看到完成之間二選一。
  const total = items.length - skipped;
  // 全部被略過（total===0）→ 沒有可完成的事：不得除零／NaN，改顯示「全部略過」並隱藏進度條。
  const pct = total > 0 ? Math.round((covered / total) * 100) : 0;

  const rowOf = (it: ChecklistItem) => (
    <ChecklistRow
      key={it.id}
      item={it}
      isNow={it.slideIdx !== undefined && it.slideIdx === currentSlideIdx}
      busy={inFlight.has(it.id)}
      onAction={(action) => {
        setInFlight((prev) => new Set(prev).add(it.id));
        onAction(it.id, action);
      }}
    />
  );

  // ── desk（cockpit 右欄）：常駐清單，不需要展開／收合 ─────────────
  if (variant === "desk") {
    return (
      <section className="mc-ckl mc-ckl--desk" aria-label={t("title")}>
        <div className="mc-ckl__head">
          <span className="mc-kicker">{t("title")}</span>
          <span className="mc-ckl__count mc-mono">
            {total > 0 ? `${covered}/${total}` : t("allSkipped")}
          </span>
        </div>
        {total > 0 ? (
          <div className="mc-bar" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </div>
        ) : null}
        <ul className="mc-ckl__list">{ordered.map(rowOf)}</ul>
      </section>
    );
  }

  // ── bar（/hud 手機）：≤48px 收合行 ＋ 展開後分三組 ────────────────
  return (
    <section className={`mc-ckl mc-ckl--bar${expanded ? " is-expanded" : ""}`} aria-label={t("title")}>
      <button
        type="button"
        className="mc-ckl__bar"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        title={expanded ? t("collapse") : t("expand")}
      >
        <span className="mc-ckl__count mc-mono">
          {total > 0 ? t("progress", { covered, total }) : t("allSkipped")}
        </span>
        {total > 0 ? (
          <span className="mc-bar mc-ckl__meter" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </span>
        ) : null}
        <span className="mc-ckl__next">{next ? next.title : total > 0 ? t("allDone") : ""}</span>
        <span className="mc-ckl__chev" aria-hidden="true">
          {expanded ? "▴" : "▾"}
        </span>
      </button>

      {expanded ? (
        <div className="mc-ckl__groups">
          {CHECKLIST_CATEGORIES.map((cat) => {
            const rows = groups[cat];
            if (rows.length === 0) return null;
            return (
              <div className="mc-ckl__group" key={cat}>
                <span className="mc-kicker">{t(CATEGORY_KEY[cat])}</span>
                <ul className="mc-ckl__list">{rows.map(rowOf)}</ul>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

/** 單列：checkbox ＋ title（covered→刪除線＋淡化）＋分類 tag ＋「正在講」左脊＋略過/復原。 */
function ChecklistRow({
  item,
  isNow,
  busy,
  onAction,
}: {
  item: ChecklistItem;
  isNow: boolean;
  busy: boolean;
  onAction: (action: ChecklistActionKind) => void;
}) {
  const t = useTranslations("hud.checklist");
  const isCovered = item.status === "covered";
  const isSkipped = item.status === "skipped";
  const cls = [
    "mc-ckl__item",
    isCovered ? "is-covered" : "",
    isSkipped ? "is-skipped" : "",
    isNow ? "is-now" : "",
    busy ? "is-inflight" : "",
    item.priority === "must" ? "is-must" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className={cls} aria-busy={busy || undefined}>
      <label className="mc-ckl__label">
        <input
          type="checkbox"
          className="mc-ckl__box"
          checked={isCovered}
          // 不樂觀更新：只送訊息，狀態等 server snapshot（React 會把 checkbox 還原成 props 值）。
          onChange={() => onAction(isCovered ? "uncheck" : "check")}
          aria-label={isCovered ? t("markPending") : t("markCovered")}
        />
        <span className="mc-ckl__text">
          <span className="mc-ckl__titletext">{item.title}</span>
          <span className="mc-ckl__meta mc-mono">
            {isNow ? t("nowSpeaking") : isSkipped ? t("skippedTag") : item.detail ? item.detail : ""}
          </span>
        </span>
      </label>
      <span className="mc-ckl__tag mc-mono">{t(CATEGORY_KEY[item.category])}</span>
      {item.status === "pending" ? (
        <button type="button" className="mc-ckl__skip" onClick={() => onAction("skip")}>
          {t("skip")}
        </button>
      ) : isSkipped ? (
        <button type="button" className="mc-ckl__skip" onClick={() => onAction("uncheck")}>
          {t("restore")}
        </button>
      ) : null}
    </li>
  );
}

const CATEGORY_KEY: Record<ChecklistCategory, "catTalk" | "catAsk" | "catAddress"> = {
  talk: "catTalk",
  ask: "catAsk",
  address: "catAddress",
};

// ── pure helpers ────────────────────────────────────────────────────
/** 下一個待辦：pending 中 priority='must' 優先，再依 idx（skipped/covered 不算）——與 server 注入分析
 *  prompt 的順序共用同一個 comparator（shared/checklist.ts），保證 HUD 顯示＝模型認定的最優先項。 */
export function nextPending(items: ChecklistItem[]): ChecklistItem | null {
  return items.filter((it) => it.status === "pending").sort(compareChecklistOrder)[0] ?? null;
}

/** 依 category 分三組，各組內依 idx 排序。 */
export function groupByCategory(items: ChecklistItem[]): Record<ChecklistCategory, ChecklistItem[]> {
  const out: Record<ChecklistCategory, ChecklistItem[]> = { talk: [], ask: [], address: [] };
  for (const it of items) {
    const bucket = out[it.category];
    if (bucket) bucket.push(it);
  }
  for (const cat of CHECKLIST_CATEGORIES) out[cat].sort((a, b) => a.idx - b.idx);
  return out;
}

/** 清單進度摘要（HUD 手機頂列用；分母排除 skipped，與面板同一套算法）。 */
export function checklistProgress(items: ChecklistItem[]): { covered: number; total: number; pct: number } {
  const covered = items.filter((it) => it.status === "covered").length;
  const skipped = items.filter((it) => it.status === "skipped").length;
  const total = items.length - skipped;
  return { covered, total, pct: total > 0 ? Math.round((covered / total) * 100) : 0 };
}
