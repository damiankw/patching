import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ConnectionRow } from '../lib/types';
import { Empty, ErrorBox, Loading } from '../components/ui';

export function ConnectionsTable({ rows, hideRack }: { rows: ConnectionRow[]; hideRack?: number }) {
  const end = (site: string, rackId: number, rack: string, device: string, face: string, port: string) => (
    <span>{rackId !== hideRack && <><span className="muted">{site}/</span><Link to={`/racks/${rackId}`} className="code">{rack}</Link><span className="muted">/</span></>}<span className="code">{device}</span>:{port}<span className="muted"> {face}</span></span>
  );
  return (
    <table className="table"><thead><tr><th>A</th><th /><th>B</th><th>Cable</th><th>Colour</th><th>Label</th><th>Length</th></tr></thead>
      <tbody>{rows.map((c) => (
        <tr key={c.id}>
          <td>{end(c.a_site, c.a_rack_id, c.a_rack, c.a_device, c.a_face, c.a_port)}</td><td className="muted">⇄</td>
          <td>{end(c.b_site, c.b_rack_id, c.b_rack, c.b_device, c.b_face, c.b_port)}</td>
          <td>{c.cable_type}</td><td>{c.color && <span className="swatch" style={{ background: cssColor(c.color) }} />}{c.color}</td><td>{c.label}</td><td>{c.length_m != null ? `${c.length_m} m` : ''}</td>
        </tr>
      ))}</tbody></table>
  );
}
export function cssColor(c: string) { return /^#|^rgb|^hsl/.test(c) ? c : c.toLowerCase().replace(/\s+/g, ''); }

export function Connections() {
  const [q, setQ] = useState('');
  const query = useQuery({ queryKey: ['connections', 'all', q], queryFn: () => api.get<ConnectionRow[]>(`/connections?q=${encodeURIComponent(q)}`) });
  return (
    <div>
      <div className="page-head"><h1>Connections</h1><input placeholder="Filter by device, rack, label, cable…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} /></div>
      {query.isLoading && <Loading />}{query.error && <ErrorBox error={query.error} />}
      {query.data && query.data.length === 0 && <Empty text="No connections yet. Open a rack, select a device and connect its ports." />}
      {query.data && query.data.length > 0 && <ConnectionsTable rows={query.data} />}
    </div>
  );
}
