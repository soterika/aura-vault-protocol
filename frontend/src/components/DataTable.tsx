"use client";

import React, { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

export interface SortState {
  columnId: string;
  direction: SortDirection;
}

export interface PaginationConfig {
  page: number;
  pageSize: number;
  totalItems?: number;
  totalPages?: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
  isLoading?: boolean;
}

export interface ColumnDef<T> {
  id: string;
  header: React.ReactNode;
  accessorKey?: keyof T;
  accessorFn?: (row: T) => unknown;
  cell?: (row: T) => React.ReactNode;
  sortable?: boolean;
  sortValue?: (row: T) => string | number | Date | null | undefined;
  filterable?: boolean;
  filterPlaceholder?: string;
  align?: "left" | "right" | "center";
  hideable?: boolean;
  defaultVisible?: boolean;
  headerClassName?: string;
  cellClassName?: string;
}

export interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  getRowKey: (row: T, index: number) => string | number;
  caption: string;
  showCaption?: boolean;
  pagination?: PaginationConfig;
  onSort?: (sort: SortState | null) => void;
  onFilter?: (filters: Record<string, string>) => void;
  enableColumnVisibility?: boolean;
  loading?: boolean;
  emptyMessage?: React.ReactNode;
  rowClassName?: (row: T) => string;
  className?: string;
}

function getRawValue<T>(row: T, col: ColumnDef<T>): unknown {
  if (col.accessorFn) return col.accessorFn(row);
  if (col.accessorKey !== undefined) return row[col.accessorKey];
  return undefined;
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  const numA = Number(a);
  const numB = Number(b);
  if (!Number.isNaN(numA) && !Number.isNaN(numB) && a !== "" && b !== "") {
    return numA - numB;
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export default function DataTable<T>({
  columns,
  data,
  getRowKey,
  caption,
  showCaption = false,
  pagination,
  onSort,
  onFilter,
  enableColumnVisibility = true,
  loading = false,
  emptyMessage = "No matching records found.",
  rowClassName,
  className = "",
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(columns.map((col) => [col.id, col.defaultVisible !== false])),
  );

  const activeColumns = useMemo(
    () => columns.filter((col) => visibleColumns[col.id] !== false),
    [columns, visibleColumns],
  );

  const hasFilterableColumns = useMemo(
    () => activeColumns.some((col) => col.filterable),
    [activeColumns],
  );

  const handleSort = (columnId: string) => {
    const nextSort: SortState | null =
      sort?.columnId === columnId
        ? sort.direction === "asc"
          ? { columnId, direction: "desc" }
          : null
        : { columnId, direction: "asc" };

    setSort(nextSort);
    if (onSort) {
      onSort(nextSort);
    }
  };

  const handleFilterChange = (columnId: string, value: string) => {
    const nextFilters = { ...filters, [columnId]: value };
    setFilters(nextFilters);
    if (onFilter) {
      onFilter(nextFilters);
    }
  };

  const toggleColumn = (columnId: string) => {
    setVisibleColumns((prev) => ({
      ...prev,
      [columnId]: prev[columnId] === false,
    }));
  };

  const processedData = useMemo(() => {
    let rows = data;

    if (!onFilter) {
      const activeFilters = Object.entries(filters).filter(([, val]) => val.trim() !== "");
      if (activeFilters.length > 0) {
        rows = rows.filter((row) =>
          activeFilters.every(([colId, query]) => {
            const col = columns.find((c) => c.id === colId);
            if (!col) return true;
            const raw = getRawValue(row, col);
            return String(raw ?? "")
              .toLowerCase()
              .includes(query.trim().toLowerCase());
          }),
        );
      }
    }

    if (!onSort && sort) {
      const col = columns.find((c) => c.id === sort.columnId);
      if (col) {
        rows = [...rows].sort((a, b) => {
          const valA = col.sortValue ? col.sortValue(a) : getRawValue(a, col);
          const valB = col.sortValue ? col.sortValue(b) : getRawValue(b, col);
          const cmp = compareValues(valA, valB);
          return sort.direction === "asc" ? cmp : -cmp;
        });
      }
    }

    return rows;
  }, [data, columns, filters, sort, onFilter, onSort]);

  const totalItems = pagination?.totalItems ?? processedData.length;
  const pageSize = pagination?.pageSize ?? processedData.length;
  const totalPages = pagination?.totalPages ?? Math.max(1, Math.ceil(totalItems / Math.max(1, pageSize)));
  const currentPage = pagination ? Math.min(Math.max(1, pagination.page), totalPages) : 1;

  const displayedRows = useMemo(() => {
    if (!pagination || pagination.totalItems !== undefined) {
      return processedData;
    }
    const start = (currentPage - 1) * pageSize;
    return processedData.slice(start, start + pageSize);
  }, [processedData, pagination, currentPage, pageSize]);

  return (
    <div className={`space-y-3 ${className}`}>
      {(enableColumnVisibility || hasFilterableColumns) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {hasFilterableColumns ? (
            <div className="flex flex-wrap items-center gap-2">
              {activeColumns
                .filter((col) => col.filterable)
                .map((col) => (
                  <label key={col.id} className="sr-only" htmlFor={`filter-${col.id}`}>
                    Filter by {typeof col.header === "string" ? col.header : col.id}
                  </label>
                ))}
              {activeColumns
                .filter((col) => col.filterable)
                .map((col) => (
                  <input
                    key={col.id}
                    id={`filter-${col.id}`}
                    type="search"
                    value={filters[col.id] ?? ""}
                    onChange={(e) => handleFilterChange(col.id, e.target.value)}
                    placeholder={
                      col.filterPlaceholder ??
                      `Filter ${typeof col.header === "string" ? col.header.toLowerCase() : col.id}…`
                    }
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                ))}
            </div>
          ) : (
            <div />
          )}

          {enableColumnVisibility && (
            <div className="relative">
              <button
                type="button"
                aria-expanded={columnsOpen}
                aria-haspopup="menu"
                onClick={() => setColumnsOpen((open) => !open)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <span>Columns</span>
                <span aria-hidden="true" className="text-xs">
                  {columnsOpen ? "▲" : "▼"}
                </span>
              </button>
              {columnsOpen && (
                <div
                  role="menu"
                  aria-label="Toggle column visibility"
                  className="absolute right-0 z-20 mt-1.5 w-48 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {columns.map((col) => {
                    const isVisible = visibleColumns[col.id] !== false;
                    const disabled = col.hideable === false;
                    return (
                      <label
                        key={col.id}
                        className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm ${
                          disabled
                            ? "cursor-not-allowed opacity-50"
                            : "cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isVisible}
                          disabled={disabled}
                          onChange={() => toggleColumn(col.id)}
                          className="rounded border-zinc-300 dark:border-zinc-600"
                        />
                        <span className="truncate">
                          {typeof col.header === "string" ? col.header : col.id}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full min-w-[38rem] border-collapse text-left text-sm">
          <caption className={showCaption ? "px-4 py-2 text-left text-sm font-medium text-zinc-600 dark:text-zinc-400" : "sr-only"}>
            {caption}
          </caption>
          <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              {activeColumns.map((col, idx) => {
                const isFirst = idx === 0;
                const isSorted = sort?.columnId === col.id;
                const alignClass =
                  col.align === "right"
                    ? "text-right"
                    : col.align === "center"
                      ? "text-center"
                      : "text-left";
                const stickyClass = isFirst
                  ? "sticky left-0 z-10 bg-zinc-50 dark:bg-zinc-950"
                  : "";

                return (
                  <th
                    key={col.id}
                    scope="col"
                    aria-sort={
                      col.sortable
                        ? isSorted
                          ? sort.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                        : undefined
                    }
                    className={`px-4 py-3 font-semibold ${alignClass} ${stickyClass} ${col.headerClassName ?? ""}`}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => handleSort(col.id)}
                        className={`inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100 ${
                          col.align === "right" ? "flex-row-reverse" : ""
                        }`}
                      >
                        <span>{col.header}</span>
                        <span aria-hidden="true" className="text-[10px]">
                          {isSorted ? (sort.direction === "asc" ? "▲" : "▼") : "⇅"}
                        </span>
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className={loading ? "opacity-60" : ""} aria-busy={loading}>
            {displayedRows.map((row, rowIndex) => (
              <tr
                key={getRowKey(row, rowIndex)}
                className={`border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 ${
                  rowClassName ? rowClassName(row) : ""
                }`}
              >
                {activeColumns.map((col, colIndex) => {
                  const isFirst = colIndex === 0;
                  const alignClass =
                    col.align === "right"
                      ? "text-right"
                      : col.align === "center"
                        ? "text-center"
                        : "text-left";
                  const stickyClass = isFirst
                    ? "sticky left-0 z-10 bg-inherit font-medium"
                    : "";
                  const content = col.cell
                    ? col.cell(row)
                    : String(getRawValue(row, col) ?? "");

                  if (isFirst) {
                    return (
                      <th
                        key={col.id}
                        scope="row"
                        className={`px-4 py-3 ${alignClass} ${stickyClass} ${col.cellClassName ?? ""}`}
                      >
                        {content}
                      </th>
                    );
                  }

                  return (
                    <td
                      key={col.id}
                      className={`px-4 py-3 ${alignClass} ${col.cellClassName ?? ""}`}
                    >
                      {content}
                    </td>
                  );
                })}
              </tr>
            ))}
            {displayedRows.length === 0 && (
              <tr>
                <td
                  colSpan={Math.max(1, activeColumns.length)}
                  className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400"
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pagination && totalPages > 1 && (
        <nav
          aria-label="Table pagination"
          className="flex flex-wrap items-center justify-between gap-2 text-sm"
        >
          <span className="text-zinc-600 dark:text-zinc-400">
            {totalItems} {pagination.itemLabel ?? "items"}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={currentPage <= 1 || pagination.isLoading}
              onClick={() => pagination.onPageChange(Math.max(1, currentPage - 1))}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700"
            >
              Previous
            </button>
            <span aria-live="polite" className="text-zinc-600 dark:text-zinc-400">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              disabled={currentPage >= totalPages || pagination.isLoading}
              onClick={() => pagination.onPageChange(Math.min(totalPages, currentPage + 1))}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700"
            >
              Next
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
