"use client";

/**
 * DateRangePicker — 日期範圍選擇（/usage、/jobs 用）。純原生 <input type=date>。
 * 值＝UTC YYYY-MM-DD 字串（契約 usage day 用 UTC）。附常用快捷（7/30/90 天）。
 */
export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

/** 今天往前 n 天的 UTC YYYY-MM-DD 範圍（含今天）。 */
export function lastNDays(n: number): DateRange {
  const today = new Date();
  const to = ymdUtc(today);
  const fromDate = new Date(today);
  fromDate.setUTCDate(fromDate.getUTCDate() - (n - 1));
  return { from: ymdUtc(fromDate), to };
}

function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
}) {
  return (
    <div className="ad-daterange">
      <label className="ad-daterange__field">
        <span>起</span>
        <input
          type="date"
          value={value.from}
          max={value.to}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
        />
      </label>
      <span className="ad-daterange__sep">→</span>
      <label className="ad-daterange__field">
        <span>迄</span>
        <input
          type="date"
          value={value.to}
          min={value.from}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
        />
      </label>
      <div className="ad-daterange__quick">
        {[7, 30, 90].map((n) => (
          <button
            key={n}
            type="button"
            className="ad-btn ad-btn--ghost ad-btn--sm"
            onClick={() => onChange(lastNDays(n))}
          >
            近 {n} 天
          </button>
        ))}
      </div>
    </div>
  );
}
