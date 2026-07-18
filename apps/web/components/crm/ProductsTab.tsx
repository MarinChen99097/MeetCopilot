"use client";

import { useCallback, useEffect, useState, type SyntheticEvent } from "react";
import { useLocale } from "next-intl";
import type { CompanyProduct, ProductPersonLink } from "@meetcopilot/shared";
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

/** 產品深檔 tab：對方產品清單 → 點開規格/定價/技術棧/功能/整合＋產品↔人。 */
export function ProductsTab({ companyId }: { companyId: string }) {
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
        setError(err instanceof ApiError ? err.message : "載入失敗");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [companyId]);

  useEffect(() => load(), [load]);

  return (
    <div className="mc-tabpane">
      <h3 className="mc-tabpane__title">對方產品深檔</h3>
      <StateBoundary
        loading={loading}
        error={error}
        isEmpty={items.length === 0}
        onRetry={load}
        emptyTitle="尚無產品資料"
        emptyHint="用研究引擎爬對方產品頁補齊深檔。"
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
                    {p.category ?? "未分類"}
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
        setError(err instanceof ApiError ? err.message : "載入失敗");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [productId]);

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
            <div className="mc-product-detail__fields">
              {field("類別", "category", product.category ?? "—")}
              {field("型號", "model", product.model ?? "—")}
              {field("狀態", "status", product.status ?? "—")}
              {field("定價模式", "pricingModel", product.pricingModel ?? "—")}
              {field(
                "起始價",
                "priceFrom",
                product.priceFrom !== undefined ? `${product.currency ?? ""} ${fmtNumber(product.priceFrom)}` : "—",
              )}
              {field("目標市場", "targetMarket", product.targetMarket ?? "—")}
            </div>

            {product.description ? <p className="mc-product-detail__desc">{product.description}</p> : null}
            {isZh && product.descriptionZh ? (
              <p className="mc-i18n-sum">
                <span className="mc-i18n-sum__label">🌐 中文簡介</span>
                {product.descriptionZh}
              </p>
            ) : null}

            <ListBlock title="關鍵功能" items={(product.keyFeatures ?? []).map((f) => f.name)} tone="accent" />
            <ListBlock title="技術棧" items={product.techStack} tone="info" />
            <ListBlock title="整合" items={product.integrations} tone="muted" />
            <ListBlock title="差異化" items={product.differentiators} tone="ok" />
            <ListBlock title="已知問題" items={product.knownIssues} tone="warn" />

            <div className="mc-chipblock">
              <div className="mc-chipblock__title">產品 ↔ 人（developer / PM / owner…）</div>
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
                <span className="mc-chipblock__empty">尚未建立關聯</span>
              )}
            </div>
          </>
        ) : null}
      </StateBoundary>
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
