/**
 * StackedBarChart — 自繪 CSS 堆疊長條圖（/jobs 頂部 14 日 job 狀態統計）。不引圖表庫。
 * 每日一根，四段（queued/running/done/failed）堆疊；固定配色對齊狀態語意。
 */
export interface StackedDay {
  date: string;
  queued: number;
  running: number;
  done: number;
  failed: number;
}

const SEGMENTS: { key: keyof Omit<StackedDay, "date">; label: string; color: string }[] = [
  { key: "done", label: "完成", color: "#12b886" },
  { key: "running", label: "執行中", color: "#3b6cf6" },
  { key: "queued", label: "排隊中", color: "#adb5bd" },
  { key: "failed", label: "失敗", color: "#e03131" },
];

export function StackedBarChart({ days }: { days: StackedDay[] }) {
  if (days.length === 0) return null;
  const max = Math.max(
    ...days.map((d) => d.queued + d.running + d.done + d.failed),
    1,
  );

  return (
    <div className="ad-stacked">
      <div className="ad-stacked__plot">
        {days.map((d, i) => {
          const total = d.queued + d.running + d.done + d.failed;
          return (
            <div key={i} className="ad-stacked__col" title={`${d.date}：共 ${total} 筆`}>
              <div className="ad-stacked__stack">
                {SEGMENTS.map((seg) => {
                  const v = d[seg.key];
                  if (!v) return null;
                  return (
                    <div
                      key={seg.key}
                      className="ad-stacked__seg"
                      style={{ height: `${(v / max) * 100}%`, background: seg.color }}
                      title={`${d.date} ${seg.label}：${v}`}
                    />
                  );
                })}
              </div>
              <div className="ad-stacked__xlabel">{shortDate(d.date)}</div>
            </div>
          );
        })}
      </div>
      <ul className="ad-stacked__legend">
        {SEGMENTS.map((seg) => (
          <li key={seg.key}>
            <span className="ad-stacked__swatch" style={{ background: seg.color }} />
            {seg.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** YYYY-MM-DD → MM/DD。 */
function shortDate(date: string): string {
  const parts = date.split("-");
  if (parts.length === 3) return `${parts[1]}/${parts[2]}`;
  return date;
}
