import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Square, Pentagon, ZoomIn, ZoomOut, Maximize, Info, Pencil, EyeOff, Eye, Keyboard, BookOpen, Move, Plug, Trash2, Search, Upload, Ruler, MoreVertical, Scan, PanelBottom } from 'lucide-react';
import { api, imageSize } from '../lib/api';
import { useCanEdit } from '../lib/auth';
import { DeviceIcon } from '../lib/icons';
import type { DeviceDetail, DeviceType, FloorDevice, FloorView, Location, Pt, Room } from '../lib/types';
import { usePageHeader } from '../components/Shell';
import { Confirm, Dialog, ErrorBox, Field, Form, IconBtn, Loading, Menu, PersonSelect, SaveStatus, Section, Tabs, errMsg, useAutosave, useToast } from '../components/ui';
import { ConnectionsTable, DeviceSettings, NotesEditor, useTypes } from '../components/editor';
import { LocationForm } from './Locations';
import { clientToPlan, planToClient, zoomAt, centroid, type View } from '../components/canvas';
import { fmtDate } from '../lib/api';

type Sel = { kind: 'floor' } | { kind: 'room'; id: number } | { kind: 'device'; id: number };
type Tool = 'select' | 'rect' | 'poly' | 'scale';

export function LocationView() {
  const params = useParams(); const nav = useNavigate();
  const locId = params.id ? Number(params.id) : null;
  // /locations/:id → jump to its first floor
  const loc = useQuery({ queryKey: ['location', locId], queryFn: () => api.get<Location>(`/locations/${locId}`), enabled: locId !== null });
  useEffect(() => { if (loc.data?.floors?.length) nav(`/floors/${loc.data.floors[0].id}`, { replace: true }); }, [loc.data, nav]);
  if (locId !== null) return loc.error ? <ErrorBox error={loc.error} /> : <Loading />;
  return <FloorEditor floorId={Number(params.floorId)} />;
}

function FloorEditor({ floorId }: { floorId: number }) {
  const qc = useQueryClient(); const nav = useNavigate(); const toast = useToast(); const canEdit = useCanEdit();
  const [sp, setSp] = useSearchParams();
  const q = useQuery({ queryKey: ['floor-view', floorId], queryFn: () => api.get<FloorView>(`/floors/${floorId}/view`) });
  const types = useTypes();
  const [sel, setSel] = useState<Sel>({ kind: 'floor' }); const [selPort, setSelPort] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool>('select'); const [view, setView] = useState<View>({ k: 1, tx: 0, ty: 0 });
  const [panelsHidden, setPanelsHidden] = useState(false); const [sidebarHidden, setSidebarHidden] = useState(false); const [bottomOpen, setBottomOpen] = useState(false); const [bottomTab, setBottomTab] = useState('devices');
  const [modal, setModal] = useState<null | { kind: 'addFloor' } | { kind: 'addDevice'; x?: number; y?: number; typeId?: number } | { kind: 'room'; points: Pt[] } | { kind: 'scale'; px: number } | { kind: 'editLoc' } | { kind: 'info' } | { kind: 'shortcuts' } | { kind: 'delDevice'; dev: FloorDevice } | { kind: 'delRoom'; room: Room } | { kind: 'delFloor' } | { kind: 'notes' }>(null);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [connectOpen, setConnectOpen] = useState(false);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['floor-view', floorId] }), qc.invalidateQueries({ queryKey: ['device'] }), qc.invalidateQueries({ queryKey: ['locations'] }), qc.invalidateQueries({ queryKey: ['racks'] })]);
  const data = q.data;
  // deep links
  useEffect(() => { const d = sp.get('device'), r = sp.get('room'); if (d) setSel({ kind: 'device', id: Number(d) }); else if (r !== null) setSel(r ? { kind: 'room', id: Number(r) } : { kind: 'floor' }); if (d || r !== null) { sp.delete('device'); sp.delete('room'); setSp(sp, { replace: true }); } }, [sp, setSp]);
  const prevFloor = useRef(floorId);
  useEffect(() => { if (prevFloor.current !== floorId) { prevFloor.current = floorId; setSel({ kind: 'floor' }); setSelPort(null); setTool('select'); } }, [floorId]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { const mod = e.metaKey || e.ctrlKey; if (mod && e.key.toLowerCase() === 'h') { e.preventDefault(); setPanelsHidden((v) => !v); } if (e.key === 'Escape') { setTool('select'); setDraw(null); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, []);
  const [draw, setDraw] = useState<null | { kind: 'rect'; a: Pt; b: Pt } | { kind: 'poly'; pts: Pt[]; cur: Pt | null } | { kind: 'scale'; a: Pt; b: Pt | null }>(null);

  const floor = data?.floor; const W = floor?.plan_w ?? 2000, H = floor?.plan_h ?? 1400;
  usePageHeader({ title: floor?.location_name ?? '…', crumbs: [{ label: 'Locations', to: '/locations' }, { label: floor?.location_code ?? '', to: `/locations/${floor?.location_id}` }, { label: floor?.code ?? '' }], full: true,
    actions: <><IconBtn title="Location info" onClick={() => setModal({ kind: 'info' })}><Info size={15} /></IconBtn>{canEdit && <IconBtn title="Edit location" onClick={() => setModal({ kind: 'editLoc' })}><Pencil size={15} /></IconBtn>}<IconBtn title={sidebarHidden ? 'Show settings sidebar' : 'Hide settings sidebar'} onClick={() => setSidebarHidden(!sidebarHidden)}>{sidebarHidden ? <Eye size={15} /> : <EyeOff size={15} />}</IconBtn><IconBtn title="Keyboard shortcuts" onClick={() => setModal({ kind: 'shortcuts' })}><Keyboard size={15} /></IconBtn><a className="icon-btn" href="https://github.com/damiankw/patching#readme" target="_blank" rel="noreferrer" title="Documentation"><BookOpen size={15} /></a></> }, [floor?.id, floor?.code, floor?.location_name, floor?.location_code, sidebarHidden, canEdit]);

  const selectedDevice = sel.kind === 'device' ? data?.devices.find((d) => d.id === sel.id) ?? null : null;
  const selectedRoom = sel.kind === 'room' ? data?.rooms.find((r) => r.id === sel.id) ?? null : null;
  const devicePos = useMemo(() => new Map((data?.devices ?? []).map((d) => [d.id, [d.x, d.y] as Pt])), [data]);

  const patchDevice = async (id: number, body: Record<string, unknown>) => { setSaveStatus('saving'); try { await api.patch(`/devices/${id}`, body); await refresh(); setSaveStatus('saved'); } catch (e) { setSaveStatus('error'); toast(errMsg(e), 'error'); } };
  if (q.isLoading || !data || !floor) return q.error ? <ErrorBox error={q.error} /> : <Loading />;
  const floorTypes = (types.data ?? []).filter((t) => t.kind === 'floor');

  return <div className={`editor${sidebarHidden ? ' sidebar-hidden' : ''}`}>
    <div className="editor-topbar">
      {data.floors.map((f) => <button key={f.id} className={`floor-tab${f.id === floorId ? ' active' : ''}`} onClick={() => nav(`/floors/${f.id}`)} title={f.name}>{f.code}</button>)}
      <span className="grow" />
      {canEdit && <button className="btn" onClick={() => setModal({ kind: 'addFloor' })}><Plus size={14} /> Floor</button>}
      {canEdit && <button className="btn btn-primary" onClick={() => setModal({ kind: 'addDevice' })}><Plus size={14} /> Device</button>}
    </div>
    <div className="editor-body">
      {!panelsHidden && <Palette types={floorTypes} canEdit={canEdit} />}
      {!panelsHidden && <div className="palette-rail"><span className="rail-label">DEVICE LIBRARY</span></div>}
      <FloorCanvas data={data} W={W} H={H} view={view} setView={setView} tool={tool} setTool={setTool} draw={draw} setDraw={setDraw} sel={sel} setSel={(s) => { setSel(s); setSelPort(null); }} canEdit={canEdit}
        onMoveDevice={(id, x, y) => patchDevice(id, { x, y })} onDropType={(typeId, x, y) => setModal({ kind: 'addDevice', typeId, x, y })}
        onRoomDrawn={(pts) => setModal({ kind: 'room', points: pts })} onScaleDrawn={(px) => setModal({ kind: 'scale', px })} onRoomPoints={async (id, pts) => { setSaveStatus('saving'); try { await api.patch(`/rooms/${id}`, { points: pts }); await refresh(); setSaveStatus('saved'); } catch (e) { setSaveStatus('error'); toast(errMsg(e), 'error'); } }}
        saveStatus={saveStatus} bottom={!panelsHidden && <BottomPanel data={data} open={bottomOpen} setOpen={setBottomOpen} tab={bottomTab} setTab={setBottomTab} onSelect={(id) => setSel({ kind: 'device', id })} />}
        pill={selectedDevice && canEdit ? { dev: selectedDevice, onEdit: selectedDevice.is_rack ? () => nav(`/racks/${selectedDevice.id}`) : undefined, onConnect: !selectedDevice.is_rack ? () => { setSelPort(selectedDevice.ports.find((p) => !p.user && (selectedDevice.passive === 0 || p.keystone))?.id ?? null); setConnectOpen(true); } : undefined, onDelete: () => setModal({ kind: 'delDevice', dev: selectedDevice }) } : null} />
      <aside className="sidebar-panel">
        <div className="sidebar-title"><span className="code">{floor.location_code}/{floor.code}{selectedRoom ? `/${selectedRoom.code}` : ''}{selectedDevice ? `/${selectedDevice.room_code ?? 'DEFAULT'}/${selectedDevice.code}` : ''}</span>
          <Menu button={<IconBtn title="More"><MoreVertical size={14} /></IconBtn>} items={[{ label: 'Copy ID', onClick: () => { navigator.clipboard?.writeText(selectedDevice?.path ?? `${floor.location_code}/${floor.code}`); toast('Copied'); } }, { label: 'Export location as PDF', onClick: () => window.open(`/report/location/${floor.location_id}`, '_blank') }, { sep: true, label: '' }, { label: 'Delete floor', danger: true, disabled: !canEdit, onClick: () => setModal({ kind: 'delFloor' }) }]} /></div>
        <div className="palette-rail" style={{ display: 'none' }} />
        {sel.kind === 'floor' && <FloorSettings floor={floor} canEdit={canEdit} onChanged={refresh} onRescale={() => setTool('scale')} onNotes={() => setModal({ kind: 'notes' })} />}
        {selectedRoom && <RoomSettings room={selectedRoom} canEdit={canEdit} onChanged={refresh} onDelete={() => setModal({ kind: 'delRoom', room: selectedRoom })} />}
        {selectedDevice && <DeviceSidebar id={selectedDevice.id} canEdit={canEdit} onChanged={refresh} selPort={selPort} setSelPort={setSelPort} types={types.data} connectOpen={connectOpen} setConnectOpen={setConnectOpen} />}
      </aside>
    </div>

    <Dialog open={modal?.kind === 'addFloor'} onClose={() => setModal(null)} title="Add floor" subtitle="A floor is anything that shares one 2D plan.">{modal?.kind === 'addFloor' && <FloorForm locationId={floor.location_id} onDone={async (f) => { setModal(null); await refresh(); if (f) nav(`/floors/${f.id}`); }} />}</Dialog>
    <Dialog open={modal?.kind === 'addDevice'} onClose={() => setModal(null)} title="Add device" subtitle="Add a new device to the floor.">{modal?.kind === 'addDevice' && <AddDeviceForm data={data} types={floorTypes} preset={modal} onDone={async (id) => { setModal(null); await refresh(); if (id) setSel({ kind: 'device', id }); }} />}</Dialog>
    <Dialog open={modal?.kind === 'room'} onClose={() => { setModal(null); setDraw(null); }} title="New room">{modal?.kind === 'room' && <RoomForm floorId={floorId} points={modal.points} onDone={async (id) => { setModal(null); setDraw(null); setTool('select'); await refresh(); if (id) setSel({ kind: 'room', id }); }} />}</Dialog>
    <Dialog open={modal?.kind === 'scale'} onClose={() => { setModal(null); setDraw(null); setTool('select'); }} title="Scale floor plan" subtitle="You measured a distance on the plan. How long is it in the real world?">{modal?.kind === 'scale' && <ScaleForm px={modal.px} onDone={async (metres) => { if (metres) { await api.patch(`/floors/${floorId}`, { plan_scale: modal.px / metres }); await refresh(); } setModal(null); setDraw(null); setTool('select'); }} />}</Dialog>
    <Dialog open={modal?.kind === 'editLoc'} onClose={() => setModal(null)} title="Edit location">{modal?.kind === 'editLoc' && <LocationLoader id={floor.location_id} onDone={() => { setModal(null); refresh(); qc.invalidateQueries({ queryKey: ['location'] }); }} />}</Dialog>
    <Dialog open={modal?.kind === 'info'} onClose={() => setModal(null)} title={floor.location_name}>{modal?.kind === 'info' && <LocationInfo id={floor.location_id} />}</Dialog>
    <Dialog open={modal?.kind === 'shortcuts'} onClose={() => setModal(null)} title="Keyboard shortcuts"><ShortcutsHelp /></Dialog>
    <Dialog open={modal?.kind === 'notes'} onClose={() => setModal(null)} title={`Notes · ${floor.location_code}/${floor.code}`}>{modal?.kind === 'notes' && <NotesEditor value={floor.notes} onSave={async (v) => { await api.patch(`/floors/${floorId}`, { notes: v }); setModal(null); refresh(); }} />}</Dialog>
    <Confirm open={modal?.kind === 'delDevice'} onClose={() => setModal(null)} title="Delete device" text={modal?.kind === 'delDevice' ? `Delete ${modal.dev.path}${modal.dev.is_rack ? ` and the ${modal.dev.rack_device_count} devices inside it` : ''}? Connections are removed.` : ''} onConfirm={async () => { if (modal?.kind === 'delDevice') { await api.del(`/devices/${modal.dev.id}`); setSel({ kind: 'floor' }); await refresh(); } }} />
    <Confirm open={modal?.kind === 'delRoom'} onClose={() => setModal(null)} title="Delete room" text={modal?.kind === 'delRoom' ? `Delete room ${modal.room.code}? Its ${modal.room.device_count} devices move to DEFAULT.` : ''} onConfirm={async () => { if (modal?.kind === 'delRoom') { await api.del(`/rooms/${modal.room.id}`); setSel({ kind: 'floor' }); await refresh(); } }} />
    <Confirm open={modal?.kind === 'delFloor'} onClose={() => setModal(null)} title="Delete floor" text={`Delete floor ${floor.code} with all rooms, devices and connections on it?`} onConfirm={async () => { const other = data.floors.find((f) => f.id !== floorId); await api.del(`/floors/${floorId}`); await refresh(); nav(other ? `/floors/${other.id}` : '/locations'); }} />
  </div>;
}

function DeviceSidebar({ id, canEdit, onChanged, selPort, setSelPort, types, connectOpen, setConnectOpen }: { id: number; canEdit: boolean; onChanged: () => Promise<unknown>; selPort: number | null; setSelPort: (v: number | null) => void; types?: DeviceType[]; connectOpen: boolean; setConnectOpen: (v: boolean) => void }) {
  const q = useQuery({ queryKey: ['device', id], queryFn: () => api.get<DeviceDetail>(`/devices/${id}`) });
  if (!q.data) return <Loading />;
  const d = q.data;
  return <DeviceSettings device={d} canEdit={canEdit} onChanged={async () => { await q.refetch(); await onChanged(); }} selectedPortId={selPort} onSelectPort={setSelPort} types={types}
    extraTop={d.is_rack ? <Link to={`/racks/${d.id}`} className="sidebar-link">Configure rack</Link> : undefined} openConnect={connectOpen} onConnectClosed={() => setConnectOpen(false)} />;
}

function Palette({ types, canEdit }: { types: DeviceType[]; canEdit: boolean }) {
  const [q, setQ] = useState('');
  const list = types.filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()));
  return <div className="palette-panel"><div className="palette-head"><h3>Devices</h3><div className="muted tiny">Drag device to a room to add it.</div><div style={{ position: 'relative', marginTop: 6 }}><Search size={12} className="muted" style={{ position: 'absolute', left: 7, top: 8 }} /><input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 22, fontSize: 12 }} /></div></div>
    <div className="palette-list-items">{list.map((t) => <div key={t.id} className="palette-item-dev" draggable={canEdit} onDragStart={(e) => { e.dataTransfer.setData('text/rd-type', String(t.id)); e.dataTransfer.effectAllowed = 'copy'; }}><DeviceIcon name={t.icon} size={14} /><span>{t.name}</span></div>)}</div></div>;
}

function FloorCanvas({ data, W, H, view, setView, tool, setTool, draw, setDraw, sel, setSel, canEdit, onMoveDevice, onDropType, onRoomDrawn, onScaleDrawn, onRoomPoints, saveStatus, bottom, pill }: {
  data: FloorView; W: number; H: number; view: View; setView: (v: View) => void; tool: Tool; setTool: (t: Tool) => void; draw: null | { kind: 'rect'; a: Pt; b: Pt } | { kind: 'poly'; pts: Pt[]; cur: Pt | null } | { kind: 'scale'; a: Pt; b: Pt | null }; setDraw: (d: FloorCanvasDraw) => void;
  sel: Sel; setSel: (s: Sel) => void; canEdit: boolean; onMoveDevice: (id: number, x: number, y: number) => void; onDropType: (typeId: number, x: number, y: number) => void; onRoomDrawn: (pts: Pt[]) => void; onScaleDrawn: (px: number) => void; onRoomPoints: (id: number, pts: Pt[]) => void;
  saveStatus: 'saved' | 'saving' | 'error'; bottom: React.ReactNode; pill: null | { dev: FloorDevice; onEdit?: () => void; onConnect?: () => void; onDelete: () => void } }) {
  const svgRef = useRef<SVGSVGElement>(null); const wrapRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<null | { kind: 'pan'; sx: number; sy: number; v: View } | { kind: 'device'; id: number; dx: number; dy: number; x: number; y: number; moved: boolean } | { kind: 'vertex'; room: Room; i: number; pts: Pt[] }>(null);
  const [, bump] = useState(0);
  useEffect(() => { const ro = new ResizeObserver(() => bump((n) => n + 1)); if (wrapRef.current) ro.observe(wrapRef.current); return () => ro.disconnect(); }, []);
  const toPlan = (e: { clientX: number; clientY: number }) => clientToPlan(e, svgRef.current!, W, H, view);
  const s = svgRef.current ? Math.min(svgRef.current.getBoundingClientRect().width / W, svgRef.current.getBoundingClientRect().height / H) || 1 : 1;
  const u = 1 / (s * view.k); // plan units per screen pixel
  const floor = data.floor;
  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = toPlan(e);
    if (tool === 'rect' && canEdit) { setDraw({ kind: 'rect', a: [p.x, p.y], b: [p.x, p.y] }); return; }
    if (tool === 'poly' && canEdit) {
      const d = draw?.kind === 'poly' ? draw : { kind: 'poly' as const, pts: [] as Pt[], cur: null };
      if (d.pts.length >= 3 && Math.hypot(d.pts[0][0] - p.x, d.pts[0][1] - p.y) < 10 * u) { onRoomDrawn(d.pts); return; }
      setDraw({ kind: 'poly', pts: [...d.pts, [p.x, p.y]], cur: [p.x, p.y] }); return;
    }
    if (tool === 'scale') { if (draw?.kind === 'scale' && !draw.b) { const px = Math.hypot(draw.a[0] - p.x, draw.a[1] - p.y); setDraw({ kind: 'scale', a: draw.a, b: [p.x, p.y] }); onScaleDrawn(px); } else setDraw({ kind: 'scale', a: [p.x, p.y], b: null }); return; }
    setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, v: view }); (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const p = toPlan(e);
    if (draw?.kind === 'rect') { setDraw({ ...draw, b: [p.x, p.y] }); return; }
    if (draw?.kind === 'poly') { setDraw({ ...draw, cur: [p.x, p.y] }); return; }
    if (draw?.kind === 'scale' && !draw.b) { setDraw({ ...draw }); return; }
    if (!drag) return;
    if (drag.kind === 'pan') { setView({ ...drag.v, tx: drag.v.tx + (e.clientX - drag.sx) / s, ty: drag.v.ty + (e.clientY - drag.sy) / s }); }
    else if (drag.kind === 'device') { setDrag({ ...drag, x: p.x - drag.dx, y: p.y - drag.dy, moved: true }); }
    else if (drag.kind === 'vertex') { const pts = drag.pts.map((pt, i) => i === drag.i ? [p.x, p.y] as Pt : pt); setDrag({ ...drag, pts }); }
  };
  const onUp = (e: RPointerEvent<SVGSVGElement>) => {
    if (draw?.kind === 'rect') { const [a, b] = [draw.a, draw.b]; if (Math.abs(a[0] - b[0]) > 5 * u && Math.abs(a[1] - b[1]) > 5 * u) onRoomDrawn([[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]]); else setDraw(null); return; }
    if (!drag) return;
    if (drag.kind === 'pan') { if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3 && tool === 'select') setSel({ kind: 'floor' }); }
    else if (drag.kind === 'device') { if (drag.moved) onMoveDevice(drag.id, Math.round(drag.x), Math.round(drag.y)); setSel({ kind: 'device', id: drag.id }); }
    else if (drag.kind === 'vertex') { onRoomPoints(drag.room.id, drag.pts.map(([x, y]) => [Math.round(x), Math.round(y)])); }
    setDrag(null);
  };
  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => { const r = svgRef.current!.getBoundingClientRect(); const ox = (r.width - W * s) / 2, oy = (r.height - H * s) / 2; const cx = (e.clientX - r.left - ox) / s, cy = (e.clientY - r.top - oy) / s; setView(zoomAt(view, e.deltaY < 0 ? 1.15 : 1 / 1.15, cx, cy)); };
  const zoomBtn = (f: number) => setView(zoomAt(view, f, W / 2, H / 2));
  const pos = (d: FloorDevice): Pt => drag?.kind === 'device' && drag.id === d.id ? [drag.x, drag.y] : [d.x, d.y];
  const devById = new Map(data.devices.map((d) => [d.id, d]));
  const pinR = 13 * u; const fs = 11 * u;
  const pillPos = pill && svgRef.current ? planToClient(pos(pill.dev)[0], pos(pill.dev)[1] - pinR * 2.1, svgRef.current, W, H, view) : null;
  const roomPts = (r: Room) => drag?.kind === 'vertex' && drag.room.id === r.id ? drag.pts : r.points;
  const hintText = tool === 'rect' ? 'Drag to draw a rectangular room · Esc to cancel' : tool === 'poly' ? 'Click to add points · click the first (green) point to close · Esc to cancel' : tool === 'scale' ? 'Click two points of a known distance on the plan' : null;
  return <div className="canvas-area" ref={wrapRef}>
    <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
      <div className="tool-col">
        {canEdit && <><IconBtn title="Draw a rectangular room" active={tool === 'rect'} onClick={() => { setTool(tool === 'rect' ? 'select' : 'rect'); setDraw(null); }}><Square size={15} /></IconBtn><IconBtn title="Draw a polygon room" active={tool === 'poly'} onClick={() => { setTool(tool === 'poly' ? 'select' : 'poly'); setDraw(null); }}><Pentagon size={15} /></IconBtn><div className="tool-sep" /></>}
        <IconBtn title="Zoom in" onClick={() => zoomBtn(1.25)}><ZoomIn size={15} /></IconBtn><IconBtn title="Zoom out" onClick={() => zoomBtn(0.8)}><ZoomOut size={15} /></IconBtn><IconBtn title="Reset zoom and position" onClick={() => setView({ k: 1, tx: 0, ty: 0 })}><Scan size={15} /></IconBtn><IconBtn title="Fit" onClick={() => setView({ k: 1, tx: 0, ty: 0 })}><Maximize size={15} /></IconBtn>
      </div>
      <div className="canvas-topright"><SaveStatus status={saveStatus} /></div>
      {hintText && <div className="canvas-hint">{hintText}</div>}
      {pill && pillPos && <div className="ctx-pill" style={{ left: pillPos.x, top: pillPos.y }}><IconBtn title="Move (drag the pin)"><Move size={14} /></IconBtn>{pill.onEdit && <IconBtn title="Open rack editor" onClick={pill.onEdit}><Pencil size={14} /></IconBtn>}{pill.onConnect && <IconBtn title="Connect" onClick={pill.onConnect}><Plug size={14} /></IconBtn>}<IconBtn title="Delete" onClick={pill.onDelete}><Trash2 size={14} /></IconBtn></div>}
      <svg ref={svgRef} className="editor-canvas" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ cursor: tool === 'select' ? (drag?.kind === 'pan' ? 'grabbing' : 'default') : 'crosshair' }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)} onWheel={onWheel}
        onDragOver={(e) => { if (canEdit && e.dataTransfer.types.includes('text/rd-type')) e.preventDefault(); }} onDrop={(e) => { const t = Number(e.dataTransfer.getData('text/rd-type')); if (t) { e.preventDefault(); const p = toPlan(e); onDropType(t, Math.round(p.x), Math.round(p.y)); } }}>
        <defs><pattern id="grid" width={100} height={100} patternUnits="userSpaceOnUse"><path d="M 100 0 L 0 0 0 100" fill="none" stroke="var(--border)" strokeWidth={1} /></pattern></defs>
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
          <rect x={0} y={0} width={W} height={H} fill={floor.plan_uuid ? 'var(--surface)' : 'url(#grid)'} stroke="var(--border)" />
          {floor.plan_uuid && <image href={`/api/files/${floor.plan_uuid}`} x={0} y={0} width={W} height={H} opacity={floor.plan_opacity / 100} style={{ filter: `contrast(${floor.plan_contrast}%)` }} preserveAspectRatio="none" />}
          {data.rooms.map((r) => { const pts = roomPts(r); const c = centroid(pts); const active = sel.kind === 'room' && sel.id === r.id; return <g key={r.id} onPointerDown={(e) => { if (tool !== 'select') return; e.stopPropagation(); setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, v: view }); }} onPointerUp={(e) => { if (tool === 'select' && drag?.kind === 'pan' && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) { e.stopPropagation(); setDrag(null); setSel({ kind: 'room', id: r.id }); } }}>
            <polygon points={pts.map((p) => p.join(',')).join(' ')} fill={active ? 'rgba(245,158,11,0.28)' : 'rgba(245,158,11,0.14)'} stroke="var(--building)" strokeWidth={(active ? 3 : 2) * u} />
            <text x={c[0]} y={c[1]} fontSize={fs * 1.4} fontWeight={700} fill="#b45309" textAnchor="middle" opacity={0.8} style={{ pointerEvents: 'none' }}>{r.code}</text>
            {active && canEdit && pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={6 * u} fill="var(--surface)" stroke="var(--building)" strokeWidth={2 * u} style={{ cursor: 'move' }} onPointerDown={(e) => { e.stopPropagation(); setDrag({ kind: 'vertex', room: r, i, pts }); (e.target as Element).setPointerCapture?.(e.pointerId); }} />)}
          </g>; })}
          {data.connections.filter((c) => c.on_floor).map((c) => { const a = devById.get(c.a.anchor_id), b = devById.get(c.b.anchor_id); if (!a || !b || a.id === b.id) return null; const pa = pos(a), pb = pos(b); const hi = sel.kind === 'device' && (sel.id === a.id || sel.id === b.id);
            return <line key={c.id} x1={pa[0]} y1={pa[1]} x2={pb[0]} y2={pb[1]} stroke={c.type === 'building' ? 'var(--building)' : 'var(--user)'} strokeWidth={(hi ? 3 : 2) * u} strokeDasharray={c.type === 'building' ? `${8 * u} ${6 * u}` : undefined} opacity={hi ? 1 : 0.8} />; })}
          {data.devices.map((d) => { const [x, y] = pos(d); const active = sel.kind === 'device' && sel.id === d.id; const fill = active ? 'var(--primary)' : d.is_rack ? 'var(--pin-rack)' : d.passive ? 'var(--pin-passive)' : 'var(--pin)';
            return <g key={d.id} transform={`translate(${x} ${y})`} style={{ cursor: canEdit ? 'grab' : 'pointer' }} onPointerDown={(e) => { if (tool !== 'select') return; e.stopPropagation(); const p = toPlan(e); setDrag({ kind: 'device', id: d.id, dx: p.x - d.x, dy: p.y - d.y, x: d.x, y: d.y, moved: false }); (e.target as Element).setPointerCapture?.(e.pointerId); }}>
              <path d={`M 0 0 L ${-pinR * 0.75} ${-pinR * 1.3} A ${pinR} ${pinR} 0 1 1 ${pinR * 0.75} ${-pinR * 1.3} Z`} fill={fill} stroke="var(--surface)" strokeWidth={1.5 * u} />
              <svg x={-pinR * 0.55} y={-pinR * 2.1} width={pinR * 1.1} height={pinR * 1.1} viewBox="0 0 24 24" style={{ pointerEvents: 'none' }}><DeviceIcon name={d.type_icon} size={24} color={active ? '#fff' : 'var(--bg)'} /></svg>
              <text x={0} y={fs * 1.3} fontSize={fs} fontWeight={600} textAnchor="middle" fill="var(--text)" stroke="var(--surface)" strokeWidth={3 * u} paintOrder="stroke" style={{ pointerEvents: 'none' }}>{d.code}</text>
              <title>{d.path} · {d.type_name}{d.name ? ` · ${d.name}` : ''}</title></g>; })}
          {draw?.kind === 'rect' && <rect x={Math.min(draw.a[0], draw.b[0])} y={Math.min(draw.a[1], draw.b[1])} width={Math.abs(draw.a[0] - draw.b[0])} height={Math.abs(draw.a[1] - draw.b[1])} fill="rgba(37,99,235,0.12)" stroke="var(--primary)" strokeWidth={2 * u} strokeDasharray={`${6 * u} ${4 * u}`} />}
          {draw?.kind === 'poly' && <g><polyline points={[...draw.pts, ...(draw.cur ? [draw.cur] : [])].map((p) => p.join(',')).join(' ')} fill="rgba(37,99,235,0.12)" stroke="var(--primary)" strokeWidth={2 * u} />{draw.pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={6 * u} fill={i === 0 ? 'var(--ok)' : 'var(--primary)'} stroke="#fff" strokeWidth={1.5 * u} />)}</g>}
          {draw?.kind === 'scale' && <g><circle cx={draw.a[0]} cy={draw.a[1]} r={5 * u} fill="var(--danger)" />{draw.b && <><line x1={draw.a[0]} y1={draw.a[1]} x2={draw.b[0]} y2={draw.b[1]} stroke="var(--danger)" strokeWidth={2 * u} /><circle cx={draw.b[0]} cy={draw.b[1]} r={5 * u} fill="var(--danger)" /></>}</g>}
        </g>
      </svg>
    </div>
    {bottom}
  </div>;
}
type FloorCanvasDraw = null | { kind: 'rect'; a: Pt; b: Pt } | { kind: 'poly'; pts: Pt[]; cur: Pt | null } | { kind: 'scale'; a: Pt; b: Pt | null };

function BottomPanel({ data, open, setOpen, tab, setTab, onSelect }: { data: FloorView; open: boolean; setOpen: (v: boolean) => void; tab: string; setTab: (t: string) => void; onSelect: (id: number) => void }) {
  const [tall, setTall] = useState(false);
  const seen = new Set<string>(); const conns = data.connections.filter((c) => { if (!c.chain) return false; const k = [c.chain.from, c.chain.to].sort().join('|'); if (seen.has(k)) return false; seen.add(k); return true; });
  return <div className="bottom-panel">
    <div className="bottom-head" onClick={() => setOpen(!open)}><PanelBottom size={14} /><span>DEVICES & CONNECTIONS</span>{open && <span onClick={(e) => e.stopPropagation()}><Tabs pill tabs={[{ id: 'devices', label: 'DEVICES' }, { id: 'connections', label: 'CONNECTIONS' }]} value={tab} onChange={setTab} /></span>}<span className="grow" /><IconBtn title={tall ? 'Smaller' : 'Larger'} onClick={(e) => { e.stopPropagation(); setTall(!tall); setOpen(true); }}><Maximize size={13} /></IconBtn></div>
    {open && <div className={`bottom-body${tall ? ' tall' : ''}`}>{tab === 'devices' ? <table className="table"><thead><tr><th>ID</th><th>Name</th><th>Room</th><th>Type</th><th>Ports</th><th>Connected</th><th>Created</th></tr></thead><tbody>
      {data.devices.map((d) => <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => onSelect(d.id)}><td className="code">{d.code}</td><td>{d.name || <span className="muted">-</span>}</td><td>{d.room_code ?? 'DEFAULT'}</td><td>{d.type_name}</td><td>{d.is_rack ? `${d.rack_device_count} devices` : d.port_count}</td><td>{d.is_rack ? '' : d.connected_ports}</td><td>{fmtDate(d.created_at)}</td></tr>)}
      {data.devices.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 18 }}>No devices on this floor yet.</td></tr>}</tbody></table>
      : <ConnectionsTable rows={conns} />}</div>}
  </div>;
}

function FloorSettings({ floor, canEdit, onChanged, onRescale, onNotes }: { floor: FloorView['floor']; canEdit: boolean; onChanged: () => Promise<unknown>; onRescale: () => void; onNotes: () => void }) {
  const toast = useToast();
  const { values, set, status } = useAutosave({ code: floor.code, level: floor.level, name: floor.name, responsible_user_id: floor.responsible_user_id, plan_opacity: floor.plan_opacity, plan_contrast: floor.plan_contrast }, (p) => api.patch(`/floors/${floor.id}`, p).then(onChanged), floor.id + ':' + floor.updated_at);
  const dis = !canEdit;
  return <div className="sidebar-scroll"><div className="palette-rail" style={{ display: 'none' }} />
    <Section title="Settings" right={<SaveStatus status={status} />}>
      <div className="form-row"><Field label="ID" required><input value={values.code} onChange={(e) => set('code', e.target.value.toUpperCase())} disabled={dis} className="code" /></Field><Field label="Level"><input type="number" value={values.level} onChange={(e) => set('level', Number(e.target.value))} disabled={dis} /></Field></div>
      <Field label="Name"><input value={values.name} onChange={(e) => set('name', e.target.value)} disabled={dis} /></Field>
      <Field label="Responsible person"><PersonSelect value={values.responsible_user_id} onChange={(v) => set('responsible_user_id', v, true)} disabled={dis} /></Field>
      <div className="field-label">Floor plan</div>
      {canEdit && <label className="btn" style={{ justifyContent: 'center' }}><Upload size={13} /> {floor.plan_uuid ? 'Replace floor plan' : 'Upload floor plan'}<input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const { w, h } = await imageSize(f); await api.upload(`/floors/${floor.id}/plan`, f, `&w=${w}&h=${h}`); await onChanged(); toast('Floor plan uploaded. Now scale it with a known distance.'); } catch (ex) { toast(errMsg(ex), 'error'); } e.target.value = ''; }} /></label>}
      <div className="muted tiny">PNG, JPG, WEBP</div>
      <div className="form-row"><Field label="Plan opacity"><input type="number" min={0} max={100} value={values.plan_opacity} onChange={(e) => set('plan_opacity', Number(e.target.value))} disabled={dis} /></Field><Field label="Plan contrast"><input type="number" min={0} max={200} value={values.plan_contrast} onChange={(e) => set('plan_contrast', Number(e.target.value))} disabled={dis} /></Field></div>
      {floor.plan_uuid && canEdit && <button className="btn" style={{ justifyContent: 'center' }} onClick={onRescale}><Ruler size={13} /> {floor.plan_scale ? 'Rescale floor plan' : 'Scale floor plan'}</button>}
      {floor.plan_scale && <div className="muted tiny">Scale: {floor.plan_scale.toFixed(1)} px per metre</div>}
      {floor.plan_uuid && canEdit && <button className="btn-link small" style={{ color: 'var(--danger)' }} onClick={async () => { await api.del(`/floors/${floor.id}/plan`); onChanged(); }}>Remove floor plan</button>}
    </Section>
    <Section title="Notes"><div className="notes-box">{floor.notes || <span className="muted">Add your first note…</span>}</div>{canEdit && <button className="btn-link small" onClick={onNotes}><Pencil size={11} /> Edit</button>}</Section>
  </div>;
}
function RoomSettings({ room, canEdit, onChanged, onDelete }: { room: Room; canEdit: boolean; onChanged: () => Promise<unknown>; onDelete: () => void }) {
  const { values, set, status } = useAutosave({ code: room.code, name: room.name, responsible_user_id: room.responsible_user_id, notes: room.notes }, (p) => api.patch(`/rooms/${room.id}`, p).then(onChanged), room.id + ':' + room.updated_at);
  const dis = !canEdit;
  return <div className="sidebar-scroll"><Section title="Room settings" right={<SaveStatus status={status} />}>
    <Field label="ID" required><input value={values.code} onChange={(e) => set('code', e.target.value.toUpperCase())} disabled={dis} className="code" /></Field>
    <Field label="Name"><input value={values.name} onChange={(e) => set('name', e.target.value)} disabled={dis} /></Field>
    <Field label="Responsible person"><PersonSelect value={values.responsible_user_id} onChange={(v) => set('responsible_user_id', v, true)} disabled={dis} /></Field>
    <Field label="Notes"><textarea rows={3} value={values.notes} onChange={(e) => set('notes', e.target.value)} disabled={dis} /></Field>
    <div className="muted tiny">{room.device_count} devices · drag the orange handles to reshape the room</div>
    {canEdit && <button className="btn btn-sm" style={{ color: 'var(--danger)' }} onClick={onDelete}><Trash2 size={12} /> Delete room</button>}
  </Section></div>;
}
function FloorForm({ locationId, onDone }: { locationId: number; onDone: (f?: { id: number }) => void }) {
  const [code, setCode] = useState(''); const [name, setName] = useState(''); const [level, setLevel] = useState(1);
  return <Form submitLabel="Add floor" onCancel={() => onDone()} onSubmit={async () => { const f = await api.post<{ id: number }>(`/locations/${locationId}/floors`, { code, name, level: Number(level) }); onDone(f); }}>
    <div className="form-row"><Field label="ID" required hint="e.g. 1, 27, B1"><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required autoFocus className="code" /></Field><Field label="Level" hint="Sort order"><input type="number" value={level} onChange={(e) => setLevel(Number(e.target.value))} /></Field></div>
    <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 27th Floor" /></Field></Form>;
}
function AddDeviceForm({ data, types, preset, onDone }: { data: FloorView; types: DeviceType[]; preset: { x?: number; y?: number; typeId?: number }; onDone: (id?: number) => void }) {
  const [roomId, setRoomId] = useState<number | null>(null); const [typeId, setTypeId] = useState(preset.typeId ?? 0); const [code, setCode] = useState(''); const [name, setName] = useState(''); const [autoRoom, setAutoRoom] = useState(true);
  // Without a drop position, place the device in the chosen room (or the plan centre), nudged so successive devices do not stack.
  const placed = useMemo(() => {
    if (preset.x !== undefined && preset.y !== undefined) return { x: preset.x, y: preset.y };
    const room = data.rooms.find((r) => r.id === roomId);
    const base = room ? centroid(room.points) : [data.floor.plan_w / 2, data.floor.plan_h / 2] as [number, number];
    const n = data.devices.filter((d) => (d.room_id ?? null) === roomId).length;
    return { x: Math.round(base[0] + (n % 5) * 60 - 120), y: Math.round(base[1] + 40 + Math.floor(n / 5) * 60) };
  }, [preset.x, preset.y, roomId, data]);
  const x = placed.x, y = placed.y;
  useEffect(() => { if (preset.x !== undefined) api.get<{ room_id: number | null }>(`/floors/${data.floor.id}/room-at?x=${x}&y=${y}`).then((r) => setRoomId(r.room_id)).catch(() => {}); }, [data.floor.id, x, y, preset.x]);
  const type = types.find((t) => t.id === typeId);
  useEffect(() => { if (!type) { setCode(''); return; } const used = new Set(data.devices.filter((d) => (d.room_id ?? null) === roomId).map((d) => d.code)); let n = 1; while (used.has(`${type.prefix}${String(n).padStart(2, '0')}`)) n++; setCode(`${type.prefix}${String(n).padStart(2, '0')}`); }, [type, roomId, data.devices]);
  return <Form submitLabel="Add device" onCancel={() => onDone()} onSubmit={async () => { if (!typeId) throw new Error('Select a device type'); const d = await api.post<{ id: number }>(`/floors/${data.floor.id}/devices`, { device_type_id: typeId, code, name, room_id: roomId, x, y }); onDone(d.id); }}>
    <Field label="Floor" inline><input value={`${data.floor.location_code}/${data.floor.code}`} disabled /></Field>
    <Field label="Room" inline><select value={roomId ?? ''} onChange={(e) => { setRoomId(e.target.value ? Number(e.target.value) : null); setAutoRoom(false); }}><option value="">DEFAULT</option>{data.rooms.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}</select></Field>
    <Field label="Device type" inline required><select value={typeId} onChange={(e) => setTypeId(Number(e.target.value))} autoFocus><option value={0}>Select type</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
    <Field label="ID" inline required><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required className="code" /></Field>
    <Field label="Name" inline><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
    {preset.x !== undefined && <div className="muted tiny">Placed at ({x}, {y}){autoRoom ? ' · room detected from position' : ''}</div>}
  </Form>;
}
function RoomForm({ floorId, points, onDone }: { floorId: number; points: Pt[]; onDone: (id?: number) => void }) {
  const [code, setCode] = useState(''); const [name, setName] = useState('');
  return <Form submitLabel="Create room" onCancel={() => onDone()} onSubmit={async () => { const r = await api.post<{ id: number; adopted: number }>(`/floors/${floorId}/rooms`, { code, name, points: points.map(([x, y]) => [Math.round(x), Math.round(y)]) }); onDone(r.id); }}>
    <Field label="Room ID" required hint="Short and unique on this floor, e.g. MDF, MEET01, SRV"><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required autoFocus className="code" /></Field><Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
    <div className="muted small">{points.length} points. Devices already inside this outline move into the room.</div></Form>;
}
function ScaleForm({ px, onDone }: { px: number; onDone: (metres: number | null) => void }) {
  const [m, setM] = useState(''); return <Form submitLabel="Set scale" onCancel={() => onDone(null)} onSubmit={() => onDone(Number(m))}><Field label="Real-world distance (metres)" hint={`${px.toFixed(0)} px on the plan`}><input type="number" step="0.01" min="0.01" value={m} onChange={(e) => setM(e.target.value)} required autoFocus /></Field></Form>;
}
function LocationLoader({ id, onDone }: { id: number; onDone: () => void }) { const q = useQuery({ queryKey: ['location', id], queryFn: () => api.get<Location>(`/locations/${id}`) }); if (!q.data) return <Loading />; return <LocationForm initial={q.data} onDone={onDone} />; }
function LocationInfo({ id }: { id: number }) { const q = useQuery({ queryKey: ['location', id], queryFn: () => api.get<Location>(`/locations/${id}`) }); if (!q.data) return <Loading />; const l = q.data; return <dl className="kv" style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 10px', margin: 0 }}><dt className="muted">ID</dt><dd className="code" style={{ margin: 0 }}>{l.code}</dd><dt className="muted">Address</dt><dd style={{ margin: 0 }}>{l.address || '-'}</dd><dt className="muted">Responsible</dt><dd style={{ margin: 0 }}>{l.responsible_name ?? 'Unassigned'}</dd><dt className="muted">Contact</dt><dd style={{ margin: 0 }}>{l.contact || '-'}</dd><dt className="muted">Floors / rooms / devices</dt><dd style={{ margin: 0 }}>{l.floor_count} / {l.room_count} / {l.device_count}</dd>{l.notes && <><dt className="muted">Notes</dt><dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{l.notes}</dd></>}</dl>; }
export function ShortcutsHelp() {
  const rows: [string, string][] = [['Ctrl K', 'Open global search'], ['Ctrl B', 'Toggle the main menu'], ['Ctrl H', 'Toggle editor panels'], ['Esc', 'Cancel room drawing or measurement'], ['Backspace / Delete', 'Delete the selected connection (Rack Editor)'], ['Mouse wheel', 'Zoom the canvas'], ['Drag empty space', 'Pan the canvas']];
  return <table className="table">{rows.map(([k, v]) => <tbody key={k}><tr><td><kbd>{k}</kbd></td><td>{v}</td></tr></tbody>)}</table>;
}
