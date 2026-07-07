/** Small presentational formatters (epoch ms → zh-TW strings). Pure, client/server safe. */

export function fmtDate(ms?: number): string {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return "—";
  }
}

export function fmtDateTime(ms?: number): string {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

/** "3 天前 / 2 小時前"; falls back to date for older. */
export function fmtRelative(ms?: number): string {
  if (!ms) return "從未";
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "剛剛";
  if (min < 60) return `${min} 分鐘前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小時前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return fmtDate(ms);
}

export function fmtNumber(n?: number): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return n.toLocaleString("zh-TW");
}
