"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { SlideBlock, SlideSpec, Suggestion } from "@meetcopilot/shared";
import { SlideRenderer } from "@/components/slide/SlideRenderer";

export type SuggestionAction = "accept" | "edit" | "reject";

/**
 * I2 批准卡（「建議卡即批准卡」，ROM 2026-07-30 21:17 決策 1）。
 *
 * 一次只顯示**最前面一則**（`第 N 則 · 後面還有 M 則`），承載兩型：
 *  (a) **話術建議**（slide 內容只有一段話）→ 大字話術＋「現在可以這樣說」kicker＋為什麼
 *  (b) **補充頁建議**（有版面的一頁）→ SlideRenderer 縮圖預覽
 * 兩型送出的 wire action **完全相同**（accept / edit / reject），**WS 協定零改動**；型別只決定
 * 呈現。EDIT 路徑（含編輯 UI）逐字保留。
 *
 * **誠實文案（ROM 2026-07-31 13:05 裁決 1）**：primary 按鈕兩型一律「加入簡報」。舊的話術版寫「照這樣說」
 * 會讓人以為只是唸一句、什麼都不會動——實際上 accept 一樣把那一頁 APPEND 進 live deck（I1/I2 同一條路徑）。
 * 按鈕必須說出真正會發生的事；「這句可以現在講」這層意思改由 kicker（kickerTalk）＋大字呈現承載。
 *
 * **不樂觀更新（I2 加固）**：按下任何按鈕只送訊息，卡片進 in-flight（按鈕 disabled ＋ aria-busy），
 * 真正消失一律等 server 回 `suggestion_result`（或 `expiresAt` 逾時）。掐斷 WS 時卡片留在原地，
 * 畫面永遠等於 server 真相——授權仍由 server 的 presenter 身分閘決定，前端不代為判斷。
 *
 * 每則有 expiresAt 倒數（逾時自動 discard；server 也會逾時，本地只是同步丟掉）。
 * 鍵盤 A/S 作用在最前面一則，輸入框聚焦時停用；觸控目標 ≥44px。
 */
export function SuggestionDeck({
  suggestions,
  pending,
  onAct,
  onExpire,
  variant = "desk",
}: {
  suggestions: Suggestion[];
  /** 已送出、等待 server 裁決的 id（不樂觀更新的 in-flight 集合）。 */
  pending: ReadonlySet<string>;
  onAct: (id: string, action: SuggestionAction, editedSlide?: SlideSpec) => void;
  onExpire: (id: string) => void;
  variant?: "desk" | "mobile";
}) {
  const t = useTranslations("hud.suggest");
  const [now, setNow] = useState(() => Date.now());
  const [editing, setEditing] = useState<string | null>(null);
  const initialRemaining = useRef<Map<string, number>>(new Map());

  // Single ticker drives every countdown.
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(h);
  }, []);

  // Auto-discard expired items (report to parent once each).
  useEffect(() => {
    for (const s of suggestions) {
      if (s.expiresAt - now <= 0) onExpire(s.id);
    }
  }, [now, suggestions, onExpire]);

  const front = suggestions[0];
  const frontId = front?.id;
  const frontPending = frontId ? pending.has(frontId) : false;

  // Keyboard A/S on the front item — disabled when typing in an input/textarea or while in-flight.
  useEffect(() => {
    if (!frontId || frontPending) return;
    const id: string = frontId; // narrowed for the closure below
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      const typing = el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "a") {
        e.preventDefault();
        onAct(id, "accept");
      } else if (k === "s") {
        e.preventDefault();
        onAct(id, "reject");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [frontId, frontPending, onAct]);

  if (!front) {
    return (
      <section className={`mc-appr mc-appr--${variant} is-empty`} aria-label={t("label")}>
        <span className="mc-kicker">{t("label")}</span>
        <p className="mc-appr__empty">{t("empty")}</p>
      </section>
    );
  }

  const total = rememberInitial(initialRemaining.current, front);
  const remaining = Math.max(0, front.expiresAt - now);
  const pct = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const secs = Math.ceil(remaining / 1000);
  const talk = isTalkTrack(front.slide);
  const busy = pending.has(front.id);
  const isEditing = editing === front.id;

  return (
    <section className={`mc-appr mc-appr--${variant}`} aria-label={t("label")} aria-busy={busy || undefined}>
      <div className="mc-appr__meta">
        <span className="mc-kicker mc-kicker--warn">{talk ? t("kickerTalk") : t("kickerSlide")}</span>
        <span className="mc-appr__pos mc-mono">{t("position", { n: 1, total: suggestions.length })}</span>
        <span className="mc-appr__ttl mc-mono">{t("expiresIn", { secs })}</span>
        {suggestions.length > 1 ? (
          <span className="mc-appr__rest mc-mono">{t("more", { n: suggestions.length - 1 })}</span>
        ) : null}
      </div>
      <div className="mc-appr__timer" aria-hidden="true">
        <span style={{ width: `${pct * 100}%` }} />
      </div>

      {talk ? (
        <p className="mc-appr__line">{talkText(front.slide)}</p>
      ) : (
        <div className="mc-appr__preview">
          <SlideRenderer slide={front.slide} size="thumb" />
        </div>
      )}

      <p className="mc-appr__why">{front.reason}</p>

      {isEditing ? (
        <EditPanel
          slide={front.slide}
          onCancel={() => setEditing(null)}
          onSubmit={(edited) => {
            setEditing(null);
            onAct(front.id, "edit", edited);
          }}
        />
      ) : (
        <div className="mc-appr__acts">
          <button
            type="button"
            className="mc-btn mc-btn--primary mc-appr__go"
            disabled={busy}
            onClick={() => onAct(front.id, "accept")}
          >
            {/* 兩型同一句：accept 的真正效果就是「加入簡報」（裁決 1）。 */}
            {t("addToDeck")}
          </button>
          {talk ? null : (
            <button type="button" className="mc-btn mc-appr__alt" disabled={busy} onClick={() => setEditing(front.id)}>
              {t("editThenAdd")}
            </button>
          )}
          <button type="button" className="mc-btn mc-btn--ghost mc-appr__alt" disabled={busy} onClick={() => onAct(front.id, "reject")}>
            {t("skip")}
          </button>
        </div>
      )}

      {busy ? (
        <p className="mc-appr__inflight" role="status">
          {t("sending")}
        </p>
      ) : (
        // 鍵盤提示按型別分開（裁決 1）：提示字必須逐字對上同一張卡上按鈕真正的動作，
        // 兩型的 A 都是「加入簡報」、S 都是「跳過」——**鍵盤行為完全沒變**，只是文案不再寫「照著說」。
        <p className="mc-appr__kbd mc-mono">{talk ? t("keysTalk") : t("keysSlide")}</p>
      )}
    </section>
  );
}

/** 舊名相容匯出（本檔曾經是垂直堆疊的佇列）。 */
export { SuggestionDeck as SuggestionQueue };

function rememberInitial(map: Map<string, number>, s: Suggestion): number {
  const existing = map.get(s.id);
  if (existing !== undefined) return existing;
  const initial = Math.max(1, s.expiresAt - Date.now());
  map.set(s.id, initial);
  return initial;
}

/** 話術卡大字唯一會顯示的那一類 block（其餘型別＝有版面，必須看縮圖）。 */
const TALK_BLOCK_TYPES = new Set(["heading", "subheading", "paragraph", "quote"]);

/**
 * 建議型別分類（純前端，wire 不變）。
 *
 * **收緊（ROM 2026-07-31 16:00 決策 1，I2）**：話術卡只印 `talkText()` 的**一行**，還會**藏掉**
 * 「編輯後加入」鈕。舊版把 heading+subheading／heading+paragraph／heading+quote 也判成話術卡，
 * 於是報告者看到一行、按下「加入簡報」，實際 APPEND 進 live deck 的卻是他沒看過的第二段文字——
 * 這是 I2「所見即所批准」的破口。現在的判準是**「slide 的全部文字內容 ＝ 話術卡會顯示的那一行」**：
 *
 *  - `textual` ＝ blocks 中 type ∈ heading|subheading|paragraph|quote 者；
 *  - 必須 `textual.length <= 1`（多於一段文字＝有沒被顯示的內容）**且**沒有任何其他 block
 *    （stat/bullets/features/chart/table/timeline/steps/image/two-col 一律代表有版面可看）。
 *
 * 其餘全部落**縮圖分支**（SlideRenderer 預覽＋「編輯後加入」鈕），寧可多給一張縮圖也不能少給。
 * 兩型送出的 wire action 完全相同（accept/edit/reject），A/S 鍵行為亦未變——分類只決定呈現。
 */
export function isTalkTrack(slide: SlideSpec): boolean {
  const textual = slide.blocks.filter((b) => TALK_BLOCK_TYPES.has(b.type));
  // 有任何非文字 block（textual 是 blocks 子集，長度不等即代表存在其他型別）→ 縮圖分支。
  if (textual.length !== slide.blocks.length) return false;
  return textual.length <= 1;
}

/** 話術大字：優先取標題，沒有標題就取第一段文字。 */
export function talkText(slide: SlideSpec): string {
  const h = currentHeading(slide.blocks);
  if (h) return h;
  for (const b of slide.blocks) {
    if (b.type === "paragraph" || b.type === "quote") return b.text;
  }
  return "";
}

/** Bounded quick-edit: eyebrow + first heading text (most impactful; stays within SlideSpec). */
function EditPanel({
  slide,
  onCancel,
  onSubmit,
}: {
  slide: SlideSpec;
  onCancel: () => void;
  onSubmit: (edited: SlideSpec) => void;
}) {
  const t = useTranslations("hud.suggest");
  const [eyebrow, setEyebrow] = useState(slide.eyebrow ?? "");
  const [heading, setHeading] = useState(() => currentHeading(slide.blocks));

  function submit() {
    const blocks = replaceFirstHeading(slide.blocks, heading);
    const edited: SlideSpec = { ...slide, eyebrow: eyebrow.trim() || undefined, blocks };
    onSubmit(edited);
  }

  return (
    <div className="mc-appr__edit">
      <label className="mc-field">
        <span>{t("editEyebrow")}</span>
        <input className="mc-input" value={eyebrow} onChange={(e) => setEyebrow(e.target.value)} />
      </label>
      <label className="mc-field">
        <span>{t("editHeading")}</span>
        <input className="mc-input" value={heading} onChange={(e) => setHeading(e.target.value)} />
      </label>
      <div className="mc-appr__acts">
        <button type="button" className="mc-btn mc-btn--primary mc-appr__go" onClick={submit}>
          {t("editConfirm")}
        </button>
        <button type="button" className="mc-btn mc-btn--ghost mc-appr__alt" onClick={onCancel}>
          {t("editCancel")}
        </button>
      </div>
    </div>
  );
}

function currentHeading(blocks: SlideBlock[]): string {
  for (const b of blocks) if (b.type === "heading" || b.type === "subheading") return b.text;
  return "";
}

function replaceFirstHeading(blocks: SlideBlock[], text: string): SlideBlock[] {
  let replaced = false;
  const next = blocks.map((b) => {
    if (!replaced && (b.type === "heading" || b.type === "subheading")) {
      replaced = true;
      return { ...b, text };
    }
    return b;
  });
  if (!replaced && text.trim()) next.unshift({ type: "heading", text });
  return next;
}
