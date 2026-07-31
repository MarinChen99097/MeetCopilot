"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "next-intl";
import type { Company } from "@meetcopilot/shared";
import { ApiError, getCompany, updateCompany, type CompanyDetail } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import { Link, useRouter } from "@/i18n/navigation";
import { StateBoundary } from "@/components/ui/StateBoundary";
import { AccountStatusBadge, VerifiedBadge } from "@/components/ui/StatusBadge";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";
import { EnrichPanel } from "./EnrichPanel";
import { ProvenanceField } from "./ProvenanceField";
import { useEntityProvenance } from "./useProvenance";
import { ContactsTab } from "./ContactsTab";
import { ProductsTab } from "./ProductsTab";
import { NewsTab, TechTab, DepartmentsTab, DealsTab } from "./ChildTabs";
import { SocialTab } from "./SocialTab";
import { NotesTab } from "./NotesTab";

type TabKey =
  | "overview"
  | "contacts"
  | "products"
  | "news"
  | "tech"
  | "social"
  | "departments"
  | "deals"
  | "notes";
const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "總覽" },
  { key: "contacts", label: "人物" },
  { key: "products", label: "產品深檔" },
  { key: "news", label: "新聞" },
  { key: "tech", label: "技術棧" },
  { key: "social", label: "社群" },
  { key: "departments", label: "部門" },
  { key: "deals", label: "商機" },
  { key: "notes", label: "筆記" },
];

/** /crm/[id] 公司詳情：公司頭 ＋ counts ＋ tabs ＋ enrich。
 *  initialTab/initialContactId＝自 /train「補齊後可對練」深連結（?tab=contacts&contact=<id>），
 *  由 Server Component 的 searchParams 傳入：開對應分頁並自動展開該主管。 */
export function CompanyDetailView({
  companyId,
  initialTab,
  initialContactId,
}: {
  companyId: string;
  initialTab?: string;
  initialContactId?: string;
}) {
  const router = useRouter();
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>(
    TABS.some((t) => t.key === initialTab) ? (initialTab as TabKey) : "overview",
  );

  // silent＝背景刷新（研究完成後）：不進 loading，避免整頁換骨架、EnrichPanel 被卸載而完成卡消失（P2-7）。
  const load = useCallback((opts?: { silent?: boolean }) => {
    let alive = true;
    if (!opts?.silent) setLoading(true);
    setError(null);
    getCompany(companyId)
      .then((c) => {
        if (!alive) return;
        setCompany(c);
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

  return (
    <main className="mc-detail">
      <button type="button" className="mc-detail__back" onClick={() => router.push("/crm")}>
        ← 返回公司清單
      </button>

      <StateBoundary loading={loading} error={error} onRetry={load} skeleton={<DetailSkeleton />}>
        {company ? (
          <>
            <CompanyHead company={company} onEnriched={() => load({ silent: true })} />

            <nav className="mc-tabs" role="tablist" aria-label="公司詳情分頁">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  className={`mc-tab ${tab === t.key ? "is-active" : ""}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                  {t.key === "contacts" ? <Count n={company.counts.contacts} /> : null}
                  {t.key === "products" ? <Count n={company.counts.products} /> : null}
                  {t.key === "news" ? <Count n={company.counts.news} /> : null}
                  {t.key === "deals" ? <Count n={company.counts.deals} /> : null}
                </button>
              ))}
            </nav>

            <section className="mc-tabbody" role="tabpanel">
              {tab === "overview" ? <OverviewTab company={company} onChanged={load} /> : null}
              {tab === "contacts" ? (
                <ContactsTab companyId={companyId} initialContactId={initialContactId} />
              ) : null}
              {tab === "products" ? <ProductsTab companyId={companyId} /> : null}
              {tab === "news" ? <NewsTab companyId={companyId} /> : null}
              {tab === "tech" ? <TechTab companyId={companyId} /> : null}
              {tab === "social" ? <SocialTab companyId={companyId} /> : null}
              {tab === "departments" ? <DepartmentsTab companyId={companyId} /> : null}
              {tab === "deals" ? <DealsTab companyId={companyId} /> : null}
              {tab === "notes" ? <NotesTab companyId={companyId} /> : null}
            </section>
          </>
        ) : null}
      </StateBoundary>
    </main>
  );
}

function CompanyHead({ company, onEnriched }: { company: CompanyDetail; onEnriched: () => void }) {
  return (
    <header className="mc-companyhead">
      <div className="mc-companyhead__id">
        <span className="mc-logo mc-logo--lg" aria-hidden="true">
          {company.logoUrl ? <img src={company.logoUrl} alt="" /> : company.name.slice(0, 2).toUpperCase()}
        </span>
        <div>
          <h1 className="mc-companyhead__name">{company.name}</h1>
          <p className="mc-companyhead__meta">
            {company.domain ? (
              <a href={`https://${company.domain}`} target="_blank" rel="noreferrer noopener">
                {company.domain}
              </a>
            ) : null}
            {company.industryZh ?? company.industry ? (
              <span> · {company.industryZh ?? company.industry}</span>
            ) : null}
          </p>
          <div className="mc-companyhead__badges">
            <AccountStatusBadge status={company.accountStatus} />
            <VerifiedBadge status={company.verifiedStatus} />
            <ConfidenceBadge value={company.crawlConfidence} />
          </div>
        </div>
      </div>

      <div className="mc-companyhead__side">
        <dl className="mc-counts">
          <CountStat label="主管" n={company.counts.contacts} />
          <CountStat label="產品" n={company.counts.products} />
          <CountStat label="新聞" n={company.counts.news} />
          <CountStat label="商機" n={company.counts.deals} />
        </dl>
        <EnrichPanel targetType="company" targetId={company.id} onDone={onEnriched} />
        {/* 設計稿 §B7 差異 6：從客戶資料直接進會的入口（現況沒有這條路）。 */}
        <Link href="/copilot" className="mc-btn mc-btn--primary mc-btn--sm">
          開會時用這份資料
        </Link>
      </div>
    </header>
  );
}

function OverviewTab({ company, onChanged }: { company: CompanyDetail; onChanged: () => void }) {
  const isZh = useLocale() === "zh-TW";
  const prov = useEntityProvenance(
    "company",
    company.id,
    (id, patch) => updateCompany(id, patch as Partial<Company>),
    onChanged,
  );

  // rawValue（可選）＝細填時編輯的底稿：*Zh 欄以繁中 gloss 顯示（value），但編輯錨定來源主要欄
  // （rawValue＝來源值），保住雙語不變量「繁中 gloss 不覆寫主要欄」。省略時回退為 value。
  const field = (label: string, fieldName: keyof Company, value: string, rawValue?: string) => (
    <ProvenanceField
      label={label}
      fieldName={fieldName}
      value={value}
      rawValue={rawValue ?? (value === "—" ? "" : value)}
      prov={prov.provMap[fieldName]}
      busyConfirm={prov.busyConfirm.has(fieldName)}
      busySave={prov.busySave.has(fieldName)}
      onConfirm={prov.confirm}
      onSave={prov.save}
    />
  );

  return (
    <div className="mc-tabpane">
      <h3 className="mc-tabpane__title">總覽</h3>
      {company.description ? <p className="mc-overview__desc">{company.description}</p> : null}
      {isZh && company.descriptionZh ? (
        <p className="mc-i18n-sum">
          <span className="mc-i18n-sum__label">🌐 中文簡介</span>
          {company.descriptionZh}
        </p>
      ) : null}
      <div className="mc-overview__fields">
        {field("標語", "tagline", company.taglineZh ?? company.tagline ?? "—", company.tagline ?? "")}
        {field("產業", "industry", company.industryZh ?? company.industry ?? "—", company.industry ?? "")}
        {field(
          "商業模式",
          "businessModel",
          company.businessModelZh ?? company.businessModel ?? "—",
          company.businessModel ?? "",
        )}
        {field("員工規模", "employeeRange", company.employeeRange ?? "—")}
        {field("成立年份", "foundedYear", company.foundedYear ? String(company.foundedYear) : "—")}
        {field("總部城市", "hqCity", company.hqCity ?? "—")}
        {field("總部國家", "hqCountry", company.hqCountry ?? "—")}
        {field("官網", "websiteUrl", company.websiteUrl ?? "—")}
        {field("營收級距", "revenueRange", company.revenueRange ?? "—")}
        {field("募資階段", "fundingStage", company.fundingStage ?? "—")}
        {field(
          "募資總額",
          "fundingTotal",
          company.fundingTotal !== undefined ? fmtNumber(company.fundingTotal) : "—",
        )}
      </div>

      <ChipRow title="痛點" items={company.painPoints} tone="warn" />
      <ChipRow title="策略計畫" items={company.strategicInitiatives} tone="info" />
      <ChipRow title="採購觸發" items={company.buyingTriggers} tone="accent" />
      <ChipRow title="現有廠商" items={company.currentVendors} tone="muted" />
    </div>
  );
}

function ChipRow({ title, items, tone }: { title: string; items?: string[]; tone: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mc-chipblock">
      <div className="mc-chipblock__title">{title}</div>
      <div className="mc-chips">
        {items.map((it, i) => (
          <span key={i} className={`mc-chip mc-chip--${tone}`}>
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="mc-tab__count">{n}</span>;
}
function CountStat({ label, n }: { label: string; n: number }) {
  return (
    <div className="mc-counts__item">
      <dt>{label}</dt>
      <dd>{fmtNumber(n)}</dd>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mc-skel" aria-hidden="true">
      <div className="mc-skel__line" style={{ width: "40%", height: 28 }} />
      <div className="mc-skel__line" style={{ width: "70%" }} />
      <div className="mc-skel__line" style={{ width: "55%" }} />
      <div className="mc-skel__line" style={{ width: "85%" }} />
    </div>
  );
}
