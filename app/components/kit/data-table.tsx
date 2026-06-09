"use client";

/**
 * DataTable<T> — 紧凑可排序数据表。强调列、行点击、选中高亮、loading 骨架、空态。
 * 用于 D2 提现队列、E1 商品表、C1 检索结果、脚手架 ghost 表。
 */
import { useMemo, useState } from "react";
import { ChevronsUpDown, ChevronUp, ChevronDown } from "lucide-react";

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  align?: "left" | "right" | "center";
  width?: string;
  mono?: boolean;
  sortValue?: (row: T) => string | number;
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  dense = false,
  onRowClick,
  selectedId,
  loading = false,
  empty = "暂无数据",
}: {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  dense?: boolean;
  onRowClick?: (row: T) => void;
  selectedId?: string;
  loading?: boolean;
  empty?: React.ReactNode;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    const sv = col.sortValue;
    const out = [...rows].sort((a, b) => {
      const va = sv(a);
      const vb = sv(b);
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return out;
  }, [rows, columns, sortKey, sortDir]);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const rowH = dense ? "var(--admin-row-h-dense)" : "var(--admin-row-h)";

  return (
    <div
      className="overflow-hidden rounded-[12px]"
      style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}
    >
      <table className="w-full border-collapse text-left">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--v5-border)" }}>
            {columns.map((c) => {
              const sortable = !!c.sortValue;
              const activeSort = sortKey === c.key;
              return (
                <th
                  key={c.key}
                  className="px-4 py-2.5 text-[11.5px] font-medium"
                  style={{
                    color: "var(--v5-ink-3)",
                    textAlign: c.align ?? "left",
                    width: c.width,
                    cursor: sortable ? "pointer" : "default",
                    userSelect: "none",
                  }}
                  onClick={sortable ? () => toggleSort(c.key) : undefined}
                >
                  <span
                    className="inline-flex items-center gap-1"
                    style={{ justifyContent: c.align === "right" ? "flex-end" : "flex-start" }}
                  >
                    {c.header}
                    {sortable &&
                      (activeSort ? (
                        sortDir === "asc" ? (
                          <ChevronUp size={12} style={{ color: "var(--v5-ink-2)" }} />
                        ) : (
                          <ChevronDown size={12} style={{ color: "var(--v5-ink-2)" }} />
                        )
                      ) : (
                        <ChevronsUpDown size={12} style={{ color: "var(--v5-ink-4)" }} />
                      ))}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            [0, 1, 2, 3].map((r) => (
              <tr key={r} style={{ borderBottom: "1px solid var(--v5-border)" }}>
                {columns.map((c, i) => (
                  <td key={i} className="px-4" style={{ height: rowH }}>
                    <span
                      className="block h-3 rounded-full motion-safe:animate-pulse"
                      style={{ background: "var(--v5-surface-3)", width: `${[60, 48, 70, 40, 55][i % 5]}%` }}
                    />
                  </td>
                ))}
              </tr>
            ))
          ) : sorted.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-10 text-center text-[13px]"
                style={{ color: "var(--v5-ink-4)" }}
              >
                {empty}
              </td>
            </tr>
          ) : (
            sorted.map((row) => {
              const id = getRowId(row);
              const selected = id === selectedId;
              return (
                <tr
                  key={id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-selected={onRowClick ? selected : undefined}
                  className={onRowClick ? "transition-colors hover:bg-[var(--v5-surface-2)]" : ""}
                  style={{
                    borderBottom: "1px solid var(--v5-border)",
                    cursor: onRowClick ? "pointer" : "default",
                    background: selected ? "var(--v5-surface-2)" : "transparent",
                  }}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-4 text-[12.5px] ${c.mono ? "font-mono-tabular" : ""}`}
                      style={{
                        height: rowH,
                        color: "var(--v5-ink-2)",
                        textAlign: c.align ?? "left",
                        position: "relative",
                      }}
                    >
                      {selected && c === columns[0] && (
                        <span
                          className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full"
                          style={{ background: "var(--v5-brand)" }}
                        />
                      )}
                      {c.render
                        ? c.render(row)
                        : String((row as Record<string, unknown>)[c.key] ?? "")}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
