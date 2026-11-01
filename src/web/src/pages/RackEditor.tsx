import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ZoomIn, ZoomOut, Maximize, EyeOff, Eye, Keyboard, BookOpen, Search, MoreVertical, Scan, PanelBottom, Undo2, Redo2, X } from 'lucide-react';
import { api, fmtDate } from '../lib/api';
import { useCanEdit } from '../lib/auth';
import type { Connection, Device, DeviceDetail, Port, RackDetail, Template, Vlan } from '../lib/types';
import { usePageHeader } from '../components/Shell';
import { Confirm, Dialog, ErrorBox, Field, Form, IconBtn, Loading, Menu, SaveStatus, Tabs, errMsg, useToast } from '../components/ui';
import { ConnectionConfigurator, ConnectionsTable, DeviceSettings, useTypes } from '../components/editor';
import { ShortcutsHelp } from './LocationView';
import { panelLayout } from './DeviceLibrary';
import { zoomAt, type View } from '../components/canvas';

const UH = 22; const RW = 440; const LEFT = 44; const RAIL = 12; const PAD = 22; const PAD_TOP = 36; const GUT = 76; const CAP = 5;
const INNER = RW - RAIL * 2 - 2; // usable width inside the rails
const snapSlot = (x: number, width: number) => Math.max(0, Math.min(100 - width, Math.round((x * 12) / 100) * (100 / 12)));
const panelX = (d: { slot_x: number }) => LEFT + RAIL + 1 + (INNER * d.slot_x) / 100;
const panelW = (d: { width_pct: number }) => (INNER * d.width_pct) / 100;
type Face = 'front' | 'rear';
type RackDevice = Device & { ports: Port[] };

export function RackEditor() {
  const id = Number(useParams().id); const nav = useNavigate(); const qc = useQueryClient(); const toast = useToast(); const canEdit = useCanEdit();
  const [sp, setSp] = useSearchParams();
  const q = useQuery({ queryKey: ['rack', id], queryFn: () => api.get<RackDetail>(`/racks/${id}`) });
  const tpls = useQuery({ queryKey: ['templates'], queryFn: () => api.get<Template[]>('/templates') }); const types = useTypes();
  const conns = useQuery({ queryKey: ['connections', 'rack', id], queryFn: () => api.get<Connection[]>(`/connections?rack_id=${id}`) });
  const [face, setFace] = useState<Face>('front'); const [selDev, setSelDev] = useState<number | null>(null); const [selPort, setSelPort] = useState<number | null>(null);
  const [view, setView] = useState<View>({ k: 1, tx: 0, ty: 0 }); const [fitMode, setFitMode] = useState<'height' | 'width'>('height');
  const [panelsHidden, setPanelsHidden] = useState(false); const [sidebarHidden, setSidebarHidden] = useState(false); const [bottomOpen, setBottomOpen] = useState(false); const [bottomTab, setBottomTab] = useState('devices'); const [connFilter, setConnFilter] = useState('all');
  const [hlVlan, setHlVlan] = useState<Vlan | null>(null); const [hoverChain, setHoverChain] = useState<Set<number> | null>(null);
  const [status, setStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [modal, setModal] = useState<null | { kind: 'add'; position: number; templateId?: number } | { kind: 'delDev'; dev: RackDevice } | { kind: 'disc'; port: Port } | { kind: 'shortcuts' } | { kind: 'delRack' } | { kind: 'configure'; fromDev: RackDevice; fromPort: Port; targetDev: number }>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['rack', id] }), qc.invalidateQueries({ queryKey: ['connections'] }), qc.invalidateQueries({ queryKey: ['device'] }), qc.invalidateQueries({ queryKey: ['racks'] }), qc.invalidateQueries({ queryKey: ['floor-view'] })]);
  useEffect(() => { const d = sp.get('device'); if (d) { setSelDev(Number(d)); sp.delete('device'); setSp(sp, { replace: true }); } }, [sp, setSp]);
  const rack = q.data;
  usePageHeader({ title: rack?.name || rack?.code || '…', crumbs: [{ label: 'Locations', to: '/locations' }, { label: rack?.location_code ?? '', to: `/locations/${rack?.location_id}` }, { label: rack?.floor_code ?? '', to: `/floors/${rack?.floor_id}` }, { label: rack?.code ?? '' }], full: true,
    actions: <><IconBtn title={sidebarHidden ? 'Show settings sidebar' : 'Hide settings sidebar'} onClick={() => setSidebarHidden(!sidebarHidden)}>{sidebarHidden ? <Eye size={15} /> : <EyeOff size={15} />}</IconBtn><IconBtn title="Keyboard shortcuts" onClick={() => setModal({ kind: 'shortcuts' })}><Keyboard size={15} /></IconBtn><a className="icon-btn" href="https://github.com/damiankw/patching#readme" target="_blank" rel="noreferrer" title="Documentation"><BookOpen size={15} /></a></> }, [rack?.id, rack?.name, sidebarHidden]);
  const selectedDevice = rack?.devices.find((d) => d.id === selDev) ?? null;
  const selectedPort = selectedDevice?.ports.find((p) => p.id === selPort) ?? null;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement; if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'h') { e.preventDefault(); setPanelsHidden((v) => !v); }
      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedPort?.user_peer && canEdit) { e.preventDefault(); setModal({ kind: 'disc', port: selectedPort }); }
      if (e.key === 'Escape') { setHlVlan(null); }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [selectedPort, canEdit]);
  const act = async (fn: () => Promise<unknown>) => { setStatus('saving'); try { await fn(); await refresh(); setStatus('saved'); } catch (e) { setStatus('error'); toast(errMsg(e), 'error'); } };
  if (q.isLoading || !rack) return q.error ? <ErrorBox error={q.error} /> : <Loading />;
  const portById = new Map<number, { port: Port; dev: RackDevice }>(); for (const d of rack.devices) for (const p of d.ports) portById.set(p.id, { port: p, dev: d });
  const vlanPorts = hlVlan ? new Set(rack.devices.flatMap((d) => d.ports.filter((p) => p.vlan_id === hlVlan.id).map((p) => p.id))) : null;
  const connRows = (conns.data ?? []).filter((c) => connFilter === 'all' || (connFilter === 'in' ? c.a.rack_id === id && c.b.rack_id === id : c.a.rack_id !== id || c.b.rack_id !== id));

  return <div className={`editor wide-editor${sidebarHidden ? ' sidebar-hidden' : ''}`}>
    <div className="editor-body">
      {!panelsHidden && <TemplatePalette templates={tpls.data ?? []} canEdit={canEdit} />}
      {!panelsHidden && <div className="palette-rail"><span className="rail-label">DEVICES</span></div>}
      <div className="canvas-area">
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          <div className="tool-col"><IconBtn title="Zoom in" onClick={() => setView(zoomAt(view, 1.25, RW / 2, 0))}><ZoomIn size={15} /></IconBtn><IconBtn title="Zoom out" onClick={() => setView(zoomAt(view, 0.8, RW / 2, 0))}><ZoomOut size={15} /></IconBtn><IconBtn title="Reset zoom and position" onClick={() => setView({ k: 1, tx: 0, ty: 0 })}><Scan size={15} /></IconBtn><IconBtn title={fitMode === 'height' ? 'Fit to width' : 'Fit to height'} onClick={() => { setFitMode(fitMode === 'height' ? 'width' : 'height'); setView({ k: 1, tx: 0, ty: 0 }); }}><Maximize size={15} /></IconBtn><div className="tool-sep" /><IconBtn title="Undo (not available)" disabled><Undo2 size={15} /></IconBtn><IconBtn title="Redo (not available)" disabled><Redo2 size={15} /></IconBtn></div>
          <div className="canvas-topcenter" style={{ left: 70, transform: 'none' }}><div className="seg"><button className={face === 'front' ? 'active' : ''} onClick={() => setFace('front')}>Front</button><button className={face === 'rear' ? 'active' : ''} onClick={() => setFace('rear')}>Back</button></div></div>
          <div className="canvas-topright">{hlVlan && <span className="vlan-pill">VLAN {hlVlan.vid} · {hlVlan.name} · {vlanPorts?.size} ports<button onClick={() => setHlVlan(null)}><X size={12} /></button></span>}<SaveStatus status={status} /></div>
          <RackCanvas rack={rack} face={face} view={view} setView={setView} fitMode={fitMode} selDev={selDev} selPort={selPort} canEdit={canEdit} hoverChain={hoverChain} setHoverChain={setHoverChain} vlanPorts={vlanPorts} conns={conns.data ?? []}
            onSelectDevice={(d) => { setSelDev(d); setSelPort(null); }} onSelectPort={(dev, p) => { setSelDev(dev); setSelPort(p); }} onEmptyClick={(u) => canEdit && setModal({ kind: 'add', position: u })}
            onDropTemplate={(tplId, u) => setModal({ kind: 'add', position: u, templateId: tplId })} onMoveDevice={(devId, u, slotX) => act(() => api.patch(`/devices/${devId}`, { position_u: u, slot_x: slotX }))}
            onConnect={(a, b) => act(() => api.post('/connections', { port_a_id: a, port_b_id: b, type: 'user' }))} onClearVlan={() => setHlVlan(null)} onWireToDevice={(fromPort, deviceId) => { const from = portById.get(fromPort); if (from) setModal({ kind: 'configure', fromDev: from.dev, fromPort: from.port, targetDev: deviceId }); }} onKeystoneMissing={(p, d) => { setSelDev(d.id); setSelPort(p.id); toast(`${d.code} port ${p.name} has no building connection yet. Use "Manage building connections" in the sidebar to record the cable from this port to a wall outlet, then patch it.`, 'error'); }} />
        </div>
        {!panelsHidden && <div className="bottom-panel">
          <div className="bottom-head" onClick={() => setBottomOpen(!bottomOpen)}><PanelBottom size={14} /><span>DEVICES & CONNECTIONS</span>{bottomOpen && <span onClick={(e) => e.stopPropagation()}><Tabs pill tabs={[{ id: 'devices', label: 'DEVICES' }, { id: 'connections', label: 'CONNECTIONS' }, { id: 'vlans', label: 'VLANS' }]} value={bottomTab} onChange={setBottomTab} /></span>}<span className="grow" /></div>
          {bottomOpen && <div className="bottom-body">
            {bottomTab === 'devices' && <table className="table"><thead><tr><th>ID</th><th>Name</th><th>Side</th><th>Unit</th><th>Type</th><th>Template</th><th>Created</th></tr></thead><tbody>{rack.devices.map((d) => <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => { setSelDev(d.id); setSelPort(null); }}><td className="code">{d.code}</td><td>{d.name || <span className="muted">-</span>}</td><td>{d.ports.some((p) => p.face === 'rear') && !d.ports.some((p) => p.face === 'front') ? 'Back' : 'Front'}</td><td>{d.position_u}</td><td>{d.type_name}</td><td className="muted">{d.template_name}</td><td>{fmtDate(d.created_at)}</td></tr>)}{rack.devices.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 18 }}>Drag a device from the left or click an empty rack unit.</td></tr>}</tbody></table>}
            {bottomTab === 'connections' && <><div className="chip-tabs" style={{ padding: 6 }}><button className={connFilter === 'all' ? 'active' : ''} onClick={() => setConnFilter('all')}>All</button><button className={connFilter === 'in' ? 'active' : ''} onClick={() => setConnFilter('in')}>Within rack</button><button className={connFilter === 'out' ? 'active' : ''} onClick={() => setConnFilter('out')}>Leaving rack</button></div><ConnectionsTable rows={connRows} /></>}
            {bottomTab === 'vlans' && <table className="table"><thead><tr><th>VID</th><th>Name</th><th>Ports in this rack</th><th /></tr></thead><tbody>{rack.vlans.map((v) => <tr key={v.id} style={{ cursor: 'pointer' }} className={hlVlan?.id === v.id ? 'active' : ''} onClick={() => setHlVlan(hlVlan?.id === v.id ? null : v)}><td className="code">{v.vid}</td><td>{v.name}</td><td>{v.port_count}</td><td className="right"><Link to="/networks/vlans" className="small">All ports</Link></td></tr>)}{rack.vlans.length === 0 && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 18 }}>No VLANs assigned on this rack's ports yet. Select a switch port and pick a VLAN in the sidebar.</td></tr>}</tbody></table>}
          </div>}
        </div>}
      </div>
      <aside className="sidebar-panel">
        <div className="sidebar-title"><span className="code">{selectedDevice ? selectedDevice.path : rack.path}{selectedPort ? `/${selectedPort.name}` : ''}</span>
          <Menu button={<IconBtn title="More"><MoreVertical size={14} /></IconBtn>} items={selectedDevice ? [{ label: 'Copy ID', onClick: () => { navigator.clipboard?.writeText(selectedDevice.path); toast('Copied'); } }, { sep: true, label: '' }, { label: 'Delete device', danger: true, disabled: !canEdit, onClick: () => setModal({ kind: 'delDev', dev: selectedDevice }) }]
            : [{ label: 'Export as PDF', onClick: () => window.open(`/report/rack/${id}`, '_blank') }, { label: 'Export as PNG', onClick: () => exportPng(rack.code) }, { label: 'Export BOM', onClick: () => window.open(`/report/bom/${id}`, '_blank') }, { label: 'Copy ID', onClick: () => { navigator.clipboard?.writeText(rack.path); toast('Copied'); } }, { label: 'Open on floor plan', onClick: () => nav(`/floors/${rack.floor_id}?device=${rack.id}`) }, { sep: true, label: '' }, { label: 'Delete rack', danger: true, disabled: !canEdit, onClick: () => setModal({ kind: 'delRack' }) }]} /></div>
        <div className="palette-rail" style={{ display: 'none' }} />
        {selectedDevice ? <RackDeviceSidebar key={selectedDevice.id} id={selectedDevice.id} canEdit={canEdit} onChanged={refresh} selPort={selPort} setSelPort={setSelPort} /> : <RackDeviceSidebar key={rack.id} id={rack.id} canEdit={canEdit} onChanged={refresh} selPort={null} setSelPort={() => {}} isRack />}
      </aside>
    </div>
    <Dialog open={modal?.kind === 'add'} onClose={() => setModal(null)} title="Add device" subtitle="Add a device to the rack.">{modal?.kind === 'add' && <AddRackDeviceForm rack={rack} templates={tpls.data ?? []} position={modal.position} templateId={modal.templateId} onDone={async (did) => { setModal(null); await refresh(); if (did) { setSelDev(did); setSelPort(null); } }} />}</Dialog>
    <Confirm open={modal?.kind === 'delDev'} onClose={() => setModal(null)} title="Delete device" text={modal?.kind === 'delDev' ? `Delete ${modal.dev.code} and its connections?` : ''} onConfirm={async () => { if (modal?.kind === 'delDev') { await api.del(`/devices/${modal.dev.id}`); setSelDev(null); await refresh(); } }} />
    <Confirm open={modal?.kind === 'disc'} onClose={() => setModal(null)} title="Disconnect" label="Disconnect" text={modal?.kind === 'disc' ? `Remove the user connection on ${modal.port.path}?` : ''} onConfirm={async () => { if (modal?.kind === 'disc' && modal.port.user_peer) { await api.del(`/connections/${modal.port.user_peer.connection_id}`); await refresh(); } }} />
    <Confirm open={modal?.kind === 'delRack'} onClose={() => setModal(null)} title="Delete rack" text={`Delete ${rack.path} with ${rack.devices.length} devices and their connections?`} onConfirm={async () => { await api.del(`/devices/${rack.id}`); await refresh(); nav(`/floors/${rack.floor_id}`); }} />
    <Dialog open={modal?.kind === 'shortcuts'} onClose={() => setModal(null)} title="Keyboard shortcuts"><ShortcutsHelp /></Dialog>
    <Dialog open={modal?.kind === 'configure'} onClose={() => setModal(null)} title={<>Connection Configurator: <span className="code">{modal?.kind === 'configure' ? modal.fromDev.code : ''}</span></>} subtitle="Pick the port on the other device. Back-side ports are listed too." wide>{modal?.kind === 'configure' && <ConnectionConfigurator device={{ ...modal.fromDev, photos: [], rack_device_count: 0 }} port={modal.fromPort} expandDeviceId={modal.targetDev} onDone={async () => { setModal(null); await refresh(); }} />}</Dialog>
    {void types}
  </div>;
}

function RackDeviceSidebar({ id, canEdit, onChanged, selPort, setSelPort, isRack }: { id: number; canEdit: boolean; onChanged: () => Promise<unknown>; selPort: number | null; setSelPort: (v: number | null) => void; isRack?: boolean }) {
  const q = useQuery({ queryKey: ['device', id], queryFn: () => api.get<DeviceDetail>(`/devices/${id}`) });
  if (!q.data) return <Loading />;
  return <DeviceSettings device={q.data} canEdit={canEdit} onChanged={async () => { await q.refetch(); await onChanged(); }} selectedPortId={selPort} onSelectPort={setSelPort} isRackEditor={isRack} />;
}

function TemplatePalette({ templates, canEdit }: { templates: Template[]; canEdit: boolean }) {
  const [q, setQ] = useState('');
  const groups = useMemo(() => { const m = new Map<string, Template[]>(); for (const t of templates) { if (q && !`${t.name} ${t.brand} ${t.type_name}`.toLowerCase().includes(q.toLowerCase())) continue; m.set(t.type_name, [...(m.get(t.type_name) ?? []), t]); } return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])); }, [templates, q]);
  return <div className="palette-panel"><div className="palette-head"><h3>Devices</h3><div className="muted tiny">Drag device to a rack unit to add it. Narrow devices can share a unit; put a Rack Tray in first for shelf-mounted gear. To patch, drag from port to port, or drop the cable on a device.</div><div style={{ position: 'relative', marginTop: 6 }}><Search size={12} className="muted" style={{ position: 'absolute', left: 7, top: 8 }} /><input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 22, fontSize: 12 }} /></div></div>
    <div className="palette-list-items">{groups.map(([type, list]) => <div key={type}><div className="palette-group-label">{type}</div>{list.map((t) => <div key={t.id} className="palette-item-dev" draggable={canEdit} onDragStart={(e) => { e.dataTransfer.setData('text/rd-template', String(t.id)); e.dataTransfer.effectAllowed = 'copy'; }} title={`${t.height_u}U · ${t.ports.length} ports`}><span style={{ flex: 1 }}>{t.name}</span><span className="muted tiny">{t.height_u}U</span></div>)}</div>)}</div></div>;
}

/** Polyline → path with rounded corners (radius r). */
function roundedPath(pts: [number, number][], r = 4) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1], [cx, cy] = pts[i], [nx, ny] = pts[i + 1];
    const d1 = Math.hypot(cx - px, cy - py), d2 = Math.hypot(nx - cx, ny - cy); const rr = Math.min(r, d1 / 2, d2 / 2);
    const ax = cx - ((cx - px) / d1) * rr, ay = cy - ((cy - py) / d1) * rr; const bx = cx + ((nx - cx) / d2) * rr, by = cy + ((ny - cy) / d2) * rr;
    d += ` L ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`;
  }
  const [lx, ly] = pts[pts.length - 1]; return `${d} L ${lx} ${ly}`;
}
/** Connector glyph by port kind, drawn in an s×s box with its origin at the top-left. */
function PortGlyph({ kind, s, fill, stroke, dashed }: { kind: string; s: number; fill: string; stroke: string; dashed?: boolean }) {
  const common = { fill, stroke, strokeWidth: 1, vectorEffect: 'non-scaling-stroke' as const, strokeDasharray: dashed ? '2 1.5' : undefined };
  if (kind === 'power') return <circle cx={s / 2} cy={s / 2} r={s / 2} {...common} />;
  if (kind === 'sfp' || kind === 'sfp+' || kind === 'qsfp') return <rect x={0} y={s * 0.15} width={s} height={s * 0.7} rx={1} {...common} />;
  if (kind === 'lc' || kind === 'sc' || kind === 'e2000' || kind === 'mpo') return <g><rect x={0} y={0} width={s} height={s} rx={1} {...common} /><circle cx={s * 0.32} cy={s / 2} r={s * 0.14} fill={stroke} /><circle cx={s * 0.68} cy={s / 2} r={s * 0.14} fill={stroke} /></g>;
  // RJ45: square body with the latch tab at the bottom
  const t = s * 0.28;
  return <path d={`M 1 0 H ${s - 1} Q ${s} 0 ${s} 1 V ${s - t} H ${s * 0.72} V ${s} H ${s * 0.28} V ${s - t} H 0 V 1 Q 0 0 1 0 Z`} {...common} />;
}

function RackCanvas({ rack, face, view, setView, fitMode, selDev, selPort, canEdit, hoverChain, setHoverChain, vlanPorts, conns, onSelectDevice, onSelectPort, onEmptyClick, onDropTemplate, onMoveDevice, onConnect, onClearVlan, onKeystoneMissing, onWireToDevice }: {
  rack: RackDetail; face: Face; view: View; setView: (v: View) => void; fitMode: 'height' | 'width'; selDev: number | null; selPort: number | null; canEdit: boolean; hoverChain: Set<number> | null; setHoverChain: (s: Set<number> | null) => void; vlanPorts: Set<number> | null; conns: Connection[];
  onSelectDevice: (id: number | null) => void; onSelectPort: (dev: number, port: number) => void; onEmptyClick: (u: number) => void; onDropTemplate: (tplId: number, u: number) => void; onMoveDevice: (devId: number, u: number, slotX: number) => void; onConnect: (a: number, b: number) => void; onClearVlan: () => void; onKeystoneMissing: (p: Port, dev: RackDevice) => void; onWireToDevice: (fromPort: number, deviceId: number) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const H = rack.height_u * UH + PAD + PAD_TOP; const W = LEFT + RW + GUT;
  const [drag, setDrag] = useState<null | { kind: 'pan'; sx: number; sy: number; v: View } | { kind: 'device'; id: number; startX: number; startY: number; dx: number; dy: number } | { kind: 'wire'; from: number; x: number; y: number }>(null);
  const [dropU, setDropU] = useState<number | null>(null);
  const [pxPerUnit, setPxPerUnit] = useState(1);
  const yOfTop = (topU: number) => PAD_TOP + (rack.height_u - topU) * UH;
  const scale = () => { const r = svgRef.current!.getBoundingClientRect(); return fitMode === 'height' ? Math.min(r.width / W, r.height / H) : r.width / W; };
  useEffect(() => { const el = svgRef.current; if (!el) return; const upd = () => setPxPerUnit(scale() * view.k); upd(); const ro = new ResizeObserver(upd); ro.observe(el); return () => ro.disconnect(); }, [view.k, fitMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const toSvg = (e: { clientX: number; clientY: number }) => { const r = svgRef.current!.getBoundingClientRect(); const s = scale(); const ox = fitMode === 'height' ? (r.width - W * s) / 2 : 0; return { x: ((e.clientX - r.left - ox) / s - view.tx) / view.k, y: ((e.clientY - r.top) / s - view.ty) / view.k }; };
  const unitAt = (y: number) => Math.max(1, Math.min(rack.height_u, Math.ceil((H - PAD - y) / UH)));
  const occupied = useMemo(() => { const m = new Map<number, RackDevice>(); for (const d of rack.devices) { if (d.is_tray || d.width_pct < 100) continue; for (let u = d.position_u ?? 0; u < (d.position_u ?? 0) + d.height_u; u++) m.set(u, d); } return m; }, [rack]);
  const labelWOf = (pw: number) => (pw < 200 ? 12 : 20);
  // port geometry (port id -> {x,y,s})
  const geom = useMemo(() => {
    const g = new Map<number, { x: number; y: number; s: number; dev: RackDevice; port: Port }>();
    for (const d of rack.devices) {
      const ports = d.ports.filter((p) => p.face === face && p.kind !== 'wireless'); if (!ports.length) continue;
      const h = d.height_u * UH; const pw = panelW(d); const labelW = labelWOf(pw); const avail = pw - labelW - 12;
      const maxRows = Math.max(1, Math.min(d.height_u * 2, 4)); let rows = 1; while (Math.ceil(ports.length / rows) * 11 > avail && rows < maxRows) rows++;
      const cols = Math.ceil(ports.length / rows); const cell = Math.min(18, avail / cols); const rowH = (h - 6) / rows; const s = Math.max(4, Math.min(cell - 3, rowH - 5)); const top = yOfTop((d.position_u ?? 1) + d.height_u - 1);
      const x0 = panelX(d) + labelW + 6 + (avail - cols * cell) / 2 + (cell - s) / 2;
      ports.forEach((p, i) => { const r = Math.floor(i / cols), c = i % cols; g.set(p.id, { x: x0 + c * cell, y: top + 3 + r * rowH + (rowH - s) / 2 + 1, s, dev: d, port: p }); });
    }
    return g;
  }, [rack, face]); // eslint-disable-line react-hooks/exhaustive-deps
  const rightX = LEFT + RW + 8;
  const wires = useMemo(() => {
    const list = conns.filter((c) => c.type === 'user' && geom.has(c.port_a_id) && geom.has(c.port_b_id)).map((c) => ({ c, a: geom.get(c.port_a_id)!, b: geom.get(c.port_b_id)! }));
    // shorter spans take inner lanes so cables cross as little as possible
    return list.sort((p, q) => Math.abs(p.a.y - p.b.y) - Math.abs(q.a.y - q.b.y)).map((w, i) => ({ ...w, lane: 6 + (i % 11) * 6 }));
  }, [conns, geom]);
  const outbound = conns.filter((c) => c.type === 'user' && (geom.has(c.port_a_id) !== geom.has(c.port_b_id))).map((c) => ({ c, g: geom.get(geom.has(c.port_a_id) ? c.port_a_id : c.port_b_id)! }));
  const chainOf = (p: Port) => new Set(p.chain?.steps.map((s) => s.port_id) ?? [p.id]);
  const portFill = (p: Port, dev: RackDevice) => { if (dev.passive && !p.keystone) return 'var(--surface)'; if (p.state === 'complete') return 'var(--port-complete)'; if (p.state === 'incomplete') return 'var(--port-incomplete)'; return dev.passive ? 'var(--port-keystone)' : 'var(--surface)'; };
  const onDown = (e: RPointerEvent<SVGSVGElement>) => { if (e.button !== 0) return; setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, v: view }); };
  const onMove = (e: RPointerEvent<SVGSVGElement>) => { if (!drag) return; if (drag.kind === 'pan') { const s = scale(); setView({ ...drag.v, tx: drag.v.tx + (e.clientX - drag.sx) / s, ty: drag.v.ty + (e.clientY - drag.sy) / s }); } else if (drag.kind === 'device') setDrag({ ...drag, dx: (e.clientX - drag.startX) / (scale() * view.k), dy: (e.clientY - drag.startY) / (scale() * view.k) }); else if (drag.kind === 'wire') { const p = toSvg(e); setDrag({ ...drag, x: p.x, y: p.y }); } };
  const onUp = (e: RPointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    if (drag.kind === 'pan') { if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) { onSelectDevice(null); onClearVlan(); } }
    else if (drag.kind === 'device') { const d = rack.devices.find((x) => x.id === drag.id)!; const moved = Math.round(drag.dy / UH); const slot = snapSlot(d.slot_x + (drag.dx / INNER) * 100, d.width_pct); onSelectDevice(d.id); if (moved !== 0 || slot !== d.slot_x) onMoveDevice(d.id, Math.max(1, Math.min(rack.height_u - d.height_u + 1, (d.position_u ?? 1) - moved)), slot); }
    else if (drag.kind === 'wire') { const el = document.elementFromPoint(e.clientX, e.clientY) as Element | null; const pid = Number(el?.closest('[data-port]')?.getAttribute('data-port') ?? 0); const did = Number(el?.closest('[data-device]')?.getAttribute('data-device') ?? 0); if (pid && pid !== drag.from) onConnect(drag.from, pid); else if (did && did !== geom.get(drag.from)?.dev.id) onWireToDevice(drag.from, did); }
    setDrag(null);
  };
  const dragY = (d: RackDevice) => drag?.kind === 'device' && drag.id === d.id ? drag.dy : 0;
  const dragX = (d: RackDevice) => drag?.kind === 'device' && drag.id === d.id ? drag.dx : 0;
  const units = Array.from({ length: rack.height_u }, (_, i) => rack.height_u - i);
  const showPortNames = pxPerUnit >= 1.9; const showUnitNumbers = pxPerUnit >= 0.55;
  const ns = { vectorEffect: 'non-scaling-stroke' as const };
  const railX = [LEFT, LEFT + RW - RAIL];
  return <svg ref={svgRef} className="editor-canvas rack-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio={fitMode === 'height' ? 'xMidYMin meet' : 'xMinYMin meet'} style={{ cursor: drag?.kind === 'pan' ? 'grabbing' : 'default' }}
    onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}
    onWheel={(e) => { const p = toSvg(e); setView(zoomAt(view, e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x * view.k + view.tx, p.y * view.k + view.ty)); }}
    onDragOver={(e) => { if (canEdit && e.dataTransfer.types.includes('text/rd-template')) { e.preventDefault(); setDropU(unitAt(toSvg(e).y)); } }} onDragLeave={() => setDropU(null)}
    onDrop={(e) => { setDropU(null); const t = Number(e.dataTransfer.getData('text/rd-template')); if (!t) return; e.preventDefault(); onDropTemplate(t, unitAt(toSvg(e).y)); }}>
    <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`} id="rack-export-root">
      {/* frame: interior, caps, rails with mounting holes, base */}
      <rect x={LEFT + RAIL} y={PAD_TOP} width={RW - RAIL * 2} height={rack.height_u * UH} fill="var(--rack-interior)" />
      <rect x={LEFT - 3} y={PAD_TOP - CAP} width={RW + 6} height={CAP} fill="var(--rack-rail)" stroke="var(--border-strong)" {...ns} />
      <rect x={LEFT - 3} y={PAD_TOP + rack.height_u * UH} width={RW + 6} height={CAP} fill="var(--rack-rail)" stroke="var(--border-strong)" {...ns} />
      <rect x={LEFT + 20} y={PAD_TOP + rack.height_u * UH + CAP} width={RW - 40} height={10} fill="var(--rack-base)" />
      {Array.from({ length: 14 }, (_, i) => <rect key={i} x={LEFT + 60 + i * ((RW - 120) / 14) + 3} y={PAD_TOP + rack.height_u * UH + CAP + 3} width={(RW - 120) / 14 - 6} height={4} fill="var(--surface)" opacity={0.5} />)}
      {railX.map((x) => <rect key={x} x={x} y={PAD_TOP} width={RAIL} height={rack.height_u * UH} fill="var(--rack-rail)" stroke="var(--border-strong)" {...ns} />)}
      {units.map((u) => { const y = yOfTop(u); const occ = occupied.get(u);
        const spans = rack.devices.filter((d) => !d.is_tray && (d.position_u ?? 0) <= u && u <= (d.position_u ?? 0) + d.height_u - 1).map((d) => [d.slot_x, d.slot_x + d.width_pct] as [number, number]).sort((a, b) => a[0] - b[0]);
        let gap: [number, number] = [0, 0]; let cur = 0; for (const [a, b] of spans) { if (a - cur > gap[1] - gap[0]) gap = [cur, a]; cur = Math.max(cur, b); } if (100 - cur > gap[1] - gap[0]) gap = [cur, 100];
        const gapW = gap[1] - gap[0]; const plusX = LEFT + RAIL + 1 + (INNER * (gap[0] + gap[1])) / 200;
        return <g key={u} className="rack-unit">
          {showUnitNumbers && <text x={LEFT - 5} y={y + UH / 2 + 2.5} fontSize={7} textAnchor="end" fill="var(--muted)" fontFamily="var(--mono)" style={{ pointerEvents: 'none' }}>{u}</text>}
          {railX.map((x) => [0.22, 0.5, 0.78].map((f) => <rect key={`${x}-${f}`} x={x + RAIL / 2 - 1.5} y={y + UH * f - 1.5} width={3} height={3} rx={0.6} fill="var(--rack-hole)" />))}
          <line x1={LEFT + RAIL} x2={LEFT + RW - RAIL} y1={y + UH} y2={y + UH} stroke="var(--border)" strokeWidth={1} opacity={0.7} {...ns} />
          {!occ && <g style={{ cursor: canEdit ? 'pointer' : 'default' }} onPointerDown={(e) => e.stopPropagation()} onClick={() => onEmptyClick(u)}>
            <rect className="unit-bg" x={LEFT + RAIL} y={y} width={RW - RAIL * 2} height={UH} fill={dropU === u ? 'var(--accent)' : 'transparent'} />
            {dropU === u && <rect x={LEFT + RAIL + 1} y={y + 1} width={RW - RAIL * 2 - 2} height={UH - 2} rx={2} fill="none" stroke="var(--primary)" strokeWidth={1.5} strokeDasharray="4 3" {...ns} />}
            {canEdit && gapW >= 8 && <g className="plus" style={{ pointerEvents: 'none' }}><circle cx={plusX} cy={y + UH / 2} r={5} fill="var(--surface)" stroke="var(--primary)" strokeWidth={1} {...ns} /><path d={`M ${plusX - 2.5} ${y + UH / 2} H ${plusX + 2.5} M ${plusX} ${y + UH / 2 - 2.5} V ${y + UH / 2 + 2.5}`} stroke="var(--primary)" strokeWidth={1.2} {...ns} /></g>}
            <title>{canEdit ? `Add device at U${u}` : `U${u} empty`}</title></g>}
        </g>; })}
      {[...rack.devices].sort((a, b) => (b.is_tray - a.is_tray)).map((d) => { const top = yOfTop((d.position_u ?? 1) + d.height_u - 1) + dragY(d); const h = d.height_u * UH; const active = selDev === d.id; const tpl = d.template_name ?? d.type_name; const px = panelX(d) + dragX(d); const pw = panelW(d); const labelW = labelWOf(pw); const dragging = drag?.kind === 'device' && drag.id === d.id;
        const tplColor = rack.devices && (d as unknown as { color?: string }).color; void tplColor;
        return <g key={d.id} data-device={d.id} className="rack-dev" transform={`translate(0 ${top})`} style={{ cursor: canEdit ? 'grab' : 'pointer' }} opacity={dragging ? 0.8 : 1} onPointerDown={(e) => { e.stopPropagation(); if (!canEdit) { onSelectDevice(d.id); return; } setDrag({ kind: 'device', id: d.id, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0 }); (e.currentTarget as Element).setPointerCapture?.(e.pointerId); }} onPointerUp={(e) => { if (drag?.kind === 'device') { e.stopPropagation(); onUp(e as unknown as RPointerEvent<SVGSVGElement>); } else if (!canEdit) onSelectDevice(d.id); }}>
          {d.is_tray ? <>
            <rect className="body" x={px} y={1} width={pw} height={h - 2} rx={1.5} fill="var(--rack-tray)" stroke={active ? 'var(--primary)' : 'var(--border-strong)'} strokeWidth={active ? 1.5 : 1} strokeDasharray={active ? undefined : '3 2'} {...ns} />
            <rect x={px} y={h - 4} width={pw} height={3} fill="var(--border-strong)" />
            <text x={px + 5} y={h - 7} fontSize={6} fill="var(--muted)" fontFamily="var(--mono)" fontWeight={700} style={{ pointerEvents: 'none' }}>{d.code} · tray</text>
          </> : <>
            {active && <rect x={px - 1.5} y={-0.5} width={pw + 3} height={h + 1} rx={2.5} fill="none" stroke="var(--primary)" strokeWidth={1.5} opacity={0.9} {...ns} />}
            <rect className="body" x={px} y={1} width={pw} height={h - 2} rx={1.5} fill="var(--rack-panel)" stroke="var(--border-strong)" strokeWidth={1} {...ns} />
            <rect x={px} y={1} width={labelW} height={h - 2} fill="var(--rack-label)" />
            <line x1={px + labelW} x2={px + labelW} y1={1} y2={h - 1} stroke="var(--border)" strokeWidth={1} {...ns} />
            <text transform={`translate(${px + labelW / 2 + 0.5} ${h / 2}) rotate(-90)`} fontSize={labelW < 20 ? 5.5 : h > 30 ? 7.5 : 6.5} fontWeight={700} textAnchor="middle" fill="var(--text)" fontFamily="var(--mono)" style={{ pointerEvents: 'none' }}>{d.code}</text>
            {d.ports.filter((p) => p.face === face && p.kind !== 'wireless').length === 0 && <text x={px + labelW + (pw - labelW) / 2} y={h / 2 + 2.5} fontSize={pw < 200 ? 6 : 7} textAnchor="middle" fill="var(--muted)" style={{ pointerEvents: 'none' }}>{(tpl + (d.name ? ` · ${d.name}` : '')).slice(0, pw < 200 ? 22 : 64)}</text>}
          </>}
          <title>{d.path} · {tpl}{d.name ? ` · ${d.name}` : ''}{d.width_pct < 100 ? ` · ${d.width_pct}% width` : ''}</title>
        </g>; })}
      {wires.map(({ c, a, b, lane }) => { const hi = hoverChain?.has(c.port_a_id); const col = hi ? '#eab308' : (c.chain?.color || 'var(--user)'); const ax = a.x + a.s / 2 + dragX(a.dev), ay = a.y + a.s / 2 + dragY(a.dev), bx = b.x + b.s / 2 + dragX(b.dev), by = b.y + b.s / 2 + dragY(b.dev); const lx = rightX + lane; const ca = ay - a.s / 2 - 2.5, cb = by - b.s / 2 - 2.5;
        return <path key={c.id} d={roundedPath([[ax, ay], [ax, ca], [lx, ca], [lx, cb], [bx, cb], [bx, by]], 4)} fill="none" stroke={col} strokeWidth={hi ? 1.8 : 1.2} strokeLinecap="round" opacity={hoverChain && !hi ? 0.2 : 0.95} style={{ pointerEvents: 'none' }} {...ns} />; })}
      {[...geom.values()].map(({ x, y, s, dev, port }) => { const top = dragY(dev); const chainHi = hoverChain?.has(port.id); const vlanHi = vlanPorts?.has(port.id); const sel = selPort === port.id; const fill = portFill(port, dev); const empty = fill === 'var(--surface)';
        const stroke = chainHi ? '#eab308' : sel ? 'var(--primary)' : vlanHi ? 'var(--amber)' : empty ? 'var(--port-none)' : fill;
        return <g key={port.id} transform={`translate(${x + dragX(dev)} ${y + top})`} data-port={port.id} style={{ cursor: canEdit ? 'crosshair' : 'pointer' }}
          onPointerEnter={() => port.state !== 'none' && setHoverChain(chainOf(port))} onPointerLeave={() => setHoverChain(null)}
          onPointerDown={(e) => { e.stopPropagation(); if (canEdit && !port.user && (!dev.passive || port.keystone)) { const p = toSvg(e); setDrag({ kind: 'wire', from: port.id, x: p.x, y: p.y }); (e.target as Element).setPointerCapture?.(e.pointerId); } else if (canEdit && dev.passive && !port.keystone) onKeystoneMissing(port, dev); }}
          onPointerUp={(e) => { e.stopPropagation(); if (drag?.kind === 'wire') { onUp(e as unknown as RPointerEvent<SVGSVGElement>); if (Math.abs(drag.x) < 1) onSelectPort(dev.id, port.id); } else onSelectPort(dev.id, port.id); if (drag?.kind === 'wire' && drag.from === port.id) onSelectPort(dev.id, port.id); }}>
          <rect x={-2} y={-2} width={s + 4} height={s + 4} fill="transparent" />
          <g className="glyph">
            {(sel || chainHi || vlanHi) && <rect x={-1.5} y={-1.5} width={s + 3} height={s + 3} rx={1.5} fill="none" stroke={stroke} strokeWidth={1} opacity={0.7} {...ns} />}
            <PortGlyph kind={port.kind} s={s} fill={fill} stroke={stroke} dashed={dev.passive === 1 && !port.keystone} />
            {vlanHi && port.vlan_id && <circle cx={s} cy={0} r={1.6} fill="var(--amber)" />}
          </g>
          {showPortNames && <text x={s / 2} y={-1.2} fontSize={3.4} textAnchor="middle" fill="var(--muted)" fontFamily="var(--mono)" style={{ pointerEvents: 'none' }}>{port.name.length > 5 ? port.name.slice(0, 4) + '…' : port.name}</text>}
          <title>{port.path} · {port.kind}{port.vlan_vid != null ? ` · VLAN ${port.vlan_vid}` : ''} · {dev.passive && !port.keystone ? 'no building connection (no keystone)' : port.state === 'none' ? 'unconnected' : port.state}</title>
        </g>; })}
      {outbound.map(({ c, g }) => { const hi = hoverChain?.has(g.port.id); const col = hi ? '#eab308' : (c.chain?.color || 'var(--user)'); const x = g.x + g.s / 2 + dragX(g.dev), y = g.y + dragY(g.dev);
        return <g key={c.id} transform={`translate(${x} ${y})`} style={{ pointerEvents: 'none' }}><path d={roundedPath([[0, g.s / 2], [0, -4], [10, -4], [10, -9]], 2)} fill="none" stroke={col} strokeWidth={1.2} {...ns} /><rect x={4} y={-15.5} width={30} height={7} rx={1.5} fill="var(--text)" /><text x={19} y={-10.3} fontSize={4.2} textAnchor="middle" fill="var(--bg)" fontWeight={700} letterSpacing={0.3}>⇗ OUTBOUND</text></g>; })}
      {drag?.kind === 'wire' && geom.get(drag.from) && <path d={`M ${geom.get(drag.from)!.x + geom.get(drag.from)!.s / 2} ${geom.get(drag.from)!.y + geom.get(drag.from)!.s / 2} L ${drag.x} ${drag.y}`} fill="none" stroke="var(--primary)" strokeWidth={1.5} strokeDasharray="4 3" strokeLinecap="round" style={{ pointerEvents: 'none' }} {...ns} />}
    </g>
  </svg>;
}

function AddRackDeviceForm({ rack, templates, position, templateId, onDone }: { rack: RackDetail; templates: Template[]; position: number; templateId?: number; onDone: (id?: number) => void }) {
  const [tplId, setTplId] = useState(templateId ?? 0); const [code, setCode] = useState(''); const [name, setName] = useState(''); const [pos, setPos] = useState(position); const [q, setQ] = useState(''); const [hpos, setHpos] = useState('auto');
  const tpl = templates.find((t) => t.id === tplId);
  useEffect(() => { if (!tpl) return; const used = new Set(rack.devices.map((d) => d.code)); let n = 1; while (used.has(`${tpl.prefix}${String(n).padStart(2, '0')}`)) n++; setCode(`${tpl.prefix}${String(n).padStart(2, '0')}`); }, [tpl, rack.devices]);
  const list = templates.filter((t) => !q || `${t.name} ${t.type_name} ${t.brand}`.toLowerCase().includes(q.toLowerCase()));
  return <Form submitLabel="Add device" onCancel={() => onDone()} onSubmit={async () => { if (!tplId) throw new Error('Select a device'); const w = tpl?.width_pct ?? 100; const slot_x = hpos === 'auto' ? undefined : hpos === 'left' ? 0 : hpos === 'right' ? 100 - w : Math.round((100 - w) / 2); const d = await api.post<{ id: number }>(`/racks/${rack.id}/devices`, { template_id: tplId, code, name, position_u: Number(pos), slot_x }); onDone(d.id); }}>
    <Field label="Device" required><input placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={!templateId} /></Field>
    <div className="cfg-list" style={{ maxHeight: 220 }}>{list.map((t) => <div key={t.id} className="cfg-row" style={{ background: tplId === t.id ? 'var(--accent)' : undefined }} onClick={() => setTplId(t.id)}><span className="grow">{t.name}{t.brand && <span className="muted"> · {t.brand}</span>}</span><span className="muted small">{t.type_name} · {t.height_u}U{t.width_pct < 100 ? ` · ${t.width_pct}% wide` : ''} · {t.ports.length} ports</span></div>)}</div>
    <div className="form-row"><Field label="ID" required><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required className="code" /></Field><Field label="Rack unit (bottom)" hint={tpl ? `Occupies U${pos}–U${pos + tpl.height_u - 1}` : ''}><input type="number" min={1} max={rack.height_u} value={pos} onChange={(e) => setPos(Number(e.target.value))} required /></Field></div>
    <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Core switch A" /></Field>
    {tpl && tpl.width_pct < 100 && <Field label="Horizontal position" hint="Devices narrower than the rack can share a unit, e.g. on a tray or shelf"><select value={hpos} onChange={(e) => setHpos(e.target.value)}><option value="auto">First free slot</option><option value="left">Left</option><option value="centre">Centre</option><option value="right">Right</option></select></Field>}
  </Form>;
}

function exportPng(name: string) {
  const svg = document.querySelector('svg.editor-canvas') as SVGSVGElement | null; if (!svg) return;
  const clone = svg.cloneNode(true) as SVGSVGElement; const vb = svg.viewBox.baseVal; clone.setAttribute('width', String(vb.width * 2)); clone.setAttribute('height', String(vb.height * 2));
  const css = getComputedStyle(document.documentElement); const vars = ['--surface', '--surface-2', '--border', '--border-strong', '--text', '--muted', '--primary', '--port-none', '--port-complete', '--port-incomplete', '--port-keystone', '--rack-rail', '--rack-interior', '--rack-hole', '--rack-base', '--rack-panel', '--rack-label', '--rack-tray', '--accent', '--user', '--amber', '--bg', '--mono'];
  let xml = new XMLSerializer().serializeToString(clone); for (const v of vars) xml = xml.split(`var(${v})`).join(css.getPropertyValue(v).trim() || '#000');
  const blob = new Blob([xml], { type: 'image/svg+xml' }); const url = URL.createObjectURL(blob); const img = new Image();
  img.onload = () => { const c = document.createElement('canvas'); c.width = vb.width * 2; c.height = vb.height * 2; const ctx = c.getContext('2d')!; ctx.fillStyle = css.getPropertyValue('--surface').trim() || '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0); const a = document.createElement('a'); a.download = `${name}.png`; a.href = c.toDataURL('image/png'); a.click(); URL.revokeObjectURL(url); };
  img.src = url;
}
