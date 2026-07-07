"use client";

import { useEffect, useRef, useState } from "react";
import type { SlideBlock, SlideSpec, Suggestion } from "@meetcopilot/shared";
import { SlidePreview } from "./SlidePreview";

export type SuggestionAction = "accept" | "edit" | "reject";

/**
 * Approval queue (I2). The presenter accepts (A) / skips (S) proposed slides; only accept/edit append.
 * Each item has an expiresAt countdown (auto-discard on timeout — server times out too, so we just drop
 * locally). Keyboard A/S act on the FRONT item and are disabled while a text input is focused.
 * Touch targets are ≥44px for one-handed phone use.
 */
export function SuggestionQueue({
  suggestions,
  onAct,
  onExpire,
}: {
  suggestions: Suggestion[];
  onAct: (id: string, action: SuggestionAction, editedSlide?: SlideSpec) => void;
  onExpire: (id: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
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

  // Keyboard A/S on the front item — disabled when typing in an input/textarea.
  const front = suggestions[0];
  const frontId = front?.id;
  useEffect(() => {
    if (!frontId) return;
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
  }, [frontId, onAct]);

  if (suggestions.length === 0) {
    return (
      <section className="mc-hud__panel" aria-label="建議批准佇列">
        <h2 className="mc-hud__panel-title">建議批准佇列</h2>
        <p className="mc-hud__empty">聆聽中，尚無補充頁建議…</p>
      </section>
    );
  }

  return (
    <section className="mc-hud__panel" aria-label="建議批准佇列">
      <h2 className="mc-hud__panel-title">
        建議批准佇列
        <span className="mc-hud__kbd-hint">
          <kbd>A</kbd> 接受 · <kbd>S</kbd> 略過
        </span>
      </h2>
      <ul className="mc-sugqueue">
        {suggestions.map((s, i) => {
          const total = rememberInitial(initialRemaining.current, s);
          const remaining = Math.max(0, s.expiresAt - now);
          const pct = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
          return (
            <SuggestionCard
              key={s.id}
              suggestion={s}
              isFront={i === 0}
              remainingMs={remaining}
              pct={pct}
              onAct={onAct}
            />
          );
        })}
      </ul>
    </section>
  );
}

function rememberInitial(map: Map<string, number>, s: Suggestion): number {
  const existing = map.get(s.id);
  if (existing !== undefined) return existing;
  const initial = Math.max(1, s.expiresAt - Date.now());
  map.set(s.id, initial);
  return initial;
}

function SuggestionCard({
  suggestion,
  isFront,
  remainingMs,
  pct,
  onAct,
}: {
  suggestion: Suggestion;
  isFront: boolean;
  remainingMs: number;
  pct: number;
  onAct: (id: string, action: SuggestionAction, editedSlide?: SlideSpec) => void;
}) {
  const [editing, setEditing] = useState(false);
  const secs = Math.ceil(remainingMs / 1000);

  return (
    <li className={`mc-sugcard ${isFront ? "is-front" : ""}`}>
      <div className="mc-sugcard__timer" aria-label={`${secs} 秒後自動略過`}>
        <div className="mc-sugcard__timerbar" style={{ width: `${pct * 100}%` }} />
        <span className="mc-sugcard__secs">{secs}s</span>
      </div>

      <SlidePreview slide={suggestion.slide} />
      <p className="mc-sugcard__reason">{suggestion.reason}</p>

      {editing ? (
        <EditPanel
          slide={suggestion.slide}
          onCancel={() => setEditing(false)}
          onSubmit={(edited) => {
            setEditing(false);
            onAct(suggestion.id, "edit", edited);
          }}
        />
      ) : (
        <div className="mc-sugcard__actions">
          <button type="button" className="mc-btn mc-btn--primary mc-sugbtn" onClick={() => onAct(suggestion.id, "accept")}>
            接受{isFront ? " (A)" : ""}
          </button>
          <button type="button" className="mc-btn mc-sugbtn" onClick={() => onAct(suggestion.id, "reject")}>
            略過{isFront ? " (S)" : ""}
          </button>
          <button type="button" className="mc-btn mc-btn--ghost mc-sugbtn" onClick={() => setEditing(true)}>
            編輯後接受
          </button>
        </div>
      )}
    </li>
  );
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
  const [eyebrow, setEyebrow] = useState(slide.eyebrow ?? "");
  const [heading, setHeading] = useState(() => currentHeading(slide.blocks));

  function submit() {
    const blocks = replaceFirstHeading(slide.blocks, heading);
    const edited: SlideSpec = { ...slide, eyebrow: eyebrow.trim() || undefined, blocks };
    onSubmit(edited);
  }

  return (
    <div className="mc-sugedit">
      <label className="mc-field">
        <span>Eyebrow（小標）</span>
        <input className="mc-input" value={eyebrow} onChange={(e) => setEyebrow(e.target.value)} />
      </label>
      <label className="mc-field">
        <span>標題</span>
        <input className="mc-input" value={heading} onChange={(e) => setHeading(e.target.value)} />
      </label>
      <div className="mc-sugcard__actions">
        <button type="button" className="mc-btn mc-btn--primary mc-sugbtn" onClick={submit}>
          接受修改
        </button>
        <button type="button" className="mc-btn mc-btn--ghost mc-sugbtn" onClick={onCancel}>
          取消
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
