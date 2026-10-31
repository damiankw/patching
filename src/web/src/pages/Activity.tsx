import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, BookOpen } from 'lucide-react';
import { api, fmtDate } from '../lib/api';
import type { ActivityRow } from '../lib/types';
import { usePageHeader } from '../components/Shell';
import { ErrorBox, Field, Loading } from '../components/ui';

const PAGE = 25;
export function Activity() {
  usePageHeader({ title: 'Activity Log', crumbs: [{ label: 'Activity Log' }], actions: <a className="icon-btn bordered" href="https://github.com/damiankw/patching#readme" target="_blank" rel="noreferrer" title="Documentation"><BookOpen size={15} /></a> });
  const [sp] = useSearchParams();
  const [f, setF] = useState({ from: '', to: '', action: '', entity_type: '', user: '', q: sp.get('q') ?? '' }); const [offset, setOffset] = useState(0);
  const filters = useQuery({ queryKey: ['activity-filters'], queryFn: () => api.get<{ actions: string[]; types: string[]; users: string[] }>('/activity/filters') });
  const qs = Object.entries({ ...f, limit: PAGE, offset }).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
  const q = useQuery({ queryKey: ['activity', qs], queryFn: () => api.get<{ total: number; rows: ActivityRow[] }>(`/activity?${qs}`) });
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setOffset(0); };
  const link = (r: ActivityRow) => {
    const d = r.details as { to_rack?: number };
    if (r.entity_type === 'location') return `/locations/${r.entity_id}`; if (r.entity_type === 'floor') return `/floors/${r.entity_id}`;
    if (r.entity_type === 'rack') return `/racks/${r.entity_id}`; if (r.entity_type === 'rack_device') return `/resources/devices`; if (r.entity_type === 'device') return `/resources/devices`;
    void d; return null;
  };
  const total = q.data?.total ?? 0; const pages = Math.max(1, Math.ceil(total / PAGE)); const page = Math.floor(offset / PAGE);
  return <div className="card">
    <div className="filters">
      <Field label="Date from"><input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} /></Field>
      <Field label="Date to"><input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} /></Field>
      <Field label="Action"><select value={f.action} onChange={(e) => set('action', e.target.value)}><option value="">Select filter…</option>{filters.data?.actions.map((a) => <option key={a} value={a}>{a[0].toUpperCase() + a.slice(1)}</option>)}</select></Field>
      <Field label="Resource type"><select value={f.entity_type} onChange={(e) => set('entity_type', e.target.value)}><option value="">Select filter…</option>{filters.data?.types.map((a) => <option key={a} value={a}>{a.replace('_', ' ')}</option>)}</select></Field>
      <Field label="Resource"><input placeholder="Path contains…" value={f.q} onChange={(e) => set('q', e.target.value)} /></Field>
      <Field label="User"><select value={f.user} onChange={(e) => set('user', e.target.value)}><option value="">Select filter…</option>{filters.data?.users.map((a) => <option key={a} value={a}>{a}</option>)}</select></Field>
    </div>
    <div className="btn-row" style={{ justifyContent: 'flex-end', marginBottom: 6 }}><a className="icon-btn bordered" href="/api/export/activity.csv" title="Export CSV"><FileDown size={15} /></a></div>
    {q.isLoading && <Loading />}{q.error && <ErrorBox error={q.error} />}
    {q.data && <div className="dt-scroll"><table className="table"><thead><tr><th>Date & time</th><th>Action</th><th>Resource type</th><th>Resource</th><th>User</th><th>Details</th></tr></thead><tbody>
      {q.data.rows.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>No entries match.</td></tr>}
      {q.data.rows.map((r) => { const to = link(r); return <tr key={r.id}><td className="nowrap">{fmtDate(r.created_at)}</td><td>{r.action[0].toUpperCase() + r.action.slice(1)}</td><td>{r.entity_type.replace('_', ' ').replace(/^\w/, (c) => c.toUpperCase())}</td>
        <td className="code">{to ? <Link to={to}>{r.entity_label}</Link> : r.entity_label}</td><td>{r.user_name}</td>
        <td className="muted small">{Object.entries(r.details).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ')}</td></tr>; })}
    </tbody></table></div>}
    <div className="dt-pager"><button className="icon-btn" disabled={page === 0} onClick={() => setOffset(0)}><ChevronsLeft size={14} /></button><button className="icon-btn" disabled={page === 0} onClick={() => setOffset(offset - PAGE)}><ChevronLeft size={14} /></button>
      <button className="icon-btn" disabled={page >= pages - 1} onClick={() => setOffset(offset + PAGE)}><ChevronRight size={14} /></button><button className="icon-btn" disabled={page >= pages - 1} onClick={() => setOffset((pages - 1) * PAGE)}><ChevronsRight size={14} /></button><span className="muted small">Page {page + 1} of {pages} · {total} entries</span></div>
  </div>;
}
