import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plug, Unplug, Pencil, Trash2, Route, Plus, Search, MapPin, Layers, DoorOpen, Server, Check, Palette, X, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { DeviceIcon } from '../lib/icons';
import type { Candidate, DeviceDetail, DeviceType, Port, Tree, Trace, Vlan, Wlan } from '../lib/types';
import { Confirm, Dialog, Field, Form, IconBtn, Loading, Section, PersonSelect, useAutosave, useToast, errMsg, SaveStatus, Badge, ErrorBox } from './ui';
import { PORT_KIND_LABEL } from '../pages/DeviceLibrary';

export const PRESET_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#f59e0b', '#7c3aed', '#0891b2', '#db2777', '#4b5563', '#111827', '#f8fafc'];
export function portLink(p: { rack_id: number | null; floor_id: number; device_id: number }) { return p.rack_id ? `/racks/${p.rack_id}?device=${p.device_id}` : `/floors/${p.floor_id}?device=${p.device_id}`; }

// ---------- Device settings (shared by both editors) ----------
export function DeviceSettings({ device, canEdit, onChanged, selectedPortId, onSelectPort, types, extraTop, isRackEditor, openConnect, onConnectClosed }: { device: DeviceDetail; canEdit: boolean; onChanged: () => Promise<unknown>; selectedPortId: number | null; onSelectPort: (id: number | null) => void; types?: DeviceType[]; extraTop?: ReactNode; isRackEditor?: boolean; openConnect?: boolean; onConnectClosed?: () => void }) {
  const toast = useToast();
  const save = (patch: Record<string, unknown>) => api.patch(`/devices/${device.id}`, patch).then(onChanged);
  const { values, set, status } = useAutosave({ code: device.code, name: device.name, responsible_user_id: device.responsible_user_id, room_id: device.room_id, device_type_id: device.device_type_id, height_u: device.height_u, position_u: device.position_u ?? 1, slot_x: device.slot_x,
    manufacturer: device.manufacturer, model: device.model, serial: device.serial, purchase_date: device.purchase_date, operation_start: device.operation_start, notes: device.notes }, save, device.id + ':' + device.updated_at);
  const rooms = useQuery({ queryKey: ['floor-rooms', device.floor_id], queryFn: () => api.get<{ rooms: { id: number; code: string }[] }>(`/floors/${device.floor_id}/view`).then((v) => v.rooms), enabled: !device.rack_id });
  const [modal, setModal] = useState<null | 'connect' | 'building' | 'addPort' | 'notes' | { trace: number } | { delPort: Port }>(null);
  const [connectPort, setConnectPort] = useState<Port | null>(null);
  const dis = !canEdit;
  const port = device.ports.find((p) => p.id === selectedPortId) ?? null;
  useEffect(() => { if (openConnect) { const p = device.ports.find((x) => x.id === selectedPortId) ?? device.ports.find((x) => !x.user && (x.passive === 0 || x.keystone)) ?? null; if (p) { setConnectPort(p); setModal('connect'); } else { toast('No free port to connect', 'error'); onConnectClosed?.(); } } }, [openConnect]); // eslint-disable-line react-hooks/exhaustive-deps
  const closeModal = () => { setModal(null); if (modal === 'connect') onConnectClosed?.(); };
  const f = (label: string, key: keyof typeof values, type = 'text') => <Field label={label}><input type={type} value={String(values[key] ?? '')} onChange={(e) => set(key, (type === 'number' ? Number(e.target.value) : e.target.value) as never)} disabled={dis} /></Field>;
  return <div className="sidebar-scroll">
    {extraTop}
    {device.passive === 1 && canEdit && <button className="sidebar-link" onClick={() => setModal('building')} title="Record the permanent cabling behind each port: which outlet or patch panel port it runs to">Manage building connections</button>}
    <Section title="Settings" right={<SaveStatus status={status} />}>
      <Field label="ID" required><input value={values.code} onChange={(e) => set('code', e.target.value.toUpperCase())} disabled={dis} className="code" /></Field>
      {f('Name', 'name')}
      <Field label="Responsible person"><PersonSelect value={values.responsible_user_id} onChange={(v) => set('responsible_user_id', v, true)} disabled={dis} /></Field>
      {!device.rack_id && <Field label="Room"><select value={values.room_id ?? ''} onChange={(e) => set('room_id', e.target.value ? Number(e.target.value) : null, true)} disabled={dis}><option value="">DEFAULT</option>{rooms.data?.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}</select></Field>}
      {!device.rack_id && types && <Field label="Device type"><select value={values.device_type_id} onChange={(e) => set('device_type_id', Number(e.target.value), true)} disabled={dis}>{types.filter((t) => t.kind === 'floor' && !!t.is_rack === !!device.is_rack).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>}
      {device.rack_id ? <div className="form-row"><Field label="Rack unit (bottom)"><input type="number" min={1} value={values.position_u} onChange={(e) => set('position_u', Number(e.target.value))} disabled={dis} /></Field>{device.width_pct < 100 ? <Field label="Horizontal (%)" hint={`${device.width_pct}% wide`}><input type="number" min={0} max={100 - device.width_pct} step={Math.round(100 / 12)} value={values.slot_x} onChange={(e) => set('slot_x', Number(e.target.value))} disabled={dis} /></Field> : <Field label="Width"><input value={device.is_tray ? 'Tray (full)' : 'Full'} disabled /></Field>}</div> : null}
      {device.is_rack ? <Field label="Rack units" hint={isRackEditor ? undefined : 'Please configure in rack editor.'}><input type="number" min={1} max={60} value={values.height_u} onChange={(e) => set('height_u', Number(e.target.value))} disabled={dis || !isRackEditor} /></Field> : null}
      {device.template_name && <Field label="Template"><input value={device.template_name} disabled /></Field>}
      {f('Manufacturer', 'manufacturer')}{f('Model name', 'model')}{f('Serial number', 'serial')}{f('Purchase date', 'purchase_date', 'date')}{f('Operation start', 'operation_start', 'date')}
    </Section>
    {!device.is_rack && <PortsSection device={device} canEdit={canEdit} selectedPortId={selectedPortId} onSelectPort={onSelectPort} onChanged={onChanged} onConnect={(p) => { setConnectPort(p); setModal('connect'); }} onTrace={(p) => setModal({ trace: p.id })} onAdd={() => setModal('addPort')} onDelete={(p) => setModal({ delPort: p })} onManageBuilding={() => setModal('building')} />}
    {port && <PortSettings port={port} canEdit={canEdit} onChanged={onChanged} />}
    <Section title="Photos" defaultOpen={device.photos.length > 0}>
      <div className="photos">{device.photos.map((ph) => <a key={ph.id} href={`/api/files/${ph.uuid}`} target="_blank" rel="noreferrer"><img className="photo" src={`/api/files/${ph.uuid}`} alt={ph.name} title={canEdit ? 'Click to open · shift-click to remove' : ph.name} onClick={async (e) => { if (e.shiftKey && canEdit) { e.preventDefault(); await api.del(`/photos/${ph.id}`); onChanged(); } }} /></a>)}</div>
      {canEdit && <label className="upload-box"><Upload size={14} /> Upload photos<input type="file" accept="image/png,image/jpeg,image/webp" multiple style={{ display: 'none' }} onChange={async (e) => { for (const file of Array.from(e.target.files ?? [])) { try { await api.upload(`/devices/${device.id}/photos`, file); } catch (ex) { toast(errMsg(ex), 'error'); } } onChanged(); e.target.value = ''; }} /></label>}
    </Section>
    <Section title="Notes"><div className="notes-box">{values.notes || <span className="muted">Add your first note…</span>}</div>{canEdit && <button className="btn-link small" onClick={() => setModal('notes')}><Pencil size={11} /> Edit</button>}</Section>

    <Dialog open={modal === 'connect'} onClose={closeModal} title={<>Connection Configurator: <span className="code">{device.code}</span></>} wide>{modal === 'connect' && connectPort && <ConnectionConfigurator device={device} port={connectPort} onDone={() => { closeModal(); onChanged(); }} />}</Dialog>
    <Dialog open={modal === 'building'} onClose={() => setModal(null)} title={<>Building connections: <span className="code">{device.code}</span></>} wide="xl">{modal === 'building' && <BuildingConnectionsDialog device={device} onDone={() => { setModal(null); onChanged(); }} />}</Dialog>
    <Dialog open={modal === 'addPort'} onClose={() => setModal(null)} title="Add port">{modal === 'addPort' && <AddPortForm deviceId={device.id} onDone={() => { setModal(null); onChanged(); }} />}</Dialog>
    <Dialog open={typeof modal === 'object' && modal !== null && 'trace' in modal} onClose={() => setModal(null)} title="Connection Overview">{typeof modal === 'object' && modal !== null && 'trace' in modal && <TraceView portId={modal.trace} />}</Dialog>
    <Dialog open={modal === 'notes'} onClose={() => setModal(null)} title={`Notes · ${device.code}`}>{modal === 'notes' && <NotesEditor value={values.notes} onSave={async (v) => { set('notes', v, true); setModal(null); }} />}</Dialog>
    <Confirm open={typeof modal === 'object' && modal !== null && 'delPort' in modal} onClose={() => setModal(null)} title="Delete port" text={typeof modal === 'object' && modal !== null && 'delPort' in modal ? `Delete port ${modal.delPort.name} and its connections?` : ''} onConfirm={async () => { if (typeof modal === 'object' && modal !== null && 'delPort' in modal) { await api.del(`/ports/${modal.delPort.id}`); onSelectPort(null); await onChanged(); } }} />
  </div>;
}
export function NotesEditor({ value, onSave }: { value: string; onSave: (v: string) => Promise<void> }) { const [v, setV] = useState(value); return <Form submitLabel="Save" onSubmit={() => onSave(v)}><textarea rows={8} value={v} onChange={(e) => setV(e.target.value)} autoFocus /></Form>; }

// ---------- Ports section ----------
export function PortsSection({ device, canEdit, selectedPortId, onSelectPort, onChanged, onConnect, onTrace, onAdd, onDelete, onManageBuilding }: { device: DeviceDetail; canEdit: boolean; selectedPortId: number | null; onSelectPort: (id: number | null) => void; onChanged: () => Promise<unknown>; onConnect: (p: Port) => void; onTrace: (p: Port) => void; onAdd: () => void; onDelete: (p: Port) => void; onManageBuilding?: () => void }) {
  const toast = useToast(); const [disc, setDisc] = useState<Port | null>(null);
  const wired = device.ports.filter((p) => p.kind !== 'wireless'); const wireless = device.ports.filter((p) => p.kind === 'wireless');
  const row = (p: Port) => {
    const meIdx = p.chain?.steps.findIndex((s) => s.port_id === p.id) ?? -1;
    return <div key={p.id}>
      <div className={`port-row ${p.state}${p.id === selectedPortId ? ' selected' : ''}`} onClick={() => onSelectPort(p.id === selectedPortId ? null : p.id)}>
        {p.chain?.color && <span className="swatch" style={{ background: p.chain.color }} />}<span className="pname">{p.name}</span><span className="pkind">{p.kind === 'wireless' ? p.wireless_mode : PORT_KIND_LABEL[p.kind] ?? p.kind}</span>
        {p.passive === 1 && <span title={p.keystone ? 'Building connection in place' : 'No building connection'} className={`badge ${p.keystone ? 'badge-grey' : 'badge-amber'}`} style={{ padding: '0 5px' }}>{p.keystone ? 'BC' : 'no BC'}</span>}
        <span className="pacts" onClick={(e) => e.stopPropagation()}>
          {p.state !== 'none' && <IconBtn title="Connection overview" onClick={() => onTrace(p)}><Route size={13} /></IconBtn>}
          {canEdit && !p.user && (p.passive === 0 || p.keystone) && <IconBtn title="Connect" onClick={() => onConnect(p)}><Plug size={13} /></IconBtn>}
          {canEdit && p.user && <IconBtn title="Disconnect" onClick={() => setDisc(p)}><Unplug size={13} /></IconBtn>}
          {canEdit && <IconBtn title="Delete port" danger onClick={() => onDelete(p)}><Trash2 size={13} /></IconBtn>}
        </span></div>
      {p.passive === 1 && !p.keystone && p.kind !== 'wireless' && <div className="port-hint">No building connection yet, so nothing can be patched here. {canEdit && onManageBuilding ? <button className="btn-link" onClick={onManageBuilding}>Add building connection</button> : 'Ask an editor to add one.'}</div>}
      {p.chain && p.chain.steps.length > 1 && <div className="port-chain">{p.chain.steps.map((s, i) => <div key={i} className={`hop${i === meIdx ? ' me' : ''}`}><span className="hop-arrow">{i === 0 ? '┌' : i === p.chain!.steps.length - 1 ? '└' : '├'}{s.via === 'building' ? '╌' : '─'}</span><Link to={portLink(s)} title={s.via ? `${s.via} connection` : ''}>{s.path}</Link></div>)}{!p.chain.complete && <div className="muted" style={{ paddingLeft: 14 }}>incomplete: not terminated at an active device</div>}</div>}
    </div>;
  };
  return <Section title="Ports">
    <div className="btn-row"><span className="field-label">Wired ports</span><span className="grow" />{canEdit && <button className="btn-link small" onClick={onAdd}><Plus size={11} /> Add</button>}</div>
    <div className="ports-list">{wired.map(row)}{wired.length === 0 && <div className="muted small">No wired ports.</div>}</div>
    {(wireless.length > 0 || canEdit) && <><div className="btn-row" style={{ marginTop: 6 }}><span className="field-label">Wireless ports</span></div><div className="ports-list">{wireless.map(row)}{wireless.length === 0 && <div className="muted small">None. Add a port and choose Wireless.</div>}</div></>}
    <Confirm open={!!disc} onClose={() => setDisc(null)} title="Disconnect" label="Disconnect" text={disc ? `Remove the user connection on ${disc.name} (to ${disc.user_peer?.path})?` : ''} onConfirm={async () => { if (disc?.user_peer) { await api.del(`/connections/${disc.user_peer.connection_id}`); toast('Disconnected'); await onChanged(); } }} />
  </Section>;
}
function AddPortForm({ deviceId, onDone }: { deviceId: number; onDone: () => void }) {
  const meta = useQuery({ queryKey: ['library-meta'], queryFn: () => api.get<{ icons: string[]; portKinds: string[] }>('/library/meta') });
  const [name, setName] = useState(''); const [kind, setKind] = useState('rj45'); const [face, setFace] = useState<'front' | 'rear'>('front'); const [mode, setMode] = useState<'client' | 'broadcast'>('client');
  return <Form submitLabel="Add port" onCancel={onDone} onSubmit={async () => { await api.post(`/devices/${deviceId}/ports`, { name: name || undefined, kind, face, wireless_mode: kind === 'wireless' ? mode : null }); onDone(); }}>
    <div className="form-row"><Field label="Port name" hint="Blank = next number"><input value={name} onChange={(e) => setName(e.target.value.toUpperCase())} className="code" autoFocus /></Field><Field label="Connector"><select value={kind} onChange={(e) => setKind(e.target.value)}>{(meta.data?.portKinds ?? ['rj45', 'wireless']).map((k) => <option key={k} value={k}>{PORT_KIND_LABEL[k] ?? k}</option>)}</select></Field></div>
    {kind === 'wireless' ? <Field label="Mode"><select value={mode} onChange={(e) => setMode(e.target.value as 'client' | 'broadcast')}><option value="client">Client</option><option value="broadcast">Broadcast</option></select></Field> : <Field label="Side"><select value={face} onChange={(e) => setFace(e.target.value as 'front' | 'rear')}><option value="front">Front</option><option value="rear">Back</option></select></Field>}
  </Form>;
}

// ---------- Port settings ----------
export function PortSettings({ port, canEdit, onChanged }: { port: Port; canEdit: boolean; onChanged: () => Promise<unknown> }) {
  const vlans = useQuery({ queryKey: ['vlans'], queryFn: () => api.get<Vlan[]>('/vlans') }); const wlans = useQuery({ queryKey: ['wlans'], queryFn: () => api.get<Wlan[]>('/wlans') });
  const save = (patch: Record<string, unknown>) => api.patch(`/ports/${port.id}`, patch).then(onChanged);
  const { values, set, status } = useAutosave({ name: port.name, speed: port.speed ?? '', vlan_id: port.vlan_id, wlan_id: port.wlan_id, wireless_mode: port.wireless_mode ?? 'client', notes: port.notes }, save, port.id + ':' + port.name + port.vlan_id + port.wlan_id);
  const toast = useToast();
  const conn = port.user_peer ?? port.building_peer;
  const setColor = async (c: string) => { if (!conn) return; try { await api.patch(`/connections/${conn.connection_id}`, { color: c }); await onChanged(); } catch (e) { toast(errMsg(e), 'error'); } };
  const dis = !canEdit;
  return <Section title={<>Port <span className="code">{port.name}</span></>} right={<SaveStatus status={status} />}>
    <Field label="Port name"><input value={values.name} onChange={(e) => set('name', e.target.value.toUpperCase())} disabled={dis} className="code" /></Field>
    {port.kind !== 'wireless' && <Field label="Speed (Mbps)"><input type="number" placeholder="e.g. 1000" value={values.speed} onChange={(e) => set('speed', e.target.value ? Number(e.target.value) : null as never)} disabled={dis} /></Field>}
    {port.kind !== 'wireless' && <Field label={<span className="btn-row">VLAN<span className="grow" /><Link to="/networks/vlans" className="small">+ Add</Link></span>}><select value={values.vlan_id ?? ''} onChange={(e) => set('vlan_id', e.target.value ? Number(e.target.value) : null, true)} disabled={dis}><option value="">Unassigned</option>{vlans.data?.map((v) => <option key={v.id} value={v.id}>{v.vid} - {v.name}</option>)}</select></Field>}
    {port.kind === 'wireless' && <><Field label="Mode"><select value={values.wireless_mode ?? 'client'} onChange={(e) => set('wireless_mode', e.target.value, true)} disabled={dis}><option value="client">Client</option><option value="broadcast">Broadcast</option></select></Field>
      <Field label={<span className="btn-row">WLAN<span className="grow" /><Link to="/networks/wlans" className="small">+ Add</Link></span>}><select value={values.wlan_id ?? ''} onChange={(e) => set('wlan_id', e.target.value ? Number(e.target.value) : null, true)} disabled={dis}><option value="">Unassigned</option>{wlans.data?.map((w) => <option key={w.id} value={w.id}>{w.ssid}</option>)}</select></Field></>}
    {conn && <Field label="Connection colour" hint="One colour per connection chain"><div className="color-picker">{PRESET_COLORS.map((c) => <span key={c} className={`color-dot${(port.chain?.color ?? '') === c ? ' on' : ''}`} style={{ background: c }} onClick={() => canEdit && setColor(c)} />)}<input type="color" value={port.chain?.color || '#2563eb'} onChange={(e) => setColor(e.target.value)} disabled={dis} />{port.chain?.color && canEdit && <button className="btn-link small" onClick={() => setColor('')}>Clear</button>}</div></Field>}
    {port.building_peer && <div className="small"><span className="muted">Building connection: </span><Link to={portLink(port.building_peer)} className="code">{port.building_peer.path}</Link></div>}
    {port.user_peer && <div className="small"><span className="muted">User connection: </span><Link to={portLink(port.user_peer)} className="code">{port.user_peer.path}</Link></div>}
    <Field label="Notes"><textarea rows={2} value={values.notes} onChange={(e) => set('notes', e.target.value)} disabled={dis} /></Field>
  </Section>;
}

// ---------- Connection Configurator ----------
export function ConnectionConfigurator({ device, port, onDone, expandDeviceId }: { device: DeviceDetail; port: Port; onDone: () => void; expandDeviceId?: number }) {
  const tree = useQuery({ queryKey: ['tree'], queryFn: () => api.get<Tree>('/tree') });
  const [srcPort, setSrcPort] = useState(port.id);
  const [scope, setScope] = useState<{ location_id: number; floor_id: number; room_id: number | null }>({ location_id: device.location_id, floor_id: device.floor_id, room_id: device.room_id });
  const [q, setQ] = useState(''); const [open, setOpen] = useState<number | null>(expandDeviceId ?? null); const [err, setErr] = useState<string | null>(null);
  const [inRack, setInRack] = useState(!!device.rack_id);
  const [cable, setCable] = useState({ color: '', label: '', cable_type: '' });
  const all = q.trim().length > 0;
  const cands = useQuery({ queryKey: ['cands', srcPort, scope, all, inRack], queryFn: () => api.get<Candidate[]>(all ? `/candidates?type=user&scope=all&port_id=${srcPort}` : inRack && device.rack_id ? `/candidates?type=user&scope=rack&id=${device.rack_id}&port_id=${srcPort}` : `/candidates?type=user&scope=room&id=${scope.room_id ?? 0}&floor_id=${scope.floor_id}&port_id=${srcPort}`) });
  const list = (cands.data ?? []).filter((d) => !all || `${d.path} ${d.name} ${d.type_name}`.toUpperCase().includes(q.toUpperCase()));
  const floors = tree.data?.floors.filter((f) => f.location_id === scope.location_id) ?? []; const rooms = tree.data?.rooms.filter((r) => r.floor_id === scope.floor_id) ?? [];
  const connect = async (targetPortId: number) => { setErr(null); try { await api.post('/connections', { port_a_id: srcPort, port_b_id: targetPortId, type: 'user', ...cable }); onDone(); } catch (e) { setErr(errMsg(e)); } };
  const freePorts = device.ports.filter((p) => !p.user && (p.passive === 0 || p.keystone));
  return <div className="form" style={{ gap: 10 }}>
    <div className="btn-row"><span>Source port</span><select style={{ width: 120 }} value={srcPort} onChange={(e) => setSrcPort(Number(e.target.value))}>{freePorts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><span className="grow" /><div style={{ position: 'relative', width: 220 }}><Search size={13} className="muted" style={{ position: 'absolute', left: 8, top: 9 }} /><input style={{ paddingLeft: 26 }} placeholder="Search all locations…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
    {!all && device.rack_id && <div className="seg" style={{ alignSelf: 'flex-start' }}><button type="button" className={inRack ? 'active' : ''} onClick={() => setInRack(true)}>This rack</button><button type="button" className={!inRack ? 'active' : ''} onClick={() => setInRack(false)}>Room / floor / location</button></div>}
    {!all && !inRack && <div className="cfg-crumbs">
      <span className="cfg-crumb"><MapPin size={12} /><select style={{ border: 0, padding: 0, width: 'auto', background: 'none' }} value={scope.location_id} onChange={(e) => { const lid = Number(e.target.value); const f = tree.data?.floors.find((x) => x.location_id === lid); setScope({ location_id: lid, floor_id: f?.id ?? 0, room_id: null }); }}>{tree.data?.locations.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select></span>›
      <span className="cfg-crumb"><Layers size={12} /><select style={{ border: 0, padding: 0, width: 'auto', background: 'none' }} value={scope.floor_id} onChange={(e) => setScope({ ...scope, floor_id: Number(e.target.value), room_id: null })}>{floors.map((f) => <option key={f.id} value={f.id}>{f.code}</option>)}</select></span>›
      <span className="cfg-crumb"><DoorOpen size={12} /><select style={{ border: 0, padding: 0, width: 'auto', background: 'none' }} value={scope.room_id ?? ''} onChange={(e) => setScope({ ...scope, room_id: e.target.value ? Number(e.target.value) : null })}><option value="">DEFAULT</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}</select></span>
    </div>}
    <div className="cfg-list">
      <div className="cfg-head">{all ? `Search results (${list.length})` : inRack ? `Devices in rack ${device.rack_code}` : `Devices in room ${tree.data?.locations.find((l) => l.id === scope.location_id)?.code}/${floors.find((f) => f.id === scope.floor_id)?.code}/${rooms.find((r) => r.id === scope.room_id)?.code ?? 'DEFAULT'}`}</div>
      {cands.isLoading && <Loading />}
      {list.length === 0 && !cands.isLoading && <div className="muted" style={{ padding: 14 }}>No devices you can connect to here. Try another room, floor or location.</div>}
      {list.map((d) => <div key={d.id}>
        <div className="cfg-row" onClick={() => setOpen(open === d.id ? null : d.id)}><div className="dev-ico"><DeviceIcon name={d.type_icon} size={15} /></div><div className="grow"><div><b>{d.rack_code ? `${d.rack_code} / ` : ''}{d.code}</b>{d.name && <span className="muted"> · {d.name}</span>}</div><div className="muted small">{d.type_name}{d.position_u ? ` · U${d.position_u}` : ''}{all ? ` · ${d.path}` : ''}{d.ports.some((p) => p.face === 'rear') ? ' · has back ports' : ''}</div></div><span className="muted small">{d.ports.filter((p) => p.available).length} free</span></div>
        {open === d.id && <div className="cfg-ports">{d.ports.map((p) => <button key={p.id} className={`cfg-port${p.available ? '' : ' taken'}`} title={p.available ? `Connect to ${p.name}` : p.reason} disabled={!p.available} onClick={() => connect(p.id)}>{p.name}<span className="muted"> {p.kind === 'wireless' ? p.wireless_mode : PORT_KIND_LABEL[p.kind] ?? p.kind}{p.face === 'rear' ? ' · back' : ''}</span></button>)}{d.ports.length === 0 && <span className="muted small">No ports</span>}</div>}
      </div>)}
    </div>
    <details><summary className="muted small" style={{ cursor: 'pointer' }}>Cable details (optional)</summary><div className="form-row-3" style={{ marginTop: 8 }}><Field label="Cable type"><input value={cable.cable_type} onChange={(e) => setCable({ ...cable, cable_type: e.target.value })} placeholder="Cat6a, OM4…" /></Field><Field label="Label"><input value={cable.label} onChange={(e) => setCable({ ...cable, label: e.target.value })} /></Field><Field label="Colour"><input type="color" value={cable.color || '#2563eb'} onChange={(e) => setCable({ ...cable, color: e.target.value })} /></Field></div></details>
    {err && <ErrorBox error={err} />}
  </div>;
}

// ---------- Building connections dialog ----------
export function BuildingConnectionsDialog({ device, onDone }: { device: DeviceDetail; onDone: () => void }) {
  const tree = useQuery({ queryKey: ['tree'], queryFn: () => api.get<Tree>('/tree') });
  const qc = useQueryClient();
  type Row = { port: Port; location_id: number; floor_id: number; room_id: number | null; rack_id: number | null; device_id: number | null; target_port_id: number | null };
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { setRows(device.ports.filter((p) => p.kind !== 'wireless').map((p) => { const b = p.building_peer; return { port: p, location_id: device.location_id, floor_id: b?.floor_id ?? device.floor_id, room_id: device.room_id, rack_id: b?.rack_id ?? null, device_id: b?.device_id ?? null, target_port_id: b?.port_id ?? null }; })); }, [device]);
  useEffect(() => { if (tree.data) setRows((rs) => rs.map((r) => { const f = tree.data!.floors.find((x) => x.id === r.floor_id); return { ...r, location_id: f?.location_id ?? r.location_id }; })); }, [tree.data]);
  const [err, setErr] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  return <div className="form">
    <div className="muted small">One row per port. Pick where the other end of the permanent (in-wall) cable terminates: a patch panel port in a rack, or another outlet. Cleared rows remove the building connection.{device.rack_id ? ' Tip: if there is no outlet to choose yet, add a Telecommunications Outlet on the floor plan first.' : ''}</div>
    <div className="bc-grid"><span className="hd">Port</span><span className="hd">Location</span><span className="hd">Floor</span><span className="hd">Room</span><span className="hd">Rack / device</span><span className="hd">Port</span><span />
      {rows.map((r, i) => <BuildingRow key={r.port.id} row={r} tree={tree.data} deviceId={device.id} onChange={(nr) => setRows(rows.map((x, k) => k === i ? nr : x))} />)}</div>
    {err && <ErrorBox error={err} />}
    <div className="form-actions"><button className="btn" onClick={onDone}>Cancel</button><button className="btn btn-primary" disabled={saving} onClick={async () => { setSaving(true); setErr(null); try { await api.put(`/devices/${device.id}/building-connections`, rows.map((r) => ({ port_id: r.port.id, target_port_id: r.target_port_id }))); qc.invalidateQueries(); onDone(); } catch (e) { setErr(errMsg(e)); } finally { setSaving(false); } }}>Save changes</button></div>
  </div>;
}
function BuildingRow({ row, tree, deviceId, onChange }: { row: { port: Port; location_id: number; floor_id: number; room_id: number | null; rack_id: number | null; device_id: number | null; target_port_id: number | null }; tree?: Tree; deviceId: number; onChange: (r: typeof row) => void }) {
  const floors = tree?.floors.filter((f) => f.location_id === row.location_id) ?? []; const rooms = tree?.rooms.filter((r) => r.floor_id === row.floor_id) ?? [];
  const cands = useQuery({ queryKey: ['bcands', row.floor_id, row.room_id], queryFn: () => api.get<Candidate[]>(`/candidates?type=building&scope=room&id=${row.room_id ?? 0}&floor_id=${row.floor_id}&exclude_device=${deviceId}`) });
  const devs = cands.data ?? []; const dev = devs.find((d) => d.id === row.device_id);
  const sel = (v: unknown, onC: (val: string) => void, opts: { value: string | number; label: string }[], empty = '—') => <select value={v == null ? '' : String(v)} onChange={(e) => onC(e.target.value)}><option value="">{empty}</option>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
  return <>
    <span className="code"><b>{row.port.name}</b></span>
    {sel(row.location_id, (v) => { const lid = Number(v); const f = tree?.floors.find((x) => x.location_id === lid); onChange({ ...row, location_id: lid, floor_id: f?.id ?? 0, room_id: null, rack_id: null, device_id: null, target_port_id: null }); }, tree?.locations.map((l) => ({ value: l.id, label: l.code })) ?? [])}
    {sel(row.floor_id, (v) => onChange({ ...row, floor_id: Number(v), room_id: null, device_id: null, target_port_id: null }), floors.map((f) => ({ value: f.id, label: f.code })))}
    {sel(row.room_id, (v) => onChange({ ...row, room_id: v ? Number(v) : null, device_id: null, target_port_id: null }), rooms.map((r) => ({ value: r.id, label: r.code })), 'DEFAULT')}
    {sel(row.device_id, (v) => onChange({ ...row, device_id: v ? Number(v) : null, target_port_id: null }), devs.map((d) => ({ value: d.id, label: `${d.rack_code ? d.rack_code + ' / ' : ''}${d.code} (${d.type_name})` })), cands.isLoading ? 'Loading…' : devs.length ? 'Select…' : 'No outlets or patch panels in this room')}
    {sel(row.target_port_id, (v) => onChange({ ...row, target_port_id: v ? Number(v) : null }), (dev?.ports ?? []).filter((p) => p.available || p.id === row.target_port_id).map((p) => ({ value: p.id, label: p.name })))}
    <IconBtn title="Clear" onClick={() => onChange({ ...row, device_id: null, target_port_id: null })}><X size={13} /></IconBtn>
  </>;
}

// ---------- Trace view ----------
export function TraceView({ portId }: { portId: number }) {
  const q = useQuery({ queryKey: ['trace', portId], queryFn: () => api.get<Trace>(`/ports/${portId}/trace`) });
  if (q.isLoading) return <Loading />; if (q.error) return <ErrorBox error={q.error} />;
  const t = q.data!;
  return <div>
    <div className="btn-row" style={{ marginBottom: 8 }}>{t.complete ? <Badge tone="green"><Check size={11} /> Complete connection</Badge> : <Badge tone="amber">Incomplete: not terminated at an active device on both ends</Badge>}{t.color && <span className="badge"><span className="swatch" style={{ background: t.color }} />{t.color}</span>}</div>
    <div className="trace">{t.steps.map((s, i) => <div key={i}>{s.via && <div className={`trace-link ${s.via.type}`}>{s.via.type} connection{s.via.connection.label ? ` · ${s.via.connection.label}` : ''}{s.via.connection.cable_type ? ` · ${s.via.connection.cable_type}` : ''}</div>}
      <div className={`trace-port${i === t.start_index ? ' start' : ''}`}><DeviceIcon name={s.port.type_icon} size={16} /><div><Link to={portLink(s.port)} className="code">{s.port.path}</Link><div className="muted small">{s.port.type_name}{s.port.device_name ? ` · ${s.port.device_name}` : ''}{s.port.vlan_vid != null ? ` · VLAN ${s.port.vlan_vid}` : ''}</div></div></div></div>)}</div>
  </div>;
}

/** Devices & Connections bottom panel content: connections table in Patchdocs' From / Via / To shape. */
export function ConnectionsTable({ rows, linkTo }: { rows: { id: number; type: string; color?: string; chain: { from: string; to: string; via: string[]; complete: boolean; color: string } | null; a: { path: string }; b: { path: string } }[]; linkTo?: (path: string) => string | null }) {
  const cell = (p: string) => { const to = linkTo?.(p); return to ? <Link to={to}>{p}</Link> : <span>{p}</span>; };
  return <table className="table"><thead><tr><th>From</th><th>Via</th><th>To</th><th>Type</th></tr></thead><tbody>
    {rows.map((c) => <tr key={c.id}><td className="code">{c.chain?.color && <span className="swatch" style={{ background: c.chain.color }} />}{cell(c.chain?.from ?? c.a.path)}</td><td className="code muted">{c.chain?.via.length ? c.chain.via.map((v, i) => <div key={i}>{cell(v)}</div>) : '-'}</td><td className="code">{cell(c.chain?.to ?? c.b.path)}</td><td><span className={`badge ${c.type === 'building' ? 'badge-amber' : 'badge-blue'}`}>{c.type}</span>{c.chain && !c.chain.complete && <span className="muted small"> incomplete</span>}</td></tr>)}
    {rows.length === 0 && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 18 }}>No connections yet.</td></tr>}
  </tbody></table>;
}
export function useTypes() { return useQuery({ queryKey: ['device-types'], queryFn: () => api.get<DeviceType[]>('/device-types'), staleTime: 30000 }); }
export function useMemoSorted<T>(arr: T[] | undefined, key: (t: T) => string) { return useMemo(() => [...(arr ?? [])].sort((a, b) => key(a).localeCompare(key(b))), [arr, key]); }
void Server; void Palette; void Pencil;
