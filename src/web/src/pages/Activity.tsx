import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, fmtDate } from '../lib/api';
import type { ActivityRow } from '../lib/types';
import { Empty, ErrorBox, Loading } from '../components/ui';

const PAGE = 50;
export function Activity() {
  const [q, setQ] = useState(''); const [offset, setOffset] = useState(0);
  const query = useQuery({ queryKey: ['activity', q, offset], queryFn: () => api.get<{ total: number; rows: ActivityRow[] }>(`/activity?q=${encodeURIComponent(q)}&limit=${PAGE}&offset=${offset}`) });
  return (
    <div>
      <div className="page-head"><h1>Activity log</h1><input placeholder="Filter…" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} style={{ maxWidth: 260 }} /></div>
      {query.isLoading && <Loading />}{query.error && <ErrorBox error={query.error} />}
      {query.data?.rows.length === 0 && <Empty text="Nothing logged yet." />}
      {query.data && query.data.rows.length > 0 && (<>
        <table className="table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Type</th><th>What</th><th>Details</th></tr></thead>
          <tbody>{query.data.rows.map((r) => (
            <tr key={r.id}><td className="nowrap muted">{fmtDate(r.created_at)}</td><td>{r.user_name}</td><td><span className={`badge action-${r.action}`}>{r.action}</span></td><td>{r.entity_type.replace('_', ' ')}</td><td className="code">{r.entity_label}</td>
              <td className="muted small">{Object.entries(r.details).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`).join(' · ')}</td></tr>
          ))}</tbody></table>
        <div className="pager"><span className="muted">{offset + 1}–{Math.min(offset + PAGE, query.data.total)} of {query.data.total}</span>
          <button className="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Newer</button>
          <button className="btn btn-sm" disabled={offset + PAGE >= query.data.total} onClick={() => setOffset(offset + PAGE)}>Older</button></div>
      </>)}
    </div>
  );
}
