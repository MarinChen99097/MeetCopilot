"use client";

import { useCallback, useEffect, useState } from "react";
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
                </span>
                {n.category ? <StatusBadge tone="info">{n.category}</StatusBadge> : null}
              </div>
              <div className="mc-newsitem__meta">
                {n.source ?? "來源不明"} · {fmtDate(n.publishedAt)}
              </div>
              {n.summary ? <p className="mc-newsitem__sum">{n.summary}</p> : null}
            </li>
          ))}
        </ul>
      </StateBoundary>
    </div>
  );
}

export function TechTab({ companyId }: { companyId: string }) {
  const { items, loading, error, load } = useChild<CompanyTech>(() => getCompanyTech(companyId), [companyId]);
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
        <ul className="mc-techgrid">
          {items.map((t) => (
            <li key={t.id} className="mc-techitem">
              <span className="mc-techitem__cat">{t.category ?? "其他"}</span>
              <span className="mc-techitem__name">{t.product ?? t.vendor ?? "未知"}</span>
              <ConfidenceBadge value={t.confidence} />
            </li>
          ))}
        </ul>
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
