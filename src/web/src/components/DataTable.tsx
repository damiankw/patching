import { useMemo, useState, type ReactNode } from 'react';
import { ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, FileDown } from 'lucide-react';

export interface Column<T> { key: string; label: ReactNode; render?: (row: T) => ReactNode; sortValue?: (row: T) => string | number | null; width?: number | string; align?: 'right' }
export function DataTable<T extends { id: number | string }>({ rows, columns, search, csvHref, pageSizes = [10, 25, 50, 100], defaultPageSize = 10, toolbar, empty = 'Nothing here yet.', rowClass }: { rows: T[]; columns: Column<T>[]; search?: boolean; csvHref?: string; pageSizes?: number[]; defaultPageSize?: number; toolbar?: ReactNode; empty?: ReactNode; rowClass?: (r: T) => string }) {
  const [q, setQ] = useState(''); const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0); const [size, setSize] = useState(defaultPageSize);
  const filtered = useMemo(() => {
    const f = q.trim().toUpperCase();
    let r = f ? rows.filter((row) => JSON.stringify(row).toUpperCase().includes(f)) : rows;
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      const val = (row: T) => col?.sortValue ? col.sortValue(row) : (row as Record<string, unknown>)[sort.key] as string | number | null;
      r = [...r].sort((a, b) => { const va = val(a), vb = val(b); if (va == null) return 1; if (vb == null) return -1; return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true })) * sort.dir; });
    }
    return r;
  }, [rows, q, sort, columns]);
  const pages = Math.max(1, Math.ceil(filtered.length / size)); const p = Math.min(page, pages - 1);
  const view = filtered.slice(p * size, p * size + size);
  return (
    <div className="dt">
      <div className="dt-toolbar">{toolbar}<span className="grow" />{csvHref && <a className="icon-btn" href={csvHref} title="Export CSV"><FileDown size={16} /></a>}{search !== false && <input className="dt-search" placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />}</div>
      <div className="dt-scroll"><table className="table">
        <thead><tr>{columns.map((c) => <th key={c.key} style={{ width: c.width, textAlign: c.align }} onClick={() => setSort(sort?.key === c.key ? { key: c.key, dir: sort.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 })}><span className="th-inner">{c.label}<ArrowUpDown size={12} className={sort?.key === c.key ? 'sort-on' : 'sort-off'} /></span></th>)}</tr></thead>
        <tbody>{view.length === 0 && <tr><td colSpan={columns.length} className="muted" style={{ textAlign: 'center', padding: 24 }}>{empty}</td></tr>}
          {view.map((r) => <tr key={r.id} className={rowClass?.(r)}>{columns.map((c) => <td key={c.key} style={{ textAlign: c.align }}>{c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '') || <span className="muted">-</span>}</td>)}</tr>)}</tbody>
      </table></div>
      <div className="dt-pager">
        <button className="icon-btn" disabled={p === 0} onClick={() => setPage(0)}><ChevronsLeft size={14} /></button><button className="icon-btn" disabled={p === 0} onClick={() => setPage(p - 1)}><ChevronLeft size={14} /></button>
        <button className="icon-btn" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}><ChevronRight size={14} /></button><button className="icon-btn" disabled={p >= pages - 1} onClick={() => setPage(pages - 1)}><ChevronsRight size={14} /></button>
        <span className="muted small">Page {p + 1} of {pages}</span>
        <select value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }} className="dt-size">{pageSizes.map((s) => <option key={s} value={s}>Show {s}</option>)}</select>
      </div>
    </div>
  );
}
