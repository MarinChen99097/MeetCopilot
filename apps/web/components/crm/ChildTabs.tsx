"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import type { CompanyNews, CompanyTech, CompanyDepartment, Deal, DealStage } from "@meetcopilot/shared";
import {
  ApiError,
  getCompanyNews,
  getCompanyTech,
  getCompanyDepartments,
  listDeals,
} from "@/lib/api";
import { fmtDate, fmtNumber } from "@/lib/format";
import { StateBoundary } from "@/components/ui/StateBoundary";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";
import { StatusBadge } from "@/components/ui/StatusBadge";

/** Generic child-table loader wrapper (news/tech/departments/deals share loading+3-state). */
function useChild<T>(loader: () => Promise<T[]>, deps: unknown[]) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    loader()
      .then((rows) => {
        if (!alive) return;
        setItems(rows);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => load(), [load]);
  return { items, loading, error, load };
}

export function NewsTab({ companyId }: { companyId: string }) {
  const { items, loading, error, load } = useChild<CompanyNews>(() => getCompanyNews(companyId), [companyId]);
  const isZh = useLocale() === "zh-TW";
  return (
    <div className="mc-tabpane">
      <h3 className="mc-tabpane__title">新聞</h3>
      <StateBoundary
        loading={loading}
        error={error}
        isEmpty={items.length === 0}
        onRetry={load}
        emptyTitle="尚無新聞"
        emptyHint="用研究引擎補齊。"
      >
        <ul className="mc-newslist">
          {items.map((n) => (
            <li key={n.id} className="mc-newsitem">
              <div className="mc-newsitem__top">
                <span className="mc-newsitem__title">
                  {n.url ? (
                    <a href={n.url} target="_blank" rel="noreferrer noopener">
                      {n.title}
                    </a>
                  ) : (
                    n.title
                  )}
                  {isZh && n.titleZh ? <span className="mc-i18n-title">🌐 {n.titleZh}</span> : null}
                </span>
                {n.category ? <StatusBadge tone="info">{n.category}</StatusBadge> : null}
              </div>
              <div className="mc-newsitem__meta">
                {n.source ?? "來源不明"} · {fmtDate(n.publishedAt)}
              </div>
              {n.summary ? <p className="mc-newsitem__sum">{n.summary}</p> : null}
              {isZh && n.summaryZh ? (
                <p className="mc-i18n-sum">
                  <span className="mc-i18n-sum__label">🌐 中文簡介</span>
                  {n.summaryZh}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </StateBoundary>
    </div>
  );
}

/**
 * 技術棧一列（本地鏡像）：CompanyTech ＋ noteZh 一句繁中說明（migration 016 `company_tech.note_zh`）。
 * shared 的 CompanyTech 由 server/packages 工程師平行加 noteZh；此本地聯集避免 tsc 因 shared 未就緒而紅
 * （shared 補上後仍相容）。
 */
type TechRow = CompanyTech & { noteZh?: string };

export function TechTab({ companyId }: { companyId: string }) {
  const { items, loading, error, load } = useChild<TechRow>(() => getCompanyTech(companyId), [companyId]);

  // 分類分組：category（trim 後空 → 「其他」）→ 該分類的技術列；分類名按字母序。
  const groups = useMemo(() => {
    const map = new Map<string, TechRow[]>();
    for (const t of items) {
      const cat = t.category?.trim() || "其他";
      const arr = map.get(cat);
      if (arr) arr.push(t);
      else map.set(cat, [t]);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  return (
    <div className="mc-tabpane">
      <h3 className="mc-tabpane__title">技術棧</h3>
      <StateBoundary
        loading={loading}
        error={error}
        isEmpty={items.length === 0}
        onRetry={load}
        emptyTitle="尚無技術棧資料"
        emptyHint="用研究引擎偵測（BuiltWith 風）。"
      >
        <div className="mc-techstack">
          {groups.map(([cat, rows]) => (
            <section key={cat} className="mc-techstack__group">
              <div className="mc-techstack__cat">{cat}</div>
              <ul className="mc-techstack__list">
                {rows.map((t) => (
                  <li
                    key={t.id}
                    className="mc-techstack__item"
                    title={t.detectedFrom ? `偵測來源：${t.detectedFrom}` : undefined}
                  >
                    <div className="mc-techstack__main">
                      <span className="mc-techstack__name">{t.product ?? t.vendor ?? "未知"}</span>
                      {t.noteZh ? <span className="mc-techstack__note">{t.noteZh}</span> : null}
                    </div>
                    <ConfidenceBadge value={t.confidence} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </StateBoundary>
    </div>
  );
}

export function DepartmentsTab({ companyId }: { companyId: string }) {
  const { items, loading, error, load } = useChild<CompanyDepartment>(
    () => getCompanyDepartments(companyId),
    [companyId],
  );
  return (
    <div className="mc-tabpane">
      <h3 className="mc-tabpane__title">部門</h3>
      <StateBoundary
        loading={loading}
        error={error}
        isEmpty={items.length === 0}
        onRetry={load}
        emptyTitle="尚無部門資料"
        emptyHint="用研究引擎推估組織結構。"
      >
        <ul className="mc-deptlist">
          {items.map((d) => (
            <li key={d.id} className="mc-deptitem">
              <span className="mc-deptitem__name">{d.name}</span>
              {d.focus ? <span className="mc-deptitem__focus">{d.focus}</span> : null}
              {d.headcountEstimate !== undefined ? (
                <span className="mc-deptitem__hc">約 {fmtNumber(d.headcountEstimate)} 人</span>
              ) : null}
              <ConfidenceBadge value={d.confidence} />
            </li>
          ))}
        </ul>
      </StateBoundary>
    </div>
  );
}

const STAGE_LABEL: Record<DealStage, string> = {
  prospect: "潛在",
  discovery: "探索",
  demo: "展示",
  proposal: "提案",
  negotiation: "議約",
  closed_won: "成交",
  closed_lost: "失單",
};
const STAGE_TONE: Record<DealStage, "muted" | "info" | "accent" | "ok" | "danger" | "warn"> = {
  prospect: "muted",
  discovery: "info",
  demo: "info",
  proposal: "accent",
  negotiation: "warn",
  closed_won: "ok",
  closed_lost: "danger",
};

export function DealsTab({ companyId }: { companyId: string }) {
  const { items, loading, error, load } = useChild<Deal>(() => listDeals(companyId).then((r) => r.items), [companyId]);
  return (
    <div className="mc-tabpane">
      <h3 className="mc-tabpane__title">商機</h3>
      <StateBoundary
        loading={loading}
        error={error}
        isEmpty={items.length === 0}
        onRetry={load}
        emptyTitle="尚無商機"
        emptyHint="建立商機以追蹤採購委員會與階段。"
      >
        <ul className="mc-deallist">
          {items.map((d) => (
            <li key={d.id} className="mc-dealitem">
              <span className="mc-dealitem__name">{d.name}</span>
              <StatusBadge tone={STAGE_TONE[d.stage]}>{STAGE_LABEL[d.stage]}</StatusBadge>
              {d.amount !== undefined ? (
                <span className="mc-dealitem__amt">
                  {d.currency ?? ""} {fmtNumber(d.amount)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </StateBoundary>
    </div>
  );
}
