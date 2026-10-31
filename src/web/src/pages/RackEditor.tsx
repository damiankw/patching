import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useCanEdit } from '../lib/auth';
import type { ConnectionRow, Device, DeviceType, Port, PortSearchRow, RackDetail, Trace } from '../lib/types';
import { Badge, Confirm, Dialog, ErrorBox, Field, Form, Loading, errMsg, useToast } from '../components/ui';
import { ConnectionsTable, cssColor } from './Connections';
import { RackForm } from './SiteDetail';

const UH = 20; // px per rack unit
const PAD = 8; const GUTTER = 34; const RAIL = 10; const W = 360;
type Face = 'front' | 'rear';

export function RackEditor() {
  const id = Number(useParams().id);
  const qc = useQueryClient(); const toast = useToast(); const canEdit = useCanEdit();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ['rack', id], queryFn: () => api.get<RackDetail>(`/racks/${id}`) });
  const [face, setFace] = useState<Face>('front');
  const [selected, setSelected] = useState<number | null>(params.get('device') ? Number(params.get('device')) : null);
  const [selectedPort, setSelectedPort] = useState<number | null>(null);
  const [tab, setTab] = useState<'device' | 'connections'>('device');
  const [modal, setModal] = useState<null | { kind: 'add'; position: number } | { kind: 'editDevice'; device: Device } | { kind: 'deleteDevice'; device: Device } | { kind: 'editRack' } | { kind: 'connect'; port: Port } | { kind: 'trace'; port: Port } | { kind: 'move'; device: Device }>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['rack', id] }), qc.invalidateQueries({ queryKey: ['connections'] }), qc.invalidateQueries({ queryKey: ['racks'] })]);

  useEffect(() => { if (params.get('device')) { setSelected(Number(params.get('device'))); params.delete('device'); setParams(params, { replace: true }); } }, [params, setParams]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const rack = q.data!;
  const device = rack.devices.find((d) => d.id === selected) ?? null;
  const port = device?.ports.find((p) => p.id === selectedPort) ?? null;

  const onDrop = async (d: Device, newU: number) => {
    if (newU === d.position_u) return;
    try { await api.patch(`/devices/${d.id}`, { position_u: newU }); await refresh(); }
    catch (e) { toast(errMsg(e), 'error'); }
  };

  return (
    <div>
      <div className="breadcrumb"><Link to="/">Sites</Link> / <Link to={`/sites/${rack.site_id}`}>{rack.site_code}</Link> / {rack.floor_code} / {rack.room_code} / <span className="code">{rack.code}</span></div>
      <div className="page-head">
        <div><h1><span className="code">{rack.code}</span> {rack.name}</h1><div className="muted">{rack.site_name} · {rack.floor_name} · {rack.room_name} · {rack.height_u}U · {rack.devices.length} devices</div></div>
        <div className="btn-row">
          {canEdit && <button className="btn btn-primary" onClick={() => setModal({ kind: 'add', position: firstFree(rack, 1) })}>+ Add device</button>}
          {canEdit && <button className="btn" onClick={() => setModal({ kind: 'editRack' })}>Edit rack</button>}
        </div>
      </div>
      {rack.notes && <p className="notes">{rack.notes}</p>}
      <div className="rack-page">
        <div className="rack-canvas-wrap">
          <div className="rack-toolbar">
            <div className="seg"><button className={face === 'front' ? 'active' : ''} onClick={() => setFace('front')}>Front</button><button className={face === 'rear' ? 'active' : ''} onClick={() => setFace('rear')}>Rear</button></div>
            <span className="muted small">{canEdit ? 'Drag devices to move. Click an empty slot to add.' : 'Read only'}</span>
          </div>
          <RackSvg rack={rack} face={face} selected={selected} canEdit={canEdit}
            onSelect={(d) => { setSelected(d); setSelectedPort(null); setTab('device'); }}
            onDrop={onDrop} onEmptyClick={(u) => canEdit && setModal({ kind: 'add', position: u })} />
        </div>
        <div className="side-panel">
          <div className="tabs"><button className={tab === 'device' ? 'active' : ''} onClick={() => setTab('device')}>Device</button><button className={tab === 'connections' ? 'active' : ''} onClick={() => setTab('connections')}>Rack connections</button></div>
          {tab === 'connections' && <RackConnections rackId={id} />}
          {tab === 'device' && !device && <div className="muted">Select a device in the rack to see its details and ports.</div>}
          {tab === 'device' && device && (
            <div>
              <h2><span className="code">{device.code}</span> {device.name} <Badge color={device.color}>{device.type_name}</Badge></h2>
              <dl className="kv">
                <dt>Position</dt><dd>U{device.position_u}{device.height_u > 1 && `–U${device.position_u + device.height_u - 1}`} ({device.height_u}U)</dd>
                {(device.manufacturer || device.model) && <><dt>Make / model</dt><dd>{device.manufacturer} {device.model}</dd></>}
                {device.serial && <><dt>Serial</dt><dd className="code">{device.serial}</dd></>}
                {device.ip_address && <><dt>IP</dt><dd className="code">{device.ip_address}</dd></>}
                {device.notes && <><dt>Notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{device.notes}</dd></>}
              </dl>
              {canEdit && <div className="btn-row"><button className="btn btn-sm" onClick={() => setModal({ kind: 'editDevice', device })}>Edit</button><button className="btn btn-sm" onClick={() => setModal({ kind: 'move', device })}>Move to another rack</button><button className="btn btn-sm btn-danger-ghost" onClick={() => setModal({ kind: 'deleteDevice', device })}>Delete</button></div>}
              {(['front', 'rear'] as Face[]).map((f) => {
                const ps = device.ports.filter((p) => p.face === f);
                if (!ps.length) return null;
                return (
                  <div key={f}>
                    <div className="face-head">{f} ports · {ps.filter((p) => p.connection).length}/{ps.length} connected</div>
                    <div className="ports-grid">{ps.map((p) => (
                      <button key={p.id} className={`port-chip${p.connection ? ' connected' : ''}${p.id === selectedPort ? ' selected' : ''}`} onClick={() => setSelectedPort(p.id === selectedPort ? null : p.id)} title={`${p.kind}${p.connection ? ` → ${p.connection.device_code}:${p.connection.port_name}` : ''}`}>
                        <span className="dot" style={p.connection?.color ? { background: cssColor(p.connection.color) } : undefined} />{p.name}{p.vlan_vid != null && <span className="vlan">v{p.vlan_vid}</span>}
                      </button>
                    ))}</div>
                  </div>
                );
              })}
              {device.ports.length === 0 && <div className="muted">This device type has no ports.</div>}
              {port && <PortDetail port={port} device={device} rack={rack} canEdit={canEdit} onChanged={refresh}
                onConnect={() => setModal({ kind: 'connect', port })} onTrace={() => setModal({ kind: 'trace', port })} />}
            </div>
          )}
        </div>
      </div>

      <Dialog open={modal?.kind === 'add'} onClose={() => setModal(null)} title="Add device" wide>
        {modal?.kind === 'add' && <AddDeviceForm rack={rack} position={modal.position} onDone={() => { setModal(null); refresh(); }} />}
      </Dialog>
      <Dialog open={modal?.kind === 'editDevice'} onClose={() => setModal(null)} title="Edit device">
        {modal?.kind === 'editDevice' && <EditDeviceForm device={modal.device} onDone={() => { setModal(null); refresh(); }} />}
      </Dialog>
      <Dialog open={modal?.kind === 'move'} onClose={() => setModal(null)} title="Move device to another rack">
        {modal?.kind === 'move' && <MoveDeviceForm device={modal.device} onDone={() => { setModal(null); setSelected(null); refresh(); }} />}
      </Dialog>
      <Confirm open={modal?.kind === 'deleteDevice'} onClose={() => setModal(null)} title="Delete device"
        text={modal?.kind === 'deleteDevice' ? `Delete ${modal.device.code}? ${modal.device.ports.filter((p) => p.connection).length} connection(s) will be removed.` : ''}
        onConfirm={async () => { if (modal?.kind === 'deleteDevice') { await api.del(`/devices/${modal.device.id}`); setSelected(null); await refresh(); } }} />
      <Dialog open={modal?.kind === 'editRack'} onClose={() => setModal(null)} title="Edit rack">
        {modal?.kind === 'editRack' && <RackForm roomId={rack.room_id} rack={{ ...rack, device_count: rack.devices.length, used_u: 0 }} onDone={() => { setModal(null); refresh(); }} />}
      </Dialog>
      <Dialog open={modal?.kind === 'connect'} onClose={() => setModal(null)} title="Connect port" wide>
        {modal?.kind === 'connect' && <ConnectForm port={modal.port} device={device!} rack={rack} onDone={() => { setModal(null); refresh(); }} />}
      </Dialog>
      <Dialog open={modal?.kind === 'trace'} onClose={() => setModal(null)} title="Trace connection path">
        {modal?.kind === 'trace' && <TraceView portId={modal.port.id} />}
      </Dialog>
    </div>
  );
}

function firstFree(rack: RackDetail, height: number) {
  const occ = new Set<number>();
  for (const d of rack.devices) for (let u = d.position_u; u < d.position_u + d.height_u; u++) occ.add(u);
  for (let u = rack.height_u - height + 1; u >= 1; u--) {
    let ok = true; for (let k = 0; k < height; k++) if (occ.has(u + k)) { ok = false; break; }
    if (ok) return u;
  }
  return 1;
}

// ---------- SVG rack ----------
function RackSvg({ rack, face, selected, canEdit, onSelect, onDrop, onEmptyClick }: { rack: RackDetail; face: Face; selected: number | null; canEdit: boolean; onSelect: (id: number) => void; onDrop: (d: Device, u: number) => void; onEmptyClick: (u: number) => void }) {
  const H = rack.height_u * UH + PAD * 2;
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: number; startY: number; dy: number } | null>(null);
  const yOf = (topU: number) => PAD + (rack.height_u - topU) * UH;
  const occupied = useMemo(() => { const s = new Set<number>(); for (const d of rack.devices) for (let u = d.position_u; u < d.position_u + d.height_u; u++) s.add(u); return s; }, [rack]);
  const scale = () => { const el = svgRef.current; return el ? el.getBoundingClientRect().width / W : 1; };

  const devices = face === 'front' ? rack.devices : rack.devices; // same devices either face; ports differ in panel
  return (
    <svg ref={svgRef} className="rack-canvas" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Rack ${rack.code} ${face} view`}>
      <rect x={GUTTER} y={0} width={W - GUTTER} height={H} rx={6} fill="var(--rack-bg)" />
      <rect x={GUTTER + 2} y={PAD} width={RAIL} height={rack.height_u * UH} fill="var(--rack-rail)" />
      <rect x={W - RAIL - 2} y={PAD} width={RAIL} height={rack.height_u * UH} fill="var(--rack-rail)" />
      {Array.from({ length: rack.height_u }, (_, i) => rack.height_u - i).map((u) => {
        const y = yOf(u);
        return (
          <g key={u}>
            <text x={GUTTER - 6} y={y + UH / 2 + 4} fontSize={10} textAnchor="end" fill="var(--muted)" fontFamily="var(--mono)">{u}</text>
            <line x1={GUTTER + RAIL + 2} x2={W - RAIL - 2} y1={y} y2={y} stroke="var(--rack-rail)" strokeWidth={0.5} />
            {!occupied.has(u) && (
              <rect x={GUTTER + RAIL + 2} y={y} width={W - GUTTER - RAIL * 2 - 4} height={UH} fill="transparent" style={{ cursor: canEdit ? 'pointer' : 'default' }}
                onClick={() => onEmptyClick(u)}><title>{canEdit ? `Add device at U${u}` : `U${u} empty`}</title></rect>
            )}
          </g>
        );
      })}
      {devices.map((d) => {
        const topU = d.position_u + d.height_u - 1;
        const isDrag = drag?.id === d.id;
        const y = yOf(topU) + (isDrag ? drag.dy : 0);
        const h = d.height_u * UH;
        const sel = selected === d.id;
        const connected = d.ports.filter((p) => p.face === face && p.connection).length;
        const total = d.ports.filter((p) => p.face === face).length;
        return (
          <g key={d.id} transform={`translate(0, ${y})`} style={{ cursor: canEdit ? 'grab' : 'pointer' }}
            onPointerDown={(e) => {
              if (!canEdit || e.button !== 0) return;
              (e.target as Element).setPointerCapture?.(e.pointerId);
              setDrag({ id: d.id, startY: e.clientY, dy: 0 });
            }}
            onPointerMove={(e) => { if (isDrag) setDrag({ ...drag, dy: (e.clientY - drag.startY) / scale() }); }}
            onPointerUp={() => {
              if (!isDrag) { onSelect(d.id); return; }
              const moved = Math.round(drag.dy / UH);
              setDrag(null);
              onSelect(d.id);
              if (moved !== 0) {
                const newU = Math.max(1, Math.min(rack.height_u - d.height_u + 1, d.position_u - moved));
                onDrop(d, newU);
              }
            }}
            onPointerCancel={() => setDrag(null)}>
            <rect x={GUTTER + RAIL + 3} y={1} width={W - GUTTER - RAIL * 2 - 6} height={h - 2} rx={3} fill={d.color} opacity={isDrag ? 0.7 : 1}
              stroke={sel ? 'var(--primary)' : 'rgba(255,255,255,.25)'} strokeWidth={sel ? 2.5 : 1} />
            <text x={GUTTER + RAIL + 12} y={Math.min(h / 2 + 4, 14)} fontSize={11} fontWeight={700} fill="#fff" fontFamily="var(--mono)">{d.code}</text>
            <text x={W - RAIL - 12} y={Math.min(h / 2 + 4, 14)} fontSize={9.5} textAnchor="end" fill="rgba(255,255,255,.85)">{total > 0 ? `${connected}/${total}` : ''} {d.type_name.length > 26 ? d.type_name.slice(0, 24) + '…' : d.type_name}</text>
            {d.height_u > 1 && d.name && <text x={GUTTER + RAIL + 12} y={28} fontSize={9.5} fill="rgba(255,255,255,.8)">{d.name}</text>}
            <title>{d.code} {d.name} — {d.type_name}, U{d.position_u}{d.height_u > 1 ? `–U${topU}` : ''}</title>
          </g>
        );
      })}
    </svg>
  );
}

// ---------- Port detail ----------
function PortDetail({ port, device, rack, canEdit, onChanged, onConnect, onTrace }: { port: Port; device: Device; rack: RackDetail; canEdit: boolean; onChanged: () => Promise<unknown>; onConnect: () => void; onTrace: () => void }) {
  const toast = useToast();
  const [renaming, setRenaming] = useState(false); const [name, setName] = useState(port.name);
  const [disc, setDisc] = useState(false);
  useEffect(() => { setName(port.name); setRenaming(false); }, [port.id, port.name]);
  const setVlan = async (v: string) => { try { await api.patch(`/ports/${port.id}`, { vlan_id: v ? Number(v) : null }); await onChanged(); } catch (e) { toast(errMsg(e), 'error'); } };
  const c = port.connection;
  return (
    <div className="port-detail">
      <h3 style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="code">{device.code}:{port.name}</span><Badge>{port.face}</Badge><Badge>{port.kind}</Badge>
        {port.passthrough_port_id && <span className="muted small">pass-through to {port.face === 'front' ? 'rear' : 'front'} {port.name}</span>}
      </h3>
      <dl className="kv">
        <dt>Connected to</dt>
        <dd>{c ? <><Link to={`/racks/${c.rack_id}?device=${c.device_id}`}><span className="muted">{c.site_code}/{c.rack_code}/</span><span className="code">{c.device_code}</span>:{c.port_name}</Link> <span className="muted">({c.port_face})</span>
          {(c.cable_type || c.color || c.label) && <div className="muted small">{c.color && <span className="swatch" style={{ background: cssColor(c.color) }} />}{[c.cable_type, c.color, c.label, c.length_m != null ? `${c.length_m} m` : ''].filter(Boolean).join(' · ')}</div>}</> : <span className="muted">Not connected</span>}</dd>
        {['rj45', 'sfp', 'sfp+', 'qsfp'].includes(port.kind) && <><dt>VLAN</dt><dd>
          {canEdit ? <select value={port.vlan_id ?? ''} onChange={(e) => setVlan(e.target.value)} style={{ maxWidth: 260 }}><option value="">— none —</option>{rack.vlans.map((v) => <option key={v.id} value={v.id}>{v.vid} {v.name}</option>)}</select>
            : <span>{port.vlan_vid != null ? `${port.vlan_vid} ${port.vlan_name}` : '—'}</span>}
          {rack.vlans.length === 0 && canEdit && <div className="muted small">Define VLANs on the <Link to={`/sites/${rack.site_id}`}>site page</Link>.</div>}
        </dd></>}
      </dl>
      <div className="btn-row">
        {canEdit && !c && <button className="btn btn-sm btn-primary" onClick={onConnect}>Connect…</button>}
        {canEdit && c && <button className="btn btn-sm" onClick={() => setDisc(true)}>Disconnect</button>}
        {(c || port.passthrough_port_id) && <button className="btn btn-sm" onClick={onTrace}>Trace path</button>}
        {canEdit && !renaming && <button className="btn btn-sm btn-ghost" onClick={() => setRenaming(true)}>Rename</button>}
      </div>
      {renaming && <Form submitLabel="Rename" onCancel={() => setRenaming(false)} onSubmit={async () => { await api.patch(`/ports/${port.id}`, { name }); await onChanged(); setRenaming(false); }}>
        <Field label="Port name" hint="Unique per face. Connections follow the rename."><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      </Form>}
      <Confirm open={disc} onClose={() => setDisc(false)} title="Disconnect" text={`Remove the cable between ${device.code}:${port.name} and ${c?.device_code}:${c?.port_name}?`}
        onConfirm={async () => { await api.del(`/connections/${c!.connection_id}`); await onChanged(); }} />
    </div>
  );
}

// ---------- Connect ----------
function ConnectForm({ port, device, rack, onDone }: { port: Port; device: Device; rack: RackDetail; onDone: () => void }) {
  const [q, setQ] = useState(''); const [scope, setScope] = useState<'rack' | 'all'>('rack');
  const [target, setTarget] = useState<PortSearchRow | null>(null);
  const [cable, setCable] = useState(''); const [color, setColor] = useState(''); const [label, setLabel] = useState(''); const [length, setLength] = useState('');
  const results = useQuery({ queryKey: ['portsearch', q, scope, rack.id], queryFn: () => api.get<PortSearchRow[]>(`/ports/search?q=${encodeURIComponent(q)}${scope === 'rack' ? `&rack_id=${rack.id}` : ''}`) });
  const rows = (results.data ?? []).filter((r) => r.id !== port.id);
  return (
    <Form submitLabel="Connect" onCancel={onDone} onSubmit={async () => {
      if (!target) throw new Error('Pick a port to connect to');
      await api.post('/connections', { port_a_id: port.id, port_b_id: target.id, cable_type: cable, color, label, length_m: length ? Number(length) : null }); onDone();
    }}>
      <div className="muted">From <span className="code">{device.code}:{port.name}</span> ({port.face}, {port.kind}) to:</div>
      <div className="form-row"><input placeholder="Search device or port, e.g. PP01:12 or SW01" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div className="seg"><button type="button" className={scope === 'rack' ? 'active' : ''} onClick={() => setScope('rack')}>This rack</button><button type="button" className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>All sites</button></div></div>
      <div className="port-results">
        {rows.length === 0 && <div className="muted" style={{ padding: 10 }}>{results.isLoading ? 'Searching…' : 'No ports match.'}</div>}
        {rows.map((r) => (
          <div key={r.id} className={`port-result${target?.id === r.id ? ' selected' : ''}${r.connected ? ' taken' : ''}`} onClick={() => !r.connected && setTarget(r)}>
            <span><span className="muted">{r.site_code}/{r.rack_code}/</span><span className="code">{r.device_code}:{r.name}</span> <span className="muted small">{r.face} · {r.kind}</span></span>
            <span className="muted small">{r.connected ? 'in use' : r.type_name}</span>
          </div>
        ))}
      </div>
      {target && <div>Connecting to <span className="code">{target.device_code}:{target.name}</span> in {target.site_code}/{target.rack_code}</div>}
      <div className="form-row">
        <Field label="Cable type"><input list="cable-types" value={cable} onChange={(e) => setCable(e.target.value)} placeholder="Cat6, OM4, DAC…" /><datalist id="cable-types"><option value="Cat5e" /><option value="Cat6" /><option value="Cat6a" /><option value="OM3" /><option value="OM4" /><option value="OS2" /><option value="DAC" /><option value="Power" /></datalist></Field>
        <Field label="Colour"><input list="cable-colors" value={color} onChange={(e) => setColor(e.target.value)} placeholder="blue" /><datalist id="cable-colors"><option value="blue" /><option value="red" /><option value="green" /><option value="yellow" /><option value="orange" /><option value="grey" /><option value="black" /><option value="white" /><option value="purple" /></datalist></Field>
      </div>
      <div className="form-row">
        <Field label="Cable label"><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. C-0123" /></Field>
        <Field label="Length (m)"><input type="number" step="0.1" min="0" value={length} onChange={(e) => setLength(e.target.value)} /></Field>
      </div>
    </Form>
  );
}

// ---------- Trace ----------
function TraceView({ portId }: { portId: number }) {
  const q = useQuery({ queryKey: ['trace', portId], queryFn: () => api.get<Trace>(`/ports/${portId}/trace`) });
  if (q.isLoading) return <Loading />; if (q.error) return <ErrorBox error={q.error} />;
  const t = q.data!;
  return (
    <div>
      <div className="muted">{t.cable_count} cable{t.cable_count === 1 ? '' : 's'} · <span className="code">{t.endpoints.a.device_code}:{t.endpoints.a.name}</span> ⇄ <span className="code">{t.endpoints.b.device_code}:{t.endpoints.b.name}</span></div>
      <div className="trace">
        {t.steps.map((s, i) => s.kind === 'port' ? (
          <div key={i} className={`trace-port${s.port.id === portId ? ' start' : ''}`}>
            <div><Link to={`/racks/${s.port.rack_id}?device=${s.port.device_id}`}><span className="muted">{s.port.site_code}/{s.port.rack_code}/</span><span className="code">{s.port.device_code}:{s.port.name}</span></Link> <span className="muted small">{s.port.face} · {s.port.kind}{s.port.vlan_vid != null && ` · VLAN ${s.port.vlan_vid}`}</span></div>
            <div className="muted small">{s.port.type_name}{s.port.device_name && ` · ${s.port.device_name}`}</div>
          </div>
        ) : s.kind === 'cable' ? (
          <div key={i} className="trace-link">{s.connection.color && <span className="swatch" style={{ background: cssColor(s.connection.color) }} />}cable {[s.connection.cable_type, s.connection.label, s.connection.length_m != null ? `${s.connection.length_m} m` : ''].filter(Boolean).join(' · ') || '(no details)'}</div>
        ) : (
          <div key={i} className="trace-link">pass-through inside {s.device_code}</div>
        ))}
      </div>
    </div>
  );
}

// ---------- Rack connections ----------
function RackConnections({ rackId }: { rackId: number }) {
  const q = useQuery({ queryKey: ['connections', 'rack', rackId], queryFn: () => api.get<ConnectionRow[]>(`/connections?rack_id=${rackId}`) });
  if (q.isLoading) return <Loading />; if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data?.length) return <div className="muted">No connections in this rack yet.</div>;
  return <div style={{ overflow: 'auto' }}><ConnectionsTable rows={q.data} hideRack={rackId} /></div>;
}

// ---------- Add / edit / move device ----------
const PREFIX: Record<string, string> = { switch: 'SW', router: 'RTR', firewall: 'FW', patch_panel: 'PP', server: 'SRV', storage: 'STO', pdu: 'PDU', ups: 'UPS', other: 'DEV' };

function AddDeviceForm({ rack, position, onDone }: { rack: RackDetail; position: number; onDone: () => void }) {
  const types = useQuery({ queryKey: ['device-types'], queryFn: () => api.get<DeviceType[]>('/device-types') });
  const [filter, setFilter] = useState(''); const [type, setType] = useState<DeviceType | null>(null);
  const [code, setCode] = useState(''); const [name, setName] = useState(''); const [pos, setPos] = useState(position);
  const [serial, setSerial] = useState(''); const [ip, setIp] = useState(''); const [notes, setNotes] = useState('');
  const pick = (t: DeviceType) => {
    setType(t);
    const prefix = PREFIX[t.category] ?? 'DEV';
    const used = new Set(rack.devices.map((d) => d.code));
    let n = 1; while (used.has(`${prefix}${String(n).padStart(2, '0')}`)) n++;
    if (!code || /^[A-Z]+\d{2}$/.test(code)) setCode(`${prefix}${String(n).padStart(2, '0')}`);
    if (t.height_u > 1) setPos(firstFreeAtOrBelow(rack, pos, t.height_u));
  };
  const f = filter.toLowerCase();
  const list = (types.data ?? []).filter((t) => !f || `${t.name} ${t.manufacturer} ${t.model} ${t.category}`.toLowerCase().includes(f));
  return (
    <Form submitLabel="Add device" onCancel={onDone} onSubmit={async () => {
      if (!type) throw new Error('Choose a device type');
      await api.post(`/racks/${rack.id}/devices`, { device_type_id: type.id, code, name, position_u: Number(pos), serial, ip_address: ip, notes }); onDone();
    }}>
      <Field label="Device type" hint={<span>Manage templates in the <Link to="/device-types">device library</Link>.</span>}>
        <input placeholder="Filter types…" value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
      </Field>
      <div className="type-list">{list.map((t) => (
        <div key={t.id} className={`type-row${type?.id === t.id ? ' selected' : ''}`} onClick={() => pick(t)}>
          <span className="type-color" style={{ background: t.color }} /><span style={{ flex: 1 }}>{t.name}{(t.manufacturer || t.model) && <span className="muted"> · {t.manufacturer} {t.model}</span>}</span>
          <span className="muted small">{t.height_u}U · {t.port_count} ports{t.passthrough ? ' · pass-through' : ''}</span>
        </div>
      ))}</div>
      <div className="form-row">
        <Field label="Device ID" hint="Unique within the rack"><input value={code} onChange={(e) => setCode(e.target.value)} required /></Field>
        <Field label="Bottom position (U)" hint={type ? `Occupies U${pos}–U${pos + type.height_u - 1}` : ''}><input type="number" min={1} max={rack.height_u} value={pos} onChange={(e) => setPos(Number(e.target.value))} required /></Field>
      </div>
      <Field label="Name / description"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Core switch A" /></Field>
      <div className="form-row">
        <Field label="Serial number"><input value={serial} onChange={(e) => setSerial(e.target.value)} /></Field>
        <Field label="IP address"><input value={ip} onChange={(e) => setIp(e.target.value)} /></Field>
      </div>
      <Field label="Notes"><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Form>
  );
}

function firstFreeAtOrBelow(rack: RackDetail, from: number, height: number) {
  const occ = new Set<number>();
  for (const d of rack.devices) for (let u = d.position_u; u < d.position_u + d.height_u; u++) occ.add(u);
  const fits = (u: number) => { if (u < 1 || u + height - 1 > rack.height_u) return false; for (let k = 0; k < height; k++) if (occ.has(u + k)) return false; return true; };
  if (fits(from)) return from;
  for (let u = from - 1; u >= 1; u--) if (fits(u)) return u;
  for (let u = from + 1; u <= rack.height_u; u++) if (fits(u)) return u;
  return from;
}

function EditDeviceForm({ device, onDone }: { device: Device; onDone: () => void }) {
  const [code, setCode] = useState(device.code); const [name, setName] = useState(device.name); const [pos, setPos] = useState(device.position_u);
  const [serial, setSerial] = useState(device.serial); const [ip, setIp] = useState(device.ip_address); const [notes, setNotes] = useState(device.notes);
  return (
    <Form onCancel={onDone} onSubmit={async () => { await api.patch(`/devices/${device.id}`, { code, name, position_u: Number(pos), serial, ip_address: ip, notes }); onDone(); }}>
      <div className="muted">{device.type_name} · {device.height_u}U</div>
      <div className="form-row">
        <Field label="Device ID"><input value={code} onChange={(e) => setCode(e.target.value)} required autoFocus /></Field>
        <Field label="Bottom position (U)"><input type="number" min={1} value={pos} onChange={(e) => setPos(Number(e.target.value))} required /></Field>
      </div>
      <Field label="Name / description"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="form-row">
        <Field label="Serial number"><input value={serial} onChange={(e) => setSerial(e.target.value)} /></Field>
        <Field label="IP address"><input value={ip} onChange={(e) => setIp(e.target.value)} /></Field>
      </div>
      <Field label="Notes"><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Form>
  );
}

function MoveDeviceForm({ device, onDone }: { device: Device; onDone: () => void }) {
  const racks = useQuery({ queryKey: ['racks'], queryFn: () => api.get<{ id: number; code: string; site_code: string; room_code: string; height_u: number }[]>('/racks') });
  const [rackId, setRackId] = useState<number>(device.rack_id); const [pos, setPos] = useState(device.position_u);
  const connected = device.ports.filter((p) => p.connection).length;
  return (
    <Form submitLabel="Move" onCancel={onDone} onSubmit={async () => { await api.patch(`/devices/${device.id}`, { rack_id: rackId, position_u: Number(pos) }); onDone(); }}>
      {connected > 0 && <div className="muted">{connected} connection(s) will be kept and follow the device.</div>}
      <Field label="Target rack"><select value={rackId} onChange={(e) => setRackId(Number(e.target.value))}>{racks.data?.map((r) => <option key={r.id} value={r.id}>{r.site_code} / {r.room_code} / {r.code} ({r.height_u}U)</option>)}</select></Field>
      <Field label="Bottom position (U)"><input type="number" min={1} value={pos} onChange={(e) => setPos(Number(e.target.value))} required /></Field>
    </Form>
  );
}
