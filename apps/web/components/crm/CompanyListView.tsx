"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { AccountStatus, CompanySummary } from "@meetcopilot/shared";
import { ApiError, createCompany, listCompanies } from "@/lib/api";
import { fmtRelative } from "@/lib/format";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { StateBoundary } from "@/components/ui/StateBoundary";
import { EmptyState } from "@/components/ui/EmptyState";
import { AccountStatusBadge, VerifiedBadge } from "@/components/ui/StatusBadge";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";
import { Spinner } from "@/components/ui/Spinner";

const PAGE_SIZE = 20;
const STATUS_OPTIONS: { value: AccountStatus | ""; label: string }[] = [
  { value: "", label: "全部狀態" },
  { value: "prospect", label: "潛在客戶" },
  { value: "active", label: "洽談中" },
  { value: "customer", label: "既有客戶" },
  { value: "churned", label: "已流失" },
];

/** /crm 公司清單：搜尋 / 狀態篩選 / 分頁 / 新增；點卡片 → /crm/[id]。 */
export function CompanyListView() {
  const router = useRouter();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState<AccountStatus | "">("");
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<CompanySummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // debounce the search box
  useEffect(() => {
    const h = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(h);
  }, [query]);
  useEffect(() => {
    setPage(1);
  }, [debounced, status]);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    listCompanies({ query: debounced, status, page, pageSize: PAGE_SIZE })
      .then((res) => {
        if (!alive) return;
        setItems(res.items);
        setTotal(res.total);
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
  }, [debounced, status, page]);

  useEffect(() => load(), [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="mc-crm">
      <div className="mc-crm__header">
        <div>
          <h1 className="mc-crm__h1">CRM 公司</h1>
          <p className="mc-crm__lead">會前把對方公司、主管與產品建成可信檔案：爬蟲先填、你逐欄確認或細填。</p>
        </div>
        <button type="button" className="mc-btn mc-btn--primary" onClick={() => setShowForm((s) => !s)}>
          ＋ 新增公司
        </button>
      </div>

      {showForm ? (
        <NewCompanyForm
          onCreated={(id) => {
            toast.push({ kind: "success", message: "已建立公司，可開始研究此公司" });
            router.push(`/crm/${id}`);
          }}
          onError={(m) => toast.push({ kind: "error", message: m })}
          onClose={() => setShowForm(false)}
        />
      ) : null}

      <div className="mc-crm__controls">
        <input
          className="mc-input mc-crm__search"
          placeholder="搜尋公司名稱 / 網域…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="搜尋公司"
        />
        <select
          className="mc-input"
          value={status}
          onChange={(e) => setStatus(e.target.value as AccountStatus | "")}
          aria-label="依帳戶狀態篩選"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <StateBoundary
        loading={loading}
        error={error}
        isEmpty={items.length === 0}
        onRetry={load}
        skeleton={<ListSkeleton />}
        emptyTitle={debounced || status ? "沒有符合條件的公司" : "還沒有任何公司"}
        emptyHint={debounced || status ? "換個關鍵字或清除篩選。" : "新增第一家公司，讓研究引擎把欄位補齊。"}
        emptyAction={
          !debounced && !status ? (
            <button type="button" className="mc-btn mc-btn--primary" onClick={() => setShowForm(true)}>
              ＋ 新增第一家公司
            </button>
          ) : undefined
        }
      >
        <ul className="mc-companygrid">
          {items.map((c) => (
            <li key={c.id}>
              <button type="button" className="mc-companycard" onClick={() => router.push(`/crm/${c.id}`)}>
                <div className="mc-companycard__top">
                  <span className="mc-logo" aria-hidden="true">
                    {c.logoUrl ? <img src={c.logoUrl} alt="" /> : initials(c.name)}
                  </span>
                  <div className="mc-companycard__id">
                    <span className="mc-companycard__name">{c.name}</span>
                    <span className="mc-companycard__meta">
                      {c.industry ?? "未分類"}
                      {c.domain ? ` · ${c.domain}` : ""}
                    </span>
                  </div>
                </div>
                <div className="mc-companycard__badges">
                  <AccountStatusBadge status={c.accountStatus} />
                  <VerifiedBadge status={c.verifiedStatus} />
                  <ConfidenceBadge value={c.crawlConfidence} />
                </div>
                <div className="mc-companycard__foot">最後研究：{fmtRelative(c.lastCrawledAt)}</div>
              </button>
            </li>
          ))}
        </ul>

        {totalPages > 1 ? (
          <nav className="mc-pager" aria-label="分頁">
            <button
              type="button"
              className="mc-btn mc-btn--ghost mc-btn--sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一頁
            </button>
            <span className="mc-pager__at">
              第 {page} / {totalPages} 頁 · 共 {total} 家
            </span>
            <button
              type="button"
              className="mc-btn mc-btn--ghost mc-btn--sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              下一頁
            </button>
          </nav>
        ) : null}
      </StateBoundary>
    </main>
  );
}

function NewCompanyForm({
  onCreated,
  onError,
  onClose,
}: {
  onCreated: (id: string) => void;
  onError: (msg: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const company = await createCompany({
        name: name.trim(),
        domain: domain.trim() || undefined,
        websiteUrl: websiteUrl.trim() || undefined,
      });
      onCreated(company.id);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "建立失敗");
      setBusy(false);
    }
  }

  return (
    <form className="mc-newco" onSubmit={submit}>
      <div className="mc-newco__row">
        <label className="mc-field mc-field--grow">
          <span>公司名稱 *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="例：Acme Inc." />
        </label>
        <label className="mc-field">
          <span>網域</span>
          <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="acme.com" />
        </label>
        <label className="mc-field">
          <span>官網 URL</span>
          <input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://acme.com" />
        </label>
      </div>
      <div className="mc-newco__actions">
        <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={onClose}>
          取消
        </button>
        <button type="submit" className="mc-btn mc-btn--primary mc-btn--sm" disabled={busy || !name.trim()}>
          {busy ? <Spinner size={14} /> : "建立"}
        </button>
      </div>
    </form>
  );
}

function ListSkeleton() {
  return (
    <ul className="mc-companygrid" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i}>
          <div className="mc-companycard mc-companycard--skel">
            <div className="mc-skel__line" style={{ width: "70%" }} />
            <div className="mc-skel__line" style={{ width: "40%" }} />
            <div className="mc-skel__line" style={{ width: "55%" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function EmptyHint() {
  return <EmptyState title="尚無資料" />;
}

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}
