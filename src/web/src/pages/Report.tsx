import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, fmtDate } from '../lib/api';
import type { Location, RackDetail } from '../lib/types';
import { useAuth } from '../lib/auth';
import { Loading } from '../components/ui';

/** Print-ready report. Opened in a new tab; the browser's print dialog produces the PDF. */
export function Report() {
  const { kind, id } = useParams(); const { user } = useAuth();
  const nid = Number(id);
  const loc = useQuery({ queryKey: ['report-loc', nid], queryFn: () => api.get<Location>(`/locations/${nid}`), enabled: kind === 'location' });
  const devs = useQuery({ queryKey: ['report-devs'], queryFn: () => api.get<Record<string, unknown>[]>('/resources/devices'), enabled: kind === 'location' });
  const conns = useQuery({ queryKey: ['report-conns'], queryFn: () => api.get<Record<string, unknown>[]>('/resources/connections'), enabled: kind === 'location' });
  const rack = useQuery({ queryKey: ['report-rack', nid], queryFn: () => api.get<RackDetail>(`/racks/${nid}`), enabled: kind === 'rack' || kind === 'bom' });
  const ready = kind === 'location' ? loc.data && devs.data && conns.data : rack.data;
  useEffect(() => { if (ready) setTimeout(() => window.print(), 400); }, [ready]);
  if (!ready) return <Loading />;
  const stamp = new Date().toLocaleString();
  if (kind === 'location') {
    const l = loc.data!; const ds = devs.data!.filter((d) => String(d.path).startsWith(l.code + '/')); const cs = conns.data!.filter((c) => String(c.from).startsWith(l.code + '/') || String(c.to).startsWith(l.code + '/'));
    return <div className="report">
      <div className="cover"><h1>{l.name}</h1><div className="muted">{l.code} · {l.address}</div><p className="muted small">Network documentation report · {user?.account_name} · {stamp}</p></div>
      <h2>Devices ({ds.length})</h2><table className="table"><thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Rack</th><th>Ports</th><th>Connected</th><th>Serial</th></tr></thead><tbody>{ds.map((d) => <tr key={String(d.id)}><td className="code">{String(d.path)}</td><td>{String(d.name ?? '')}</td><td>{String(d.device_type)}</td><td>{String(d.rack ?? '')}</td><td>{String(d.ports)}</td><td>{String(d.connected_ports)}</td><td>{String(d.serial ?? '')}</td></tr>)}</tbody></table>
      <h2 className="page-break">Connections ({cs.length})</h2><table className="table"><thead><tr><th>Type</th><th>From</th><th>To</th><th>Chain start</th><th>Chain end</th><th>Complete</th></tr></thead><tbody>{cs.map((c) => <tr key={String(c.id)}><td>{String(c.type)}</td><td className="code">{String(c.from)}</td><td className="code">{String(c.to)}</td><td className="code">{String(c.chain_from)}</td><td className="code">{String(c.chain_to)}</td><td>{String(c.complete)}</td></tr>)}</tbody></table>
    </div>;
  }
  const r = rack.data!;
  if (kind === 'bom') {
    const groups = new Map<string, typeof r.devices>(); for (const d of r.devices) { const k = d.template_name ?? d.type_name; groups.set(k, [...(groups.get(k) ?? []), d]); }
    return <div className="report"><h1>Bill of materials · {r.path}</h1><div className="muted small">{r.name} · {r.height_u} rack units · {stamp}</div>
      <table className="table" style={{ marginTop: 14 }}><thead><tr><th>Qty</th><th>Item</th><th>Type</th><th>IDs</th><th>Rack units</th></tr></thead><tbody>{[...groups.entries()].map(([k, ds]) => <tr key={k}><td>{ds.length}</td><td>{k}</td><td>{ds[0].type_name}</td><td className="code">{ds.map((d) => d.code).join(', ')}</td><td>{ds.map((d) => `U${d.position_u}`).join(', ')}</td></tr>)}</tbody></table>
      <p className="muted small" style={{ marginTop: 14 }}>Notes: {r.height_u}U rack. Verify depth and mounting hardware for each item before ordering.</p></div>;
  }
  return <div className="report">
    <div className="cover"><h1>{r.path}</h1><div className="muted">{r.name} · {r.height_u} rack units · {r.location_name}</div><p className="muted small">Rack report · {user?.account_name} · {stamp}</p></div>
    <h2>Devices ({r.devices.length})</h2><table className="table"><thead><tr><th>U</th><th>ID</th><th>Name</th><th>Type</th><th>Template</th><th>Ports</th><th>Connected</th><th>Serial</th></tr></thead><tbody>{r.devices.map((d) => <tr key={d.id}><td>{d.position_u}{d.height_u > 1 ? `–${(d.position_u ?? 0) + d.height_u - 1}` : ''}</td><td className="code">{d.code}</td><td>{d.name}</td><td>{d.type_name}</td><td>{d.template_name}</td><td>{d.ports.length}</td><td>{d.ports.filter((p) => p.state !== 'none').length}</td><td>{d.serial}</td></tr>)}</tbody></table>
    <h2 className="page-break">Port connections</h2>{r.devices.map((d) => { const ps = d.ports.filter((p) => p.chain); if (!ps.length) return null; return <div key={d.id}><h3 style={{ margin: '10px 0 4px' }}>{d.code} · {d.name}</h3><table className="table"><thead><tr><th>Port</th><th>VLAN</th><th>Path</th><th>Complete</th></tr></thead><tbody>{ps.map((p) => <tr key={p.id}><td className="code">{p.name}</td><td>{p.vlan_vid ?? ''}</td><td className="code small">{p.chain!.steps.map((s) => s.path).join(' → ')}</td><td>{p.chain!.complete ? 'yes' : 'no'}</td></tr>)}</tbody></table></div>; })}
    <p className="muted small" style={{ marginTop: 16 }}>Generated {fmtDate(new Date().toISOString())}</p>
  </div>;
}
