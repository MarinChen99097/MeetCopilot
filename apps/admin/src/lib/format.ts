/**
 * 小型 presentational formatters（epoch ms 或 ISO 字串 → zh-TW）。Pure、client/server 安全。
 * 時間戳容錯：契約未定 ms vs ISO，故一律接受 number | string 並嘗試解析（見 api-types.ts 時間戳假設）。
 */

type TimeInput = number | string | null | undefined;

function toDate(v: TimeInput): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = typeof v === "number" ? new Date(v) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(v: TimeInput): string {
  const d = toDate(v);
  if (!d) return "—";
  return d.toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function fmtDateTime(v: TimeInput): string {
  const d = toDate(v);
  if (!d) return "—";
  return d.toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 整數千分位。 */
export function fmtNumber(n?: number | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return n.toLocaleString("zh-TW");
}

/** 美元金額。小額顯示到 4 位（估算值常為 <$0.01）。 */
export function fmtUsd(n?: number | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const digits = abs > 0 && abs < 1 ? 4 : 2;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** token 大數精簡：1200 → 1.2K、3.4M。 */
export function fmtCompact(n?: number | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${trim(n / 1e9)}B`;
  if (abs >= 1e6) return `${trim(n / 1e6)}M`;
  if (abs >= 1e4) return `${trim(n / 1e3)}K`;
  return fmtNumber(n);
}
function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** 毫秒 → 人類可讀時長（排隊/耗時欄）。 */
export function fmtDuration(ms?: number | null): string {
  if (ms === undefined || ms === null || Number.isNaN(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${trim(s)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** 秒 → uptime（#9）。 */
export function fmtUptime(sec?: number | null): string {
  if (sec === undefined || sec === null || Number.isNaN(sec)) return "—";
  return fmtDuration(sec * 1000);
}
