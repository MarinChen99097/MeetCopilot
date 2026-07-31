"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { AccountStatus, CompanySummary } from "@meetcopilot/shared";
import { ApiError, createCompany, listCompanies } from "@/lib/api";
import { fmtRelative } from "@/lib/format";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { StateBoundary } from "@/components/ui/StateBoundary";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";

const PAGE_SIZE = 20;

/** 進度篩選：值＝後端 accountStatus，標籤走 i18n 的口語文案（還沒聊過／談到一半／已成交／沒下文了）。 */
const STATUS_FILTERS: { value: AccountStatus | ""; key: string }[] = [
  { value: "", key: "crm.filterAll" },
  { value: "prospect", key: "crm.statusProspect" },
  { value: "active", key: "crm.statusActive" },
  { value: "customer", key: "crm.statusCustomer" },
  { value: "churned", key: "crm.statusChurned" },
];

/**
 * /crm 公司清單（2026-07-30 重設計，INVENTORY §B6）：卡片牆 → **6 欄表格**、
 * `<select>` 篩選 → 帶狀態的 chip 列、可信度 badge → 進度條＋百分比。
 *
 * **刻意沒做的兩欄**：設計稿的「誰做決定」「下次見面」在後端無資料
 * （`CompanySummary` 不含 contacts、也沒有 meetings repo——INVENTORY §D1），
 * 契約規定不渲染假欄位 → 版位讓給既有真資料「產業」。
 * 篩選 chip 的計數同理（無 facet count API）→ 不顯示數字。
 * **保留**設計稿沒畫但既有的能力：分頁、＋新增客戶展開表單、載入/錯誤/空三態。
 */
export function CompanyListView() {
  const t = useTranslations();
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
      <header className="mc-pagehead">
        <div className="mc-pagehead__id">
          <span className="mc-kicker mc-kicker--page">{t("crm.kicker")}</span>
          <h1 className="mc-pagehead__h1">{t("crm.headline", { count: total })}</h1>
        </div>
        <div className="mc-pagehead__acts">
          <button type="button" className="mc-btn mc-btn--primary" onClick={() => setShowForm((s) => !s)}>
            {t("crm.addCompany")}
          </button>
        </div>
      </header>

      {showForm ? (
        <NewCompanyForm
          onCreated={(id) => {
            toast.push({ kind: "success", message: t("crm.createdToast") });
            router.push(`/crm/${id}`);
          }}
          onError={(m) => toast.push({ kind: "error", message: m })}
          onClose={() => setShowForm(false)}
        />
      ) : null}

      <div className="mc-filterbar">
        <input
          className="mc-input mc-filterbar__search"
          placeholder={t("crm.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t("crm.searchLabel")}
        />
        <div className="mc-chipfilters" role="group" aria-label={t("crm.filterLabel")}>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value || "all"}
              type="button"
              className={`mc-chipfilter${status === f.value ? " is-on" : ""}`}
              aria-pressed={status === f.value}
              onClick={() => setStatus(f.value)}
            >
              {t(f.key)}
            </button>
          ))}
        </div>
      </div>

      <StateBoundary
        loading={loading}
        error={error}
        isEmpty={items.length === 0}
        onRetry={load}
        skeleton={<ListSkeleton />}
        emptyTitle={debounced || status ? t("crm.emptyFilteredTitle") : t("crm.emptyTitle")}
        emptyHint={debounced || status ? t("crm.emptyFilteredHint") : t("crm.emptyHint")}
        emptyAction={
          !debounced && !status ? (
            <button type="button" className="mc-btn mc-btn--primary" onClick={() => setShowForm(true)}>
              {t("crm.addFirstCompany")}
            </button>
          ) : undefined
        }
      >
        <div className="mc-table">
          <div className="mc-table__scroll">
            <div className="mc-table__head mc-crmrow" role="row">
              <span>{t("crm.colCompany")}</span>
              <span>{t("crm.colStatus")}</span>
              <span>{t("crm.colIndustry")}</span>
              <span>{t("crm.colCrawled")}</span>
              <span>{t("crm.colConfidence")}</span>
            </div>
            {items.map((c) => (
              <button
                key={c.id}
                type="button"
                className="mc-table__row mc-crmrow"
                onClick={() => router.push(`/crm/${c.id}`)}
              >
                <span className="mc-crmrow__id">
                  <span className="mc-avatar" aria-hidden="true">
                    {c.logoUrl ? <img src={c.logoUrl} alt="" /> : initials(c.name)}
                  </span>
                  <span className="mc-crmrow__names">
                    <span className="mc-crmrow__name">{c.name}</span>
                    <span className="mc-crmrow__domain mc-mono">{c.domain ?? "—"}</span>
                  </span>
                </span>
                <span className={`mc-statustag mc-statustag--${c.accountStatus ?? "prospect"}`}>
                  {t(statusKey(c.accountStatus))}
                </span>
                <span className="mc-crmrow__industry">{c.industry ?? "—"}</span>
                <span className="mc-crmrow__crawled mc-mono">{fmtRelative(c.lastCrawledAt)}</span>
                <ConfidenceMeter value={c.crawlConfidence} />
              </button>
            ))}
          </div>
        </div>

        {totalPages > 1 ? (
          <nav className="mc-pager" aria-label={t("crm.pagerLabel")}>
            <button
              type="button"
              className="mc-btn mc-btn--ghost mc-btn--sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t("crm.prevPage")}
            </button>
            <span className="mc-pager__at mc-mono">
              {page} / {totalPages} · {total}
            </span>
            <button
              type="button"
              className="mc-btn mc-btn--ghost mc-btn--sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              {t("crm.nextPage")}
            </button>
          </nav>
        ) : null}
      </StateBoundary>
    </main>
  );
}

function statusKey(status: AccountStatus | undefined): string {
  switch (status) {
    case "active":
      return "crm.statusActive";
    case "customer":
      return "crm.statusCustomer";
    case "churned":
      return "crm.statusChurned";
    default:
      return "crm.statusProspect";
  }
}

/** 可信度：5px 進度條＋mono 百分比（≥75 綠／≥50 warn／<50 live），沒有值就留白不編數字。 */
function ConfidenceMeter({ value }: { value?: number }) {
  if (typeof value !== "number") {
    return <span className="mc-crmrow__conf mc-mono">—</span>;
  }
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const tone = pct >= 75 ? "ok" : pct >= 50 ? "warn" : "live";
  return (
    <span className="mc-crmrow__conf">
      <span className={`mc-bar mc-bar--${tone}`}>
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="mc-mono">{pct}%</span>
    </span>
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
  const t = useTranslations();
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
          <span>{t("crm.fieldName")}</span>
          <input
            id="newco-name"
            name="newco-name"
            className="mc-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Acme Inc."
          />
        </label>
        <label className="mc-field">
          <span>{t("crm.fieldDomain")}</span>
          <input
            id="newco-domain"
            name="newco-domain"
            className="mc-input"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="acme.com"
          />
        </label>
        <label className="mc-field">
          <span>{t("crm.fieldWebsite")}</span>
          <input
            id="newco-website"
            name="newco-website"
            className="mc-input"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://acme.com"
          />
        </label>
      </div>
      <div className="mc-newco__actions">
        <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={onClose}>
          {t("crm.cancel")}
        </button>
        <button type="submit" className="mc-btn mc-btn--primary mc-btn--sm" disabled={busy || !name.trim()}>
          {busy ? <Spinner size={14} /> : t("crm.create")}
        </button>
      </div>
    </form>
  );
}

function ListSkeleton() {
  return (
    <div className="mc-table" aria-hidden="true">
      <div className="mc-table__scroll">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="mc-table__row mc-crmrow">
            <div className="mc-skel__line" style={{ width: "70%" }} />
            <div className="mc-skel__line" style={{ width: "60%" }} />
            <div className="mc-skel__line" style={{ width: "50%" }} />
            <div className="mc-skel__line" style={{ width: "60%" }} />
            <div className="mc-skel__line" style={{ width: "80%" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmptyHint() {
  return <EmptyState title="尚無資料" />;
}

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}
