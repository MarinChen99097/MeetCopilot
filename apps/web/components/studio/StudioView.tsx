"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DeckSummary } from "@meetcopilot/shared";
import { ApiError, importDeck, listDecks } from "@/lib/api";
import { fmtRelative } from "@/lib/format";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { StateBoundary } from "@/components/ui/StateBoundary";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Spinner } from "@/components/ui/Spinner";
import { DeckWizard } from "./DeckWizard";

/** /studio — DynamicSlide 簡報工作室：deck 清單 + 新建（wizard）/ 匯入 → slide 編輯器（/studio/[deckId]）。 */
export function StudioView() {
  const router = useRouter();
  const toast = useToast();

  const [items, setItems] = useState<DeckSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    listDecks()
      .then((res) => {
        if (!alive) return;
        setItems(res.items);
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
  }, []);

  useEffect(() => load(), [load]);

  async function onImportFile(file: File) {
    setImporting(true);
    try {
      const deck = await importDeck(file);
      toast.push({ kind: "success", message: "已匯入簡報" });
      router.push(`/studio/${deck.id}`);
    } catch (err) {
      toast.push({ kind: "error", message: err instanceof ApiError ? err.message : "匯入失敗" });
      setImporting(false);
    }
  }

  return (
    <main className="mc-studio">
      <div className="mc-studio__header">
        <div>
          <h1 className="mc-studio__h1">簡報工作室</h1>
          <p className="mc-studio__lead">會前準備簡報：新建 / 匯入 deck、三段 wizard 生成、逐頁微調、AI 生圖、匯出 pptx。</p>
        </div>
        <div className="mc-studio__actions">
          <button type="button" className="mc-btn mc-btn--ghost" onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? <Spinner size={14} /> : "📄"} 從檔案匯入
          </button>
          <button type="button" className="mc-btn mc-btn--primary" onClick={() => setWizard(true)}>
            ＋ 新建
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pptx,.pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <StateBoundary
        loading={loading}
        error={error}
        isEmpty={items.length === 0}
        onRetry={load}
        skeleton={<GridSkeleton />}
        emptyTitle="還沒有任何簡報"
        emptyHint="用三段 wizard 生成第一份，或從 .pptx / .pdf 匯入。"
        emptyAction={
          <button type="button" className="mc-btn mc-btn--primary" onClick={() => setWizard(true)}>
            ＋ 新建第一份簡報
          </button>
        }
      >
        <ul className="mc-deckgrid">
          {items.map((d) => (
            <li key={d.id}>
              <button type="button" className="mc-deckcard" onClick={() => router.push(`/studio/${d.id}`)}>
                <span className="mc-deckcard__title">{d.title}</span>
                <span className="mc-deckcard__meta">
                  <StatusBadge tone="muted">{d.language === "zh-TW" ? "繁中" : "EN"}</StatusBadge>
                  <span>{d.slideCount} 頁</span>
                </span>
                <span className="mc-deckcard__foot">更新於 {fmtRelative(d.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      </StateBoundary>

      {wizard ? (
        <DeckWizard
          onCancel={() => setWizard(false)}
          onCreated={(deckId) => {
            setWizard(false);
            toast.push({ kind: "success", message: "已生成簡報" });
            router.push(`/studio/${deckId}`);
          }}
        />
      ) : null}
    </main>
  );
}

function GridSkeleton() {
  return (
    <ul className="mc-deckgrid" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i}>
          <div className="mc-deckcard mc-deckcard--skel">
            <div className="mc-skel__line" style={{ width: "70%" }} />
            <div className="mc-skel__line" style={{ width: "40%" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
