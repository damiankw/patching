import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ZoomIn, ZoomOut, Maximize, EyeOff, Eye, Keyboard, BookOpen, Search, MoreVertical, Scan, PanelBottom, Undo2, Redo2, X } from 'lucide-react';
import { api, fmtDate } from '../lib/api';
import { useCanEdit } from '../lib/auth';
import type { Connection, Device, DeviceDetail, Port, RackDetail, Template, Vlan } from '../lib/types';
import { usePageHeader } from '../components/Shell';
import { Confirm, Dialog, ErrorBox, Field, Form, IconBtn, Loading, Menu, SaveStatus, Tabs, errMsg, useToast } from '../components/ui';
import { ConnectionsTable, DeviceSettings, useTypes } from '../components/editor';
import { ShortcutsHelp } from './LocationView';
import { panelLayout } from './DeviceLibrary';
import { zoomAt, type View } from '../components/canvas';

const UH = 24; const RW = 520; const LEFT = 70; const RAIL = 14; const PAD = 16; const PAD_TOP = 60; const GUT = 80;
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
  const [modal, setModal] = useState<null | { kind: 'add'; position: number; templateId?: number } | { kind: 'delDev'; dev: RackDevice } | { kind: 'disc'; port: Port } | { kind: 'shortcuts' } | { kind: 'delRack' }>(null);
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
            onDropTemplate={(tplId, u) => setModal({ kind: 'add', position: u, templateId: tplId })} onMoveDevice={(devId, u) => act(() => api.patch(`/devices/${devId}`, { position_u: u }))}
            onConnect={(a, b) => act(() => api.post('/connections', { port_a_id: a, port_b_id: b, type: 'user' }))} onClearVlan={() => setHlVlan(null)} />
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
  return <div className="palette-panel"><div className="palette-head"><h3>Devices</h3><div className="muted tiny">Drag device to a rack unit to add it.</div><div style={{ position: 'relative', marginTop: 6 }}><Search size={12} className="muted" style={{ position: 'absolute', left: 7, top: 8 }} /><input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 22, fontSize: 12 }} /></div></div>
    <div className="palette-list-items">{groups.map(([type, list]) => <div key={type}><div className="palette-group-label">{type}</div>{list.map((t) => <div key={t.id} className="palette-item-dev" draggable={canEdit} onDragStart={(e) => { e.dataTransfer.setData('text/rd-template', String(t.id)); e.dataTransfer.effectAllowed = 'copy'; }} title={`${t.height_u}U · ${t.ports.length} ports`}><span style={{ flex: 1 }}>{t.name}</span><span className="muted tiny">{t.height_u}U</span></div>)}</div>)}</div></div>;
}

function RackCanvas({ rack, face, view, setView, fitMode, selDev, selPort, canEdit, hoverChain, setHoverChain, vlanPorts, conns, onSelectDevice, onSelectPort, onEmptyClick, onDropTemplate, onMoveDevice, onConnect, onClearVlan }: {
  rack: RackDetail; face: Face; view: View; setView: (v: View) => void; fitMode: 'height' | 'width'; selDev: number | null; selPort: number | null; canEdit: boolean; hoverChain: Set<number> | null; setHoverChain: (s: Set<number> | null) => void; vlanPorts: Set<number> | null; conns: Connection[];
  onSelectDevice: (id: number | null) => void; onSelectPort: (dev: number, port: number) => void; onEmptyClick: (u: number) => void; onDropTemplate: (tplId: number, u: number) => void; onMoveDevice: (devId: number, u: number) => void; onConnect: (a: number, b: number) => void; onClearVlan: () => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const H = rack.height_u * UH + PAD + PAD_TOP; const W = LEFT + RW + GUT + 20;
  const [drag, setDrag] = useState<null | { kind: 'pan'; sx: number; sy: number; v: View } | { kind: 'device'; id: number; startY: number; dy: number } | { kind: 'wire'; from: number; x: number; y: number }>(null);
  const yOfTop = (topU: number) => PAD_TOP + (rack.height_u - topU) * UH;
  const scale = () => { const r = svgRef.current!.getBoundingClientRect(); return fitMode === 'height' ? Math.min(r.width / W, r.height / H) : r.width / W; };
  const toSvg = (e: { clientX: number; clientY: number }) => { const r = svgRef.current!.getBoundingClientRect(); const s = scale(); const ox = fitMode === 'height' ? (r.width - W * s) / 2 : 0; return { x: ((e.clientX - r.left - ox) / s - view.tx) / view.k, y: ((e.clientY - r.top) / s - view.ty) / view.k }; };
  const occupied = useMemo(() => { const m = new Map<number, RackDevice>(); for (const d of rack.devices) for (let u = d.position_u ?? 0; u < (d.position_u ?? 0) + d.height_u; u++) m.set(u, d); return m; }, [rack]);
  // port geometry (device id -> port id -> {x,y,s})
  const geom = useMemo(() => {
    const g = new Map<number, { x: number; y: number; s: number; dev: RackDevice; port: Port }>();
    for (const d of rack.devices) {
      const ports = d.ports.filter((p) => p.face === face && p.kind !== 'wireless'); if (!ports.length) continue;
      const h = d.height_u * UH; const { rows, cols, cell } = panelLayout(ports, d.height_u, RW); const top = yOfTop((d.position_u ?? 1) + d.height_u - 1);
      ports.forEach((p, i) => { const r = Math.floor(i / cols), c = i % cols; const s = Math.min(cell - 3, (h - 8) / rows - 6); const x = LEFT + RAIL + 36 + c * cell; const y = top + 4 + r * (h - 8) / rows + 2; g.set(p.id, { x, y, s, dev: d, port: p }); });
    }
    return g;
  }, [rack, face]); // eslint-disable-line react-hooks/exhaustive-deps
  const rightX = LEFT + RW + 6;
  const wires = conns.filter((c) => c.type === 'user' && geom.has(c.port_a_id) && geom.has(c.port_b_id)).map((c, i) => ({ c, a: geom.get(c.port_a_id)!, b: geom.get(c.port_b_id)!, lane: 8 + (i % 10) * 7 }));
  const outbound = conns.filter((c) => c.type === 'user' && (geom.has(c.port_a_id) !== geom.has(c.port_b_id))).map((c) => ({ c, g: geom.get(geom.has(c.port_a_id) ? c.port_a_id : c.port_b_id)! }));
  const chainOf = (p: Port) => new Set(p.chain?.steps.map((s) => s.port_id) ?? [p.id]);
  const portFill = (p: Port, dev: RackDevice) => { if (dev.passive) return p.keystone ? (p.state === 'complete' ? 'var(--port-complete)' : p.state === 'incomplete' ? 'var(--port-incomplete)' : 'var(--port-keystone)') : 'none'; return p.state === 'complete' ? 'var(--port-complete)' : p.state === 'incomplete' ? 'var(--port-incomplete)' : 'none'; };
  const onDown = (e: RPointerEvent<SVGSVGElement>) => { if (e.button !== 0) return; setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, v: view }); };
  const onMove = (e: RPointerEvent<SVGSVGElement>) => { if (!drag) return; if (drag.kind === 'pan') { const s = scale(); setView({ ...drag.v, tx: drag.v.tx + (e.clientX - drag.sx) / s, ty: drag.v.ty + (e.clientY - drag.sy) / s }); } else if (drag.kind === 'device') setDrag({ ...drag, dy: (e.clientY - drag.startY) / (scale() * view.k) }); else if (drag.kind === 'wire') { const p = toSvg(e); setDrag({ ...drag, x: p.x, y: p.y }); } };
  const onUp = (e: RPointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    if (drag.kind === 'pan') { if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) { onSelectDevice(null); onClearVlan(); } }
    else if (drag.kind === 'device') { const d = rack.devices.find((x) => x.id === drag.id)!; const moved = Math.round(drag.dy / UH); onSelectDevice(d.id); if (moved !== 0) onMoveDevice(d.id, Math.max(1, Math.min(rack.height_u - d.height_u + 1, (d.position_u ?? 1) - moved))); }
    else if (drag.kind === 'wire') { const el = document.elementFromPoint(e.clientX, e.clientY) as Element | null; const pid = Number(el?.closest('[data-port]')?.getAttribute('data-port') ?? 0); if (pid && pid !== drag.from) onConnect(drag.from, pid); }
    setDrag(null);
  };
  const dragY = (d: RackDevice) => drag?.kind === 'device' && drag.id === d.id ? drag.dy : 0;
  const unitCenters = Array.from({ length: rack.height_u }, (_, i) => rack.height_u - i);
  return <svg ref={svgRef} className="editor-canvas" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio={fitMode === 'height' ? 'xMidYMin meet' : 'xMinYMin meet'} style={{ cursor: drag?.kind === 'pan' ? 'grabbing' : 'default' }}
    onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}
    onWheel={(e) => { const p = toSvg(e); setView(zoomAt(view, e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x * view.k + view.tx, p.y * view.k + view.ty)); }}
    onDragOver={(e) => { if (canEdit && e.dataTransfer.types.includes('text/rd-template')) e.preventDefault(); }} onDrop={(e) => { const t = Number(e.dataTransfer.getData('text/rd-template')); if (!t) return; e.preventDefault(); const p = toSvg(e); const u = Math.max(1, Math.min(rack.height_u, Math.ceil((H - PAD - p.y) / UH))); onDropTemplate(t, u); }}>
    <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`} id="rack-export-root">
      <rect x={LEFT - 4} y={PAD_TOP - 10} width={RW + 8} height={rack.height_u * UH + 20} rx={4} fill="var(--surface-2)" stroke="var(--border-strong)" />
      <rect x={LEFT} y={PAD_TOP} width={RAIL} height={rack.height_u * UH} fill="var(--rack-rail)" /><rect x={LEFT + RW - RAIL} y={PAD_TOP} width={RAIL} height={rack.height_u * UH} fill="var(--rack-rail)" />
      {unitCenters.map((u) => { const y = yOfTop(u); const occ = occupied.get(u); return <g key={u}>
        <text x={LEFT - 10} y={y + UH / 2 + 3.5} fontSize={9} textAnchor="end" fill="var(--muted)" fontFamily="var(--mono)">{u}</text>
        <circle cx={LEFT + RAIL / 2} cy={y + UH / 2} r={2} fill="var(--border-strong)" /><circle cx={LEFT + RW - RAIL / 2} cy={y + UH / 2} r={2} fill="var(--border-strong)" />
        {!occ && <g style={{ cursor: canEdit ? 'pointer' : 'default' }} onPointerDown={(e) => e.stopPropagation()} onClick={() => onEmptyClick(u)}><rect x={LEFT + RAIL} y={y} width={RW - RAIL * 2} height={UH} fill="transparent" /><line x1={LEFT + RAIL} x2={LEFT + RW - RAIL} y1={y + UH} y2={y + UH} stroke="var(--border)" strokeWidth={0.5} />{canEdit && <g opacity={0.5}><circle cx={LEFT + RW / 2} cy={y + UH / 2} r={6} fill="none" stroke="var(--primary)" strokeWidth={1} /><text x={LEFT + RW / 2} y={y + UH / 2 + 3.5} fontSize={10} textAnchor="middle" fill="var(--primary)">+</text></g>}<title>{canEdit ? `Add device at U${u}` : `U${u} empty`}</title></g>}
      </g>; })}
      {rack.devices.map((d) => { const top = yOfTop((d.position_u ?? 1) + d.height_u - 1) + dragY(d); const h = d.height_u * UH; const active = selDev === d.id; const tpl = d.template_name ?? d.type_name;
        return <g key={d.id} transform={`translate(0 ${top})`} style={{ cursor: canEdit ? 'grab' : 'pointer' }} onPointerDown={(e) => { e.stopPropagation(); if (!canEdit) { onSelectDevice(d.id); return; } setDrag({ kind: 'device', id: d.id, startY: e.clientY, dy: 0 }); (e.currentTarget as Element).setPointerCapture?.(e.pointerId); }} onPointerUp={(e) => { if (drag?.kind === 'device') { e.stopPropagation(); onUp(e as unknown as RPointerEvent<SVGSVGElement>); } else if (!canEdit) onSelectDevice(d.id); }}>
          <rect x={LEFT + RAIL + 1} y={1} width={RW - RAIL * 2 - 2} height={h - 2} rx={2} fill="var(--surface)" stroke={active ? 'var(--primary)' : 'var(--border-strong)'} strokeWidth={active ? 2 : 1} opacity={drag?.kind === 'device' && drag.id === d.id ? 0.75 : 1} />
          <rect x={LEFT + RAIL + 1} y={1} width={30} height={h - 2} fill="var(--surface-2)" />
          <text transform={`translate(${LEFT + RAIL + 16} ${h / 2}) rotate(-90)`} fontSize={h > 30 ? 9 : 7.5} fontWeight={700} textAnchor="middle" fill="var(--text)" fontFamily="var(--mono)">{d.code}</text>
          <title>{d.path} · {tpl}{d.name ? ` · ${d.name}` : ''}</title>
          {d.ports.filter((p) => p.face === face && p.kind !== 'wireless').length === 0 && <text x={LEFT + RW / 2 + 10} y={h / 2 + 3.5} fontSize={9} textAnchor="middle" fill="var(--muted)">{tpl}{d.name ? ` · ${d.name}` : ''}</text>}
        </g>; })}
      {[...geom.values()].map(({ x, y, s, dev, port }) => { const top = dragY(dev); const chainHi = hoverChain?.has(port.id); const vlanHi = vlanPorts?.has(port.id); const sel = selPort === port.id; const fill = portFill(port, dev);
        const stroke = chainHi ? '#eab308' : sel ? 'var(--primary)' : vlanHi ? 'var(--amber)' : dev.passive && !port.keystone ? 'var(--port-none)' : fill === 'none' ? 'var(--port-none)' : fill;
        return <g key={port.id} transform={`translate(${x} ${y + top})`} data-port={port.id} style={{ cursor: canEdit ? 'crosshair' : 'pointer' }}
          onPointerEnter={() => port.state !== 'none' && setHoverChain(chainOf(port))} onPointerLeave={() => setHoverChain(null)}
          onPointerDown={(e) => { e.stopPropagation(); if (canEdit && !port.user && (!dev.passive || port.keystone)) { const p = toSvg(e); setDrag({ kind: 'wire', from: port.id, x: p.x, y: p.y }); (e.target as Element).setPointerCapture?.(e.pointerId); } }}
          onPointerUp={(e) => { e.stopPropagation(); if (drag?.kind === 'wire') { onUp(e as unknown as RPointerEvent<SVGSVGElement>); if (Math.abs(drag.x) < 1) onSelectPort(dev.id, port.id); } else onSelectPort(dev.id, port.id); if (drag?.kind === 'wire' && drag.from === port.id) onSelectPort(dev.id, port.id); }}>
          <rect x={0} y={0} width={s} height={s} rx={1.5} fill={fill === 'none' ? 'var(--surface)' : fill} stroke={stroke} strokeWidth={chainHi || sel || vlanHi ? 2 : 1.2} strokeDasharray={dev.passive && !port.keystone ? '2 1.5' : undefined} />
          {chainHi && <rect x={-1.5} y={-1.5} width={s + 3} height={s + 3} rx={2} fill="none" stroke="#eab308" strokeWidth={1} opacity={0.6} />}
          {vlanHi && port.vlan_id && <circle cx={s} cy={0} r={2} fill="var(--amber)" />}
          <text x={s / 2} y={s + 6} fontSize={4.2} textAnchor="middle" fill="var(--muted)" style={{ pointerEvents: 'none' }}>{port.name.length > 5 ? port.name.slice(0, 4) + '…' : port.name}</text>
          <title>{port.path} · {port.kind}{port.vlan_vid != null ? ` · VLAN ${port.vlan_vid}` : ''} · {dev.passive && !port.keystone ? 'no building connection (no keystone)' : port.state === 'none' ? 'unconnected' : port.state}</title>
        </g>; })}
      {wires.map(({ c, a, b, lane }) => { const hi = hoverChain?.has(c.port_a_id); const col = hi ? '#eab308' : (c.chain?.color || 'var(--user)'); const ax = a.x + a.s / 2, ay = a.y + a.s / 2 + dragY(a.dev), bx = b.x + b.s / 2, by = b.y + b.s / 2 + dragY(b.dev); const lx = rightX + lane;
        return <path key={c.id} d={`M ${ax} ${ay} L ${ax} ${ay - a.s} L ${lx} ${ay - a.s} L ${lx} ${by - b.s} L ${bx} ${by - b.s} L ${bx} ${by}`} fill="none" stroke={col} strokeWidth={hi ? 2 : 1.2} opacity={hoverChain && !hi ? 0.25 : 0.9} style={{ pointerEvents: 'none' }} />; })}
      {outbound.map(({ c, g }) => { const hi = hoverChain?.has(g.port.id); return <g key={c.id} transform={`translate(${g.x + g.s / 2} ${g.y - 2 + dragY(g.dev)})`} style={{ pointerEvents: 'none' }}><line x1={0} y1={0} x2={0} y2={-6} stroke={hi ? '#eab308' : (c.chain?.color || 'var(--user)')} strokeWidth={1.2} /><rect x={-14} y={-14} width={28} height={8} rx={2} fill="var(--text)" /><text x={0} y={-8} fontSize={5} textAnchor="middle" fill="var(--bg)" fontWeight={700}>⇗ OUTBOUND</text></g>; })}
      {drag?.kind === 'wire' && geom.get(drag.from) && <line x1={geom.get(drag.from)!.x + geom.get(drag.from)!.s / 2} y1={geom.get(drag.from)!.y + geom.get(drag.from)!.s / 2} x2={drag.x} y2={drag.y} stroke="var(--primary)" strokeWidth={1.5} strokeDasharray="4 3" style={{ pointerEvents: 'none' }} />}
    </g>
  </svg>;
}

function AddRackDeviceForm({ rack, templates, position, templateId, onDone }: { rack: RackDetail; templates: Template[]; position: number; templateId?: number; onDone: (id?: number) => void }) {
  const [tplId, setTplId] = useState(templateId ?? 0); const [code, setCode] = useState(''); const [name, setName] = useState(''); const [pos, setPos] = useState(position); const [q, setQ] = useState('');
  const tpl = templates.find((t) => t.id === tplId);
  useEffect(() => { if (!tpl) return; const used = new Set(rack.devices.map((d) => d.code)); let n = 1; while (used.has(`${tpl.prefix}${String(n).padStart(2, '0')}`)) n++; setCode(`${tpl.prefix}${String(n).padStart(2, '0')}`); }, [tpl, rack.devices]);
  const list = templates.filter((t) => !q || `${t.name} ${t.type_name} ${t.brand}`.toLowerCase().includes(q.toLowerCase()));
  return <Form submitLabel="Add device" onCancel={() => onDone()} onSubmit={async () => { if (!tplId) throw new Error('Select a device'); const d = await api.post<{ id: number }>(`/racks/${rack.id}/devices`, { template_id: tplId, code, name, position_u: Number(pos) }); onDone(d.id); }}>
    <Field label="Device" required><input placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={!templateId} /></Field>
    <div className="cfg-list" style={{ maxHeight: 220 }}>{list.map((t) => <div key={t.id} className="cfg-row" style={{ background: tplId === t.id ? 'var(--accent)' : undefined }} onClick={() => setTplId(t.id)}><span className="grow">{t.name}{t.brand && <span className="muted"> · {t.brand}</span>}</span><span className="muted small">{t.type_name} · {t.height_u}U · {t.ports.length} ports</span></div>)}</div>
    <div className="form-row"><Field label="ID" required><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required className="code" /></Field><Field label="Rack unit (bottom)" hint={tpl ? `Occupies U${pos}–U${pos + tpl.height_u - 1}` : ''}><input type="number" min={1} max={rack.height_u} value={pos} onChange={(e) => setPos(Number(e.target.value))} required /></Field></div>
    <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Core switch A" /></Field>
  </Form>;
}

function exportPng(name: string) {
  const svg = document.querySelector('svg.editor-canvas') as SVGSVGElement | null; if (!svg) return;
  const clone = svg.cloneNode(true) as SVGSVGElement; const vb = svg.viewBox.baseVal; clone.setAttribute('width', String(vb.width * 2)); clone.setAttribute('height', String(vb.height * 2));
  const css = getComputedStyle(document.documentElement); const vars = ['--surface', '--surface-2', '--border', '--border-strong', '--text', '--muted', '--primary', '--port-none', '--port-complete', '--port-incomplete', '--port-keystone', '--rack-rail', '--user', '--amber', '--bg', '--mono'];
  let xml = new XMLSerializer().serializeToString(clone); for (const v of vars) xml = xml.split(`var(${v})`).join(css.getPropertyValue(v).trim() || '#000');
  const blob = new Blob([xml], { type: 'image/svg+xml' }); const url = URL.createObjectURL(blob); const img = new Image();
  img.onload = () => { const c = document.createElement('canvas'); c.width = vb.width * 2; c.height = vb.height * 2; const ctx = c.getContext('2d')!; ctx.fillStyle = css.getPropertyValue('--surface').trim() || '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0); const a = document.createElement('a'); a.download = `${name}.png`; a.href = c.toDataURL('image/png'); a.click(); URL.revokeObjectURL(url); };
  img.src = url;
}
