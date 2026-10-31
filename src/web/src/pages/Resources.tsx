import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { api, fmtDate } from '../lib/api';
import { usePageHeader } from '../components/Shell';
import { DataTable, type Column } from '../components/DataTable';
import { ErrorBox, Loading } from '../components/ui';

type Row = Record<string, unknown> & { id: number };
const TABS = ['locations', 'floors', 'rooms', 'devices', 'ports', 'connections'];
export function Resources() {
  const tab = useParams().tab ?? 'devices'; const nav = useNavigate();
  usePageHeader({ title: 'Resources', crumbs: [{ label: 'Resources' }], actions: <a className="icon-btn bordered" href="https://github.com/damiankw/patching#readme" target="_blank" rel="noreferrer" title="Documentation"><BookOpen size={15} /></a> });
  const q = useQuery({ queryKey: ['resources', tab], queryFn: () => api.get<Row[]>(`/resources/${tab}`) });
  const d = (r: Row) => fmtDate(r.created_at as string); const u = (r: Row) => fmtDate(r.updated_at as string);
  const devLink = (r: Row, pathKey = 'path') => <Link to={r.rack_id ? `/racks/${r.rack_id}?device=${r.device_id ?? r.id}` : `/floors/${r.floor_id}?device=${r.device_id ?? r.id}`} className="code">{String(r[pathKey])}</Link>;
  const cols: Record<string, Column<Row>[]> = {
    locations: [{ key: 'path', label: 'ID', render: (r) => <Link to={`/locations/${r.id}`}>{String(r.path)}</Link> }, { key: 'name', label: 'Name' }, { key: 'address', label: 'Address' }, { key: 'responsible', label: 'Responsible person' }, { key: 'floors', label: 'Floors' }, { key: 'rooms', label: 'Rooms' }, { key: 'devices', label: 'Devices' }, { key: 'created_at', label: 'Created', render: d }, { key: 'updated_at', label: 'Updated', render: u }],
    floors: [{ key: 'path', label: 'ID', render: (r) => <Link to={`/floors/${r.id}`}>{String(r.path)}</Link> }, { key: 'name', label: 'Name' }, { key: 'level', label: 'Level' }, { key: 'location', label: 'Location', render: (r) => <Link to={`/locations/${r.location_id}`}>{String(r.location)}</Link> }, { key: 'rooms', label: 'Rooms' }, { key: 'devices', label: 'Devices' }, { key: 'floor_plan', label: 'Floor plan' }, { key: 'responsible', label: 'Responsible person' }, { key: 'created_at', label: 'Created', render: d }],
    rooms: [{ key: 'path', label: 'ID', render: (r) => <Link to={`/floors/${r.floor_id}?room=${r.id}`}>{String(r.path)}</Link> }, { key: 'name', label: 'Name' }, { key: 'location', label: 'Location', render: (r) => <Link to={`/locations/${r.location_id}`}>{String(r.location)}</Link> }, { key: 'floor', label: 'Floor', render: (r) => <Link to={`/floors/${r.floor_id}`}>{String(r.floor)}</Link> }, { key: 'devices', label: 'Devices' }, { key: 'responsible', label: 'Responsible person' }, { key: 'created_at', label: 'Created', render: d }],
    devices: [{ key: 'path', label: 'ID', render: (r) => devLink(r) }, { key: 'name', label: 'Name' }, { key: 'location', label: 'Location', render: (r) => <Link to={`/locations/${r.location_id}`}>{String(r.location)}</Link> }, { key: 'floor', label: 'Floor', render: (r) => <Link to={`/floors/${r.floor_id}`}>{String(r.floor)}</Link> }, { key: 'room', label: 'Room', render: (r) => <Link to={`/floors/${r.floor_id}?room=${r.room_id ?? ''}`}>{String(r.room)}</Link> }, { key: 'rack', label: 'Rack', render: (r) => r.rack ? <Link to={`/racks/${r.rack_id}`}>{String(r.rack)}</Link> : <span className="muted">-</span> }, { key: 'device_type', label: 'Device type' }, { key: 'ports', label: 'Ports' }, { key: 'connected_ports', label: 'Connected Ports' }, { key: 'pct', label: 'Connected Ports %', sortValue: (r) => Number(r.ports) ? Number(r.connected_ports) / Number(r.ports) : 0, render: (r) => Number(r.ports) ? `${Math.round((Number(r.connected_ports) / Number(r.ports)) * 100)}%` : '-' }, { key: 'manufacturer', label: 'Manufacturer' }, { key: 'model', label: 'Model' }, { key: 'serial', label: 'Serial' }, { key: 'purchase_date', label: 'Purchase date' }, { key: 'operation_start', label: 'Operation start' }, { key: 'responsible', label: 'Responsible person' }, { key: 'created_at', label: 'Created', render: d }],
    ports: [{ key: 'path', label: 'ID', render: (r) => devLink(r) }, { key: 'kind', label: 'Connector' }, { key: 'face', label: 'Side' }, { key: 'device_type', label: 'Device type' }, { key: 'vlan', label: 'VLAN' }, { key: 'wlan', label: 'WLAN' }, { key: 'speed', label: 'Speed' }, { key: 'building', label: 'Building conn.', render: (r) => Number(r.building) ? 'yes' : '-' }, { key: 'user_conn', label: 'User conn.', render: (r) => Number(r.user_conn) ? 'yes' : '-' }],
    connections: [{ key: 'type', label: 'Type', render: (r) => <span className={`badge ${r.type === 'building' ? 'badge-amber' : 'badge-blue'}`}>{String(r.type)}</span> }, { key: 'from', label: 'From', render: (r) => <span className="code">{r.color ? <span className="swatch" style={{ background: String(r.color) }} /> : null}{String(r.from)}</span> }, { key: 'to', label: 'To', render: (r) => <span className="code">{String(r.to)}</span> }, { key: 'chain_from', label: 'Chain start', render: (r) => <span className="code muted">{String(r.chain_from)}</span> }, { key: 'chain_to', label: 'Chain end', render: (r) => <span className="code muted">{String(r.chain_to)}</span> }, { key: 'complete', label: 'Complete' }, { key: 'label', label: 'Label' }, { key: 'cable_type', label: 'Cable' }, { key: 'length_m', label: 'Length (m)' }, { key: 'created_at', label: 'Created', render: d }],
  };
  return <div>
    <div className="chip-tabs" style={{ marginBottom: 10 }}>{TABS.map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => nav(`/resources/${t}`)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
    {q.isLoading && <Loading />}{q.error && <ErrorBox error={q.error} />}
    {q.data && <DataTable rows={q.data} columns={cols[tab] ?? []} csvHref={`/api/export/${tab}.csv`} />}
  </div>;
}
