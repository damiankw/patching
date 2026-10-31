import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { RackRow } from '../lib/types';
import { Empty, ErrorBox, Loading } from '../components/ui';

export function Racks() {
  const q = useQuery({ queryKey: ['racks'], queryFn: () => api.get<RackRow[]>('/racks') });
  const [filter, setFilter] = useState('');
  const f = filter.toUpperCase();
  const rows = (q.data ?? []).filter((r) => !f || `${r.site_code} ${r.floor_code} ${r.room_code} ${r.code} ${r.name}`.toUpperCase().includes(f));
  return (
    <div>
      <div className="page-head"><h1>All racks</h1><input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 260 }} /></div>
      {q.isLoading && <Loading />}{q.error && <ErrorBox error={q.error} />}
      {q.data && q.data.length === 0 && <Empty text="No racks yet. Create a site, then add floors, rooms and racks." />}
      {rows.length > 0 && (
        <table className="table"><thead><tr><th>Site</th><th>Floor</th><th>Room</th><th>Rack</th><th>Name</th><th>Height</th><th>Devices</th><th>Used</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td><Link to={`/sites/${r.site_id}`} className="code">{r.site_code}</Link></td><td>{r.floor_code}</td><td>{r.room_code}</td>
              <td><Link to={`/racks/${r.id}`} className="code">{r.code}</Link></td><td>{r.name}</td><td>{r.height_u}U</td><td>{r.device_count}</td>
              <td><div className="fill" style={{ width: 90 }}><div className="fill-bar" style={{ width: `${Math.min(100, (r.used_u / r.height_u) * 100)}%` }} /></div></td></tr>
          ))}</tbody></table>
      )}
    </div>
  );
}
