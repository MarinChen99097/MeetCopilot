/**
 * BarChart — 自繪 CSS 長條圖（/usage 聚合列的視覺化）。不引圖表庫。
 * 水平長條（適合較多類別＋長標籤）。value 依 max 正規化寬度。
 */
export interface BarDatum {
  label: string;
  value: number;
}

export function BarChart({
  data,
  valueFormat = (v) => String(v),
  maxRows = 12,
}: {
  data: BarDatum[];
  valueFormat?: (v: number) => string;
  maxRows?: number;
}) {
  const rows = data.filter((d) => Number.isFinite(d.value)).slice(0, maxRows);
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((d) => Math.abs(d.value)), 1);

  return (
    <div className="ad-barchart">
      {rows.map((d, i) => (
        <div key={i} className="ad-barchart__row">
          <div className="ad-barchart__label" title={d.label}>
            {d.label}
          </div>
          <div className="ad-barchart__track">
            <div
              className="ad-barchart__bar"
              style={{ width: `${Math.max((Math.abs(d.value) / max) * 100, 1)}%` }}
            />
          </div>
          <div className="ad-barchart__val">{valueFormat(d.value)}</div>
        </div>
      ))}
    </div>
  );
}
