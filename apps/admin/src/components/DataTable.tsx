"use client";

import { useMemo, useState, type ReactNode } from "react";

/**
 * DataTable — 共用表格（排序 + 分頁）。純 CSS，不引 TanStack（ADMIN_CONTRACT §8：借模式不借棧）。
 *
 * 排序：client-side，作用於傳入的 `rows`（對 server 分頁表＝當前頁內排序，屬預期行為）。
 * 分頁兩種模式：
 *  - client：傳 `pageSize` → 內部 slice + 頁碼狀態。
 *  - server：傳 `server`（total/offset/limit/onPage）→ 不 slice（parent 已取當頁），只渲染頁尾導航。
 */
export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  /** 提供則該欄可排序。 */
  sortValue?: (row: T) => string | number;
  align?: "left" | "right" | "center";
  width?: string;
}

interface ServerPagination {
  total: number;
  offset: number;
  limit: number;
  onPage: (offset: number) => void;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  pageSize,
  server,
  emptyText = "尚無資料",
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  server?: ServerPagination;
  emptyText?: string;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [clientPage, setClientPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    const sv = col.sortValue;
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = sv(a);
      const vb = sv(b);
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return copy;
  }, [rows, columns, sortKey, sortDir]);

  // client 分頁 slice（server 模式時不 slice）。
  const paged = useMemo(() => {
    if (server || !pageSize) return sorted;
    const start = clientPage * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, server, pageSize, clientPage]);

  function toggleSort(col: Column<T>) {
    if (!col.sortValue) return;
    if (sortKey === col.key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col.key);
      setSortDir("asc");
    }
  }

  const clientTotalPages = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;

  return (
    <div className="ad-table-wrap">
      <table className="ad-table">
        <thead>
          <tr>
            {columns.map((col) => {
              const active = sortKey === col.key;
              return (
                <th
                  key={col.key}
                  className={`ad-table__th ${col.sortValue ? "ad-table__th--sortable" : ""} ${
                    col.align ? `ad-align-${col.align}` : ""
                  }`}
                  style={col.width ? { width: col.width } : undefined}
                  onClick={() => toggleSort(col)}
                  aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                >
                  <span>{col.header}</span>
                  {col.sortValue ? (
                    <span className="ad-table__sort" aria-hidden="true">
                      {active ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
                    </span>
                  ) : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {paged.length === 0 ? (
            <tr>
              <td className="ad-table__empty" colSpan={columns.length}>
                {emptyText}
              </td>
            </tr>
          ) : (
            paged.map((row) => (
              <tr
                key={rowKey(row)}
                className={onRowClick ? "ad-table__row--click" : ""}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`ad-table__td ${col.align ? `ad-align-${col.align}` : ""}`}
                  >
                    {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {server ? (
        <ServerPager {...server} />
      ) : pageSize && sorted.length > pageSize ? (
        <Pager
          page={clientPage + 1}
          totalPages={clientTotalPages}
          total={sorted.length}
          prevDisabled={clientPage <= 0}
          nextDisabled={clientPage >= clientTotalPages - 1}
          onPrev={() => setClientPage((p) => Math.max(0, p - 1))}
          onNext={() => setClientPage((p) => Math.min(clientTotalPages - 1, p + 1))}
        />
      ) : null}
    </div>
  );
}

function ServerPager({ total, offset, limit, onPage }: ServerPagination) {
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  if (total <= limit) return null;
  return (
    <Pager
      page={page}
      totalPages={totalPages}
      total={total}
      prevDisabled={offset <= 0}
      nextDisabled={offset + limit >= total}
      onPrev={() => onPage(Math.max(0, offset - limit))}
      onNext={() => onPage(offset + limit)}
    />
  );
}

/** 頁尾導航（client 與 server 分頁共用的 presentational 元件）。 */
function Pager({
  page,
  totalPages,
  total,
  prevDisabled,
  nextDisabled,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  total: number;
  prevDisabled: boolean;
  nextDisabled: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="ad-pager">
      <button
        type="button"
        className="ad-btn ad-btn--ghost ad-btn--sm"
        disabled={prevDisabled}
        onClick={onPrev}
      >
        上一頁
      </button>
      <span className="ad-pager__info">
        第 {page} / {totalPages} 頁（共 {total} 筆）
      </span>
      <button
        type="button"
        className="ad-btn ad-btn--ghost ad-btn--sm"
        disabled={nextDisabled}
        onClick={onNext}
      >
        下一頁
      </button>
    </div>
  );
}
