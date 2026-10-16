import { useMemo, useState, type ReactNode } from "react";

export interface ColumnDef<T> {
  key: string;
  label: ReactNode;
  numeric?: boolean;
  sortValue?: (t: T) => number | string;
  render: (t: T) => ReactNode;
}

interface DataTableProps<T> {
  rows: T[];
  columns: ColumnDef<T>[];
  rowKey: (t: T) => string;
  detail?: (t: T) => ReactNode;
  placeholder?: ReactNode;
  /** Extra controls rendered inside the toolbar, on the filter's line — the
      place a second filter belongs, rather than a row of its own above. */
  toolbar?: ReactNode;
}

/**
 * The shared sortable/filterable table used by both the global models page and
 * the per-provider detail page. Sorting parses prices as numbers even though the
 * storage shape is strings; row click toggles an expanded body (long-context
 * band / peak schedule) below the row.
 */
export function DataTable<T>({ rows, columns, rowKey, detail, placeholder, toolbar }: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const shown = useMemo(() => {
    let out = rows;
    const q = filter.trim().toLowerCase();
    if (q) {
      out = out.filter((r) =>
        columns.some((c) => {
          const v = c.sortValue ? c.sortValue(r) : (c.render(r) as ReactNode);
          return String(v).toLowerCase().includes(q);
        }),
      );
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        out = [...out].sort((a, b) => {
          const va = col.sortValue ? col.sortValue(a) : (a as never);
          const vb = col.sortValue ? col.sortValue(b) : (b as never);
          const n = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
          return sort.dir * n;
        });
      }
    }
    return out;
  }, [rows, sort, filter, columns]);

  if (rows.length === 0 && placeholder !== undefined) return <div className="empty-state">{placeholder}</div>;

  return (
    <div className="table-wrap">
      <div className="table-toolbar">
        <input
          className="filter-input"
          placeholder="Filter rows…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter rows"
        />
        {toolbar}
        <span className="muted" style={{ marginLeft: "auto" }}>{shown.length} of {rows.length}</span>
      </div>
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`sortable${c.numeric ? " num" : ""}`}
                onClick={() =>
                  setSort((s) =>
                    s?.key === c.key ? { key: c.key, dir: (s.dir * -1) as 1 | -1 } : { key: c.key, dir: 1 },
                  )
                }
              >
                {c.label}
                {sort?.key === c.key && <span className="sort-caret">{sort.dir === 1 ? " ▲" : " ▼"}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const k = rowKey(r);
            const expanded = open === k;
            const toggle = () => setOpen(expanded ? null : k);
            return [
              <tr key={k} className={expanded ? "row-open" : ""} onClick={toggle}>
                {columns.map((c) => (
                  <td key={c.key} className={c.numeric ? "num" : ""}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>,
              detail && expanded ? (
                <tr key={`${k}-detail`} className="expand-tr">
                  <td colSpan={columns.length}>{detail(r)}</td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}