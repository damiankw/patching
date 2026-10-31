import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Empty, ErrorBox, Loading } from '../components/ui';

interface Results {
  sites: { id: number; code: string; name: string }[];
  racks: { id: number; code: string; name: string; site_code: string; room_code: string }[];
  devices: { id: number; code: string; name: string; serial: string; ip_address: string; position_u: number; type_name: string; rack_id: number; rack_code: string; site_code: string }[];
  vlans: { id: number; vid: number; name: string; site_id: number; site_code: string }[];
}
export function Search() {
  const q = useSearchParams()[0].get('q') ?? '';
  const query = useQuery({ queryKey: ['search', q], queryFn: () => api.get<Results>(`/search?q=${encodeURIComponent(q)}`), enabled: !!q });
  const r = query.data;
  const total = r ? r.sites.length + r.racks.length + r.devices.length + r.vlans.length : 0;
  return (
    <div>
      <h1>Search: “{q}”</h1>
      {query.isLoading && <Loading />}{query.error && <ErrorBox error={query.error} />}
      {r && total === 0 && <Empty text="No matches." />}
      {r && r.sites.length > 0 && <section><h2>Sites</h2><ul className="result-list">{r.sites.map((s) => <li key={s.id}><Link to={`/sites/${s.id}`}><span className="code">{s.code}</span> {s.name}</Link></li>)}</ul></section>}
      {r && r.racks.length > 0 && <section><h2>Racks</h2><ul className="result-list">{r.racks.map((k) => <li key={k.id}><Link to={`/racks/${k.id}`}><span className="muted">{k.site_code}/{k.room_code}/</span><span className="code">{k.code}</span> {k.name}</Link></li>)}</ul></section>}
      {r && r.devices.length > 0 && <section><h2>Devices</h2><ul className="result-list">{r.devices.map((d) => <li key={d.id}><Link to={`/racks/${d.rack_id}?device=${d.id}`}><span className="muted">{d.site_code}/{d.rack_code}/</span><span className="code">{d.code}</span> {d.name} <span className="muted">· {d.type_name} · U{d.position_u}{d.ip_address && ` · ${d.ip_address}`}{d.serial && ` · SN ${d.serial}`}</span></Link></li>)}</ul></section>}
      {r && r.vlans.length > 0 && <section><h2>VLANs</h2><ul className="result-list">{r.vlans.map((v) => <li key={v.id}><Link to={`/sites/${v.site_id}`}><span className="muted">{v.site_code} · </span>VLAN <span className="code">{v.vid}</span> {v.name}</Link></li>)}</ul></section>}
    </div>
  );
}
