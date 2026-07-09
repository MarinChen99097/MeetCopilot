import type { ReactNode } from "react";
import { Sparkline } from "./charts/Sparkline";

/**
 * KpiCard — 總覽 KPI 卡：大數字 + 標籤 +（選用）副標 +（選用）inline-SVG sparkline。
 * 借 ezpage admin「模式」（ADMIN_CONTRACT §8）：KPI 卡含 sparkline，純 CSS＋自繪 SVG。
 */
export function KpiCard({
  label,
  value,
  sub,
  spark,
  tone = "accent",
  emphasis = false,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  spark?: number[];
  tone?: "accent" | "ok" | "danger" | "muted";
  /** 危險強調（例如 job 失敗數 > 0 或 not ready）。 */
  emphasis?: boolean;
}) {
  return (
    <div className={`ad-kpi ${emphasis ? "ad-kpi--emphasis" : ""}`}>
      <div className="ad-kpi__label">{label}</div>
      <div className="ad-kpi__value">{value}</div>
      {sub ? <div className="ad-kpi__sub">{sub}</div> : null}
      {spark && spark.length > 0 ? (
        <div className="ad-kpi__spark">
          <Sparkline data={spark} tone={tone} width={140} height={34} />
        </div>
      ) : null}
    </div>
  );
}
