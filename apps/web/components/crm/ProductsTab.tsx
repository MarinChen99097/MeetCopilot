"use client";

import { useCallback, useEffect, useState, type SyntheticEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { CompanyProduct, JsonObject, ProductFeature, ProductPersonLink } from "@meetcopilot/shared";
import { ApiError, getProduct, getProductPeople, listProducts, updateProduct } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import { StateBoundary } from "@/components/ui/StateBoundary";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";
import { VerifiedBadge } from "@/components/ui/StatusBadge";
import { ProvenanceField } from "./ProvenanceField";
import { useEntityProvenance } from "./useProvenance";

/** 圖片載入失敗時隱藏其容器（縮圖/產品圖的 onError；防破圖佔位）。 */
function hideImageParent(e: SyntheticEvent<HTMLImageElement>) {
  const parent = e.currentTarget.parentElement;
  if (parent) parent.style.display = "none";
}

/** specs（JsonObject）值轉可讀字串：原始字串/數字/布林直出，陣列 join，其餘 JSON.stringify。 */
function fmtSpecValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(fmtSpecValue).join(", ");
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** 產品深檔 tab：對方產品清單 → 點開規格/定價/技術棧/功能/整合＋產品↔人。 */
export function ProductsTab({ companyId }: { companyId: string }) {
  const t = useTranslations("productsTab");
  const isZh = useLocale() === "zh-TW";
  const [items, setItems] = useState<CompanyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    listProducts(companyId)
      .then((rows) => {
        if (!alive) return;
        setItems(rows);
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof ApiError ? err.message : t("loadError"));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [companyId, t]);

  useEffect(() => load(), [load]);

  return (
    <div className="mc-tabpane">
      <h3 className="mc-tabpane__title">{t("title")}</h3>
      <StateBoundary
        loading={loading}
        error={error}
        isEmpty={items.length === 0}
        onRetry={load}
        emptyTitle={t("emptyTitle")}
        emptyHint={t("emptyHint")}
      >
        <ul className="mc-productlist">
          {items.map((p) => {
            // zh-TW: prefer Chinese one-liner; keep original as hover title.
            const oneLine = isZh && p.oneLinerZh ? p.oneLinerZh : p.oneLiner;
            const thumb = p.mediaUrls?.[0];
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className={`mc-productrow ${selected === p.id ? "is-open" : ""}`}
                  onClick={() => setSelected(selected === p.id ? null : p.id)}
                  aria-expanded={selected === p.id}
                >
                  {thumb ? (
                    <span className="mc-productrow__thumb" aria-hidden="true">
                      <img src={thumb} alt="" loading="lazy" onError={hideImageParent} />
                    </span>
                  ) : null}
                  <span className="mc-productrow__namegroup">
                    <span className="mc-productrow__name">{p.name}</span>
                    {p.model ? <span className="mc-productrow__model">{p.model}</span> : null}
                  </span>
                  <span
                    className="mc-productrow__meta"
                    title={isZh && p.oneLinerZh && p.oneLiner ? p.oneLiner : undefined}
                  >
                    {p.category ?? t("uncategorized")}
                    {oneLine ? ` · ${oneLine}` : ""}
                  </span>
                  <span className="mc-productrow__badges">
                    <ConfidenceBadge value={p.crawlConfidence} />
                    <VerifiedBadge status={p.verifiedStatus} />
                  </span>
                </button>
                {selected === p.id ? <ProductProfile productId={p.id} onChanged={load} /> : null}
              </li>
            );
          })}
        </ul>
      </StateBoundary>
    </div>
  );
}

function ProductProfile({ productId, onChanged }: { productId: string; onChanged: () => void }) {
  const t = useTranslations("productsTab");
  const isZh = useLocale() === "zh-TW";
  const [product, setProduct] = useState<CompanyProduct | null>(null);
  const [people, setPeople] = useState<ProductPersonLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([getProduct(productId), getProductPeople(productId).catch(() => [] as ProductPersonLink[])])
      .then(([p, pl]) => {
        if (!alive) return;
        setProduct(p);
        setPeople(pl);
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof ApiError ? err.message : t("loadError"));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [productId, t]);

  useEffect(() => load(), [load]);

  const prov = useEntityProvenance(
    "company_product",
    productId,
    (id, patch) => updateProduct(id, patch as Partial<CompanyProduct>),
    () => {
      load();
      onChanged();
    },
  );

  const field = (label: string, fieldName: keyof CompanyProduct, value: string) => (
    <ProvenanceField
      label={label}
      fieldName={fieldName}
      value={value}
      rawValue={value === "—" ? "" : value}
      prov={prov.provMap[fieldName]}
      busyConfirm={prov.busyConfirm.has(fieldName)}
      busySave={prov.busySave.has(fieldName)}
      onConfirm={prov.confirm}
      onSave={prov.save}
    />
  );

  // zh-TW: prefer Chinese one-liner as the detail headline; else source-language one-liner.
  let oneLiner: string | undefined;
  if (product) oneLiner = isZh && product.oneLinerZh ? product.oneLinerZh : product.oneLiner;

  return (
    <div className="mc-product-detail">
      <StateBoundary loading={loading} error={error} onRetry={load}>
        {product ? (
          <>
            {product.mediaUrls?.[0] ? (
              <div className="mc-product-detail__media">
                <img src={product.mediaUrls[0]} alt="" loading="lazy" onError={hideImageParent} />
              </div>
            ) : null}

            {oneLiner ? <p className="mc-product-detail__oneliner">{oneLiner}</p> : null}

            <div className="mc-product-detail__fields">
              {field(t("category"), "category", product.category ?? "—")}
              {field(t("model"), "model", product.model ?? "—")}
              {field(t("status"), "status", product.status ?? "—")}
              {field(t("pricingModel"), "pricingModel", product.pricingModel ?? "—")}
              {field(
                t("priceFrom"),
                "priceFrom",
                product.priceFrom !== undefined ? `${product.currency ?? ""} ${fmtNumber(product.priceFrom)}` : "—",
              )}
              {field(t("pricingNotes"), "pricingNotes", product.pricingNotes ?? "—")}
              {field(t("targetMarket"), "targetMarket", product.targetMarket ?? "—")}
            </div>

            {product.productUrl || product.docsUrl ? (
              <div className="mc-product-detail__links">
                {product.productUrl ? (
                  <a
                    className="mc-extlink"
                    href={product.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("productLink")} ↗
                  </a>
                ) : null}
                {product.docsUrl ? (
                  <a className="mc-extlink" href={product.docsUrl} target="_blank" rel="noopener noreferrer">
                    {t("docsLink")} ↗
                  </a>
                ) : null}
              </div>
            ) : null}

            {product.description ? <p className="mc-product-detail__desc">{product.description}</p> : null}
            {isZh && product.descriptionZh ? (
              <p className="mc-i18n-sum">
                <span className="mc-i18n-sum__label">{t("zhSummary")}</span>
                {product.descriptionZh}
              </p>
            ) : null}

            <FeatureList title={t("keyFeatures")} items={product.keyFeatures} />
            <SpecTable title={t("specs")} specs={product.specs} />
            <ListBlock title={t("techStack")} items={product.techStack} tone="info" />
            <ListBlock title={t("integrations")} items={product.integrations} tone="muted" />
            <ListBlock title={t("targetPersonas")} items={product.targetPersonas} tone="accent" />
            <ListBlock title={t("differentiators")} items={product.differentiators} tone="ok" />
            <ListBlock title={t("competitors")} items={product.competitors} tone="warn" />
            <ListBlock title={t("knownIssues")} items={product.knownIssues} tone="warn" />

            <div className="mc-chipblock">
              <div className="mc-chipblock__title">{t("peopleTitle")}</div>
              {people.length > 0 ? (
                <ul className="mc-productpeople">
                  {people.map((pl, i) => (
                    <li key={i}>
                      <span className="mc-productpeople__name">{pl.contact.fullName}</span>
                      <span className="mc-badge mc-badge--info">{pl.role}</span>
                      {pl.titleOnProduct ? (
                        <span className="mc-productpeople__title">{pl.titleOnProduct}</span>
                      ) : null}
                      <ConfidenceBadge value={pl.confidence} />
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="mc-chipblock__empty">{t("peopleEmpty")}</span>
              )}
            </div>
          </>
        ) : null}
      </StateBoundary>
    </div>
  );
}

/** 關鍵功能：名稱主行＋ detail/benefit 副行（有值才顯示；benefit 以 ✓ 標示價值點）。 */
function FeatureList({ title, items }: { title: string; items?: ProductFeature[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mc-chipblock">
      <div className="mc-chipblock__title">{title}</div>
      <ul className="mc-featurelist">
        {items.map((f, i) => (
          <li key={i} className="mc-featurelist__item">
            <span className="mc-featurelist__name">{f.name}</span>
            {f.detail ? <span className="mc-featurelist__detail">{f.detail}</span> : null}
            {f.benefit ? <span className="mc-featurelist__benefit">✓ {f.benefit}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 產品規格：key-value 表格（specs JsonObject；空值/空物件不 render）。 */
function SpecTable({ title, specs }: { title: string; specs?: JsonObject }) {
  const entries = specs
    ? Object.entries(specs).filter(([, v]) => v !== null && v !== undefined && v !== "")
    : [];
  if (entries.length === 0) return null;
  return (
    <div className="mc-chipblock">
      <div className="mc-chipblock__title">{title}</div>
      <div className="mc-spectable__wrap">
        <table className="mc-spectable">
          <tbody>
            {entries.map(([k, v]) => (
              <tr key={k}>
                <th scope="row">{k}</th>
                <td>{fmtSpecValue(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ListBlock({ title, items, tone }: { title: string; items?: string[]; tone: string }) {
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
