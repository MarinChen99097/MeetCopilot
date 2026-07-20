"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { Note } from "@meetcopilot/shared";
import { ApiError, createNote, deleteNote, listNotes, updateNote } from "@/lib/api";
import { fmtRelative } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";
import { StateBoundary } from "@/components/ui/StateBoundary";
import { Spinner } from "@/components/ui/Spinner";
import { Markdown } from "@/components/ui/Markdown";

/**
 * AI 敘事筆記的 note_type（RESEARCH_UPGRADE_CONTRACT §2）。server 落庫 'narrative'，
 * shared 的 `NoteType` union 已含 'narrative'/'observations'，故直接以型別比對辨識。
 */
function isNarrative(n: Note): boolean {
  return n.noteType === "narrative";
}

/** 筆記 tab：可新增/釘選/刪除的筆記流（entityType='company'）；AI 敘事筆記置頂。 */
export function NotesTab({ companyId }: { companyId: string }) {
  const t = useTranslations("notesTab");
  const toast = useToast();
  const [items, setItems] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    listNotes("company", companyId)
      .then((rows) => {
        if (!alive) return;
        setItems(sortNotes(rows));
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof ApiError ? err.message : "載入失敗");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [companyId]);

  useEffect(() => load(), [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      await createNote({ entityType: "company", entityId: companyId, body: body.trim() });
      setBody("");
      toast.push({ kind: "success", message: "已新增筆記" });
      load();
    } catch (err) {
      toast.push({ kind: "error", message: err instanceof ApiError ? err.message : "新增失敗" });
    } finally {
      setBusy(false);
    }
  }

  async function togglePin(n: Note) {
    try {
      await updateNote(n.id, { pinned: n.pinned ? 0 : 1 });
      load();
    } catch (err) {
      toast.push({ kind: "error", message: err instanceof ApiError ? err.message : "更新失敗" });
    }
  }

  async function remove(n: Note) {
    try {
      await deleteNote(n.id);
      toast.push({ kind: "info", message: "已刪除筆記" });
      load();
    } catch (err) {
      toast.push({ kind: "error", message: err instanceof ApiError ? err.message : "刪除失敗" });
    }
  }

  return (
    <div className="mc-tabpane">
      <h3 className="mc-tabpane__title">筆記</h3>
      <form className="mc-noteform" onSubmit={add}>
        <textarea
          className="mc-input mc-noteform__ta"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="新增一則筆記…"
          rows={2}
        />
        <button type="submit" className="mc-btn mc-btn--primary mc-btn--sm" disabled={busy || !body.trim()}>
          {busy ? <Spinner size={14} /> : "新增"}
        </button>
      </form>

      <StateBoundary
        loading={loading}
        error={error}
        isEmpty={items.length === 0}
        onRetry={load}
        emptyTitle="尚無筆記"
        emptyHint="記錄會前準備、通話重點或研究發現。"
      >
        <ul className="mc-notelist">
          {items.map((n) => (
            <li
              key={n.id}
              className={`mc-noteitem ${n.pinned ? "is-pinned" : ""} ${isNarrative(n) ? "is-narrative" : ""}`}
            >
              {isNarrative(n) ? <span className="mc-noteitem__tag">{t("aiNarrative")}</span> : null}
              <Markdown className="mc-noteitem__body">{n.body}</Markdown>
              <div className="mc-noteitem__foot">
                <span className="mc-noteitem__time">{fmtRelative(n.createdAt)}</span>
                <button type="button" className="mc-noteitem__act" onClick={() => togglePin(n)}>
                  {n.pinned ? "取消釘選" : "釘選"}
                </button>
                <button type="button" className="mc-noteitem__act mc-noteitem__act--danger" onClick={() => remove(n)}>
                  刪除
                </button>
              </div>
            </li>
          ))}
        </ul>
      </StateBoundary>
    </div>
  );
}

function sortNotes(rows: Note[]): Note[] {
  return [...rows].sort((a, b) => {
    // AI 敘事（pinned narrative）恆置頂；其後照既有「釘選優先→新到舊」排。observations 走一般清單。
    const na = isNarrative(a) ? 1 : 0;
    const nb = isNarrative(b) ? 1 : 0;
    if (na !== nb) return nb - na;
    const pa = a.pinned ? 1 : 0;
    const pb = b.pinned ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return b.createdAt - a.createdAt;
  });
}
