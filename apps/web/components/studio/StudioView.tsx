"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations();
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
      // 匯入改非同步：回 202 { deckId, jobId }，deck 先為 processing；轉檔進度由編輯器輪詢顯示。
      const { deckId } = await importDeck(file);
      toast.push({ kind: "success", message: "已開始匯入，轉檔中…" });
      router.push(`/studio/${deckId}`);
    } catch (err) {
      toast.push({ kind: "error", message: err instanceof ApiError ? err.message : "匯入失敗" });
      setImporting(false);
    }
  }

  return (
    <main className="mc-studio">
      {/* 頁首走 globals.css 的共用 `.mc-pagehead` 版式（同 /crm、/present/start、/spend、
          /settings/team、/train）。原本自有的 `.mc-studio__header/__h1/__lead/__actions` 是 /studio
          獨有的一套（24px/700/ls-normal、lead 吃 --mc-text-muted、align-items:flex-start），
          與別頁 29px/600/-.02em、flex-end 明顯不一致；那四條 CSS 已同批刪除。 */}
      <header className="mc-pagehead">
        <div className="mc-pagehead__id">
          {/* kicker 是 .mc-pagehead 家族的第一列，/crm、/train、/present/start、/settings/team 都有；
              /studio 先前漏補，頁首少一層。文案走 messages（雙語），與別頁的短語慣例一致。 */}
          <span className="mc-kicker mc-kicker--page">{t("studio.kicker")}</span>
          <h1 className="mc-pagehead__h1">簡報工作室</h1>
          <p className="mc-pagehead__lead">會前準備簡報：新建 / 匯入 deck、三段 wizard 生成、逐頁微調、AI 生圖、匯出 pptx。</p>
        </div>
        <div className="mc-pagehead__acts">
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
      </header>

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
