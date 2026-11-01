import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Copy, BookOpen } from 'lucide-react';
import { api, fmtDate } from '../lib/api';
import { useCanEdit } from '../lib/auth';
import { DeviceIcon, ICON_NAMES } from '../lib/icons';
import type { DeviceType, Template } from '../lib/types';
import { usePageHeader } from '../components/Shell';
import { DataTable } from '../components/DataTable';
import { Confirm, Dialog, ErrorBox, Field, Form, IconBtn, Loading, useToast } from '../components/ui';

export function DeviceLibrary() {
  const tab = useParams().tab ?? 'rack-devices'; const nav = useNavigate(); const canEdit = useCanEdit();
  usePageHeader({ title: 'Device Library', crumbs: [{ label: 'Device Library' }], actions: <a className="icon-btn bordered" href="https://github.com/damiankw/patching#readme" target="_blank" rel="noreferrer" title="Documentation"><BookOpen size={15} /></a> });
  return <div>
    <div className="chip-tabs" style={{ marginBottom: 12 }}><button className={tab === 'rack-devices' ? 'active' : ''} onClick={() => nav('/library/rack-devices')}>Rack Devices</button><button className={tab === 'device-types' ? 'active' : ''} onClick={() => nav('/library/device-types')}>Device Types</button></div>
    {tab === 'rack-devices' ? <RackDevices canEdit={canEdit} /> : <DeviceTypes canEdit={canEdit} />}
  </div>;
}

function RackDevices({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient(); const toast = useToast();
  const q = useQuery({ queryKey: ['templates'], queryFn: () => api.get<Template[]>('/templates') });
  const [modal, setModal] = useState<null | { kind: 'edit'; tpl?: Template } | { kind: 'delete'; tpl: Template }>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['templates'] });
  if (q.isLoading) return <Loading />; if (q.error) return <ErrorBox error={q.error} />;
  return <>
    <DataTable rows={q.data ?? []} toolbar={<h2>Rack Devices</h2>} columns={[
      { key: 'name', label: 'Name', render: (t) => <button className="btn-link" onClick={() => setModal({ kind: 'edit', tpl: t })}>{t.name}</button> }, { key: 'brand', label: 'Brand' }, { key: 'type_name', label: 'Type' }, { key: 'height_u', label: 'Rack units' }, { key: 'width_pct', label: 'Width', render: (t) => t.width_pct >= 100 ? 'Full' : `${t.width_pct}%` },
      { key: 'ports', label: 'Ports', sortValue: (t) => t.ports.length, render: (t) => `${t.ports.length}` }, { key: 'device_count', label: 'In use' }, { key: 'is_builtin', label: 'Origin', render: (t) => t.is_builtin ? 'Standard' : 'Custom' }, { key: 'updated_at', label: 'Updated', render: (t) => fmtDate(t.updated_at) },
      { key: 'actions', label: 'Actions', align: 'right', render: (t) => <div className="row-actions">{canEdit && <IconBtn title="Duplicate" onClick={async () => { await api.post(`/templates/${t.id}/duplicate`); refresh(); toast('Duplicated'); }}><Copy size={14} /></IconBtn>}{canEdit && <IconBtn title="Edit" onClick={() => setModal({ kind: 'edit', tpl: t })}><Pencil size={14} /></IconBtn>}{canEdit && <IconBtn title="Delete" danger disabled={t.device_count > 0} onClick={() => setModal({ kind: 'delete', tpl: t })}><Trash2 size={14} /></IconBtn>}</div> }]}
      csvHref={undefined} />
    {canEdit && <div className="btn-row" style={{ marginTop: 10 }}><button className="btn btn-primary" onClick={() => setModal({ kind: 'edit' })}><Plus size={15} /> Create</button></div>}
    <Dialog open={modal?.kind === 'edit'} onClose={() => setModal(null)} title="Rack Device Editor" wide>{modal?.kind === 'edit' && <TemplateForm tpl={modal.tpl} onDone={() => { setModal(null); refresh(); }} />}</Dialog>
    <Confirm open={modal?.kind === 'delete'} onClose={() => setModal(null)} title="Delete rack device" text={`Delete template ${modal?.kind === 'delete' ? modal.tpl.name : ''}?`} onConfirm={async () => { if (modal?.kind === 'delete') { await api.del(`/templates/${modal.tpl.id}`); refresh(); } }} />
  </>;
}

export const PORT_KIND_LABEL: Record<string, string> = { rj45: 'RJ45', sfp: 'SFP', 'sfp+': 'SFP+', qsfp: 'QSFP', lc: 'LC', sc: 'SC', e2000: 'E2000', mpo: 'MPO', console: 'Console', usb: 'USB', hdmi: 'HDMI', dp: 'DisplayPort', power: 'Power', wireless: 'Wireless', other: 'Other' };
type TPort = { name: string; kind: string; face: 'front' | 'rear'; wireless_mode?: string | null };
function PortsEditor({ ports, setPorts, kinds, allowWireless }: { ports: TPort[]; setPorts: (p: TPort[]) => void; kinds: string[]; allowWireless?: boolean }) {
  const [gen, setGen] = useState({ prefix: '', from: 1, to: 24, kind: 'rj45', face: 'front' as 'front' | 'rear', pad: true });
  const add = () => { const out: TPort[] = []; for (let i = Number(gen.from); i <= Number(gen.to); i++) out.push({ name: `${gen.prefix}${gen.pad ? String(i).padStart(2, '0') : i}`.toUpperCase(), kind: gen.kind, face: gen.face, wireless_mode: gen.kind === 'wireless' ? 'client' : null }); setPorts([...ports, ...out.filter((p) => !ports.some((e) => e.name === p.name))]); };
  const ks = kinds.filter((k) => allowWireless || k !== 'wireless');
  return <div className="form" style={{ gap: 8 }}>
    <div className="ports-gen"><Field label="Prefix"><input value={gen.prefix} onChange={(e) => setGen({ ...gen, prefix: e.target.value })} placeholder="(none)" /></Field><Field label="From"><input type="number" value={gen.from} onChange={(e) => setGen({ ...gen, from: Number(e.target.value) })} /></Field><Field label="To"><input type="number" value={gen.to} onChange={(e) => setGen({ ...gen, to: Number(e.target.value) })} /></Field>
      <Field label="Connector"><select value={gen.kind} onChange={(e) => setGen({ ...gen, kind: e.target.value })}>{ks.map((k) => <option key={k} value={k}>{PORT_KIND_LABEL[k] ?? k}</option>)}</select></Field><Field label="Side"><select value={gen.face} onChange={(e) => setGen({ ...gen, face: e.target.value as 'front' | 'rear' })}><option value="front">Front</option><option value="rear">Back</option></select></Field><button type="button" className="btn" onClick={add}>Add range</button></div>
    <div className="ports-editor">{ports.map((p, i) => <div key={i} className="row"><input value={p.name} onChange={(e) => setPorts(ports.map((x, k) => k === i ? { ...x, name: e.target.value.toUpperCase() } : x))} /><select value={p.kind} onChange={(e) => setPorts(ports.map((x, k) => k === i ? { ...x, kind: e.target.value, wireless_mode: e.target.value === 'wireless' ? (x.wireless_mode ?? 'client') : null } : x))}>{ks.map((k) => <option key={k} value={k}>{PORT_KIND_LABEL[k] ?? k}</option>)}</select>
      {p.kind === 'wireless' ? <select value={p.wireless_mode ?? 'client'} onChange={(e) => setPorts(ports.map((x, k) => k === i ? { ...x, wireless_mode: e.target.value } : x))}><option value="client">Client</option><option value="broadcast">Broadcast</option></select> : <select value={p.face} onChange={(e) => setPorts(ports.map((x, k) => k === i ? { ...x, face: e.target.value as 'front' | 'rear' } : x))}><option value="front">Front</option><option value="rear">Back</option></select>}
      <IconBtn title="Remove" onClick={() => setPorts(ports.filter((_, k) => k !== i))}><Trash2 size={13} /></IconBtn></div>)}</div>
    {ports.length > 0 && <div className="btn-row"><span className="muted small">{ports.length} ports · {ports.filter((p) => p.face === 'front').length} front · {ports.filter((p) => p.face === 'rear').length} back</span><span className="grow" /><button type="button" className="btn btn-sm btn-ghost" onClick={() => setPorts([])}>Clear all</button></div>}
  </div>;
}
function TemplateForm({ tpl, onDone }: { tpl?: Template; onDone: () => void }) {
  const types = useQuery({ queryKey: ['device-types'], queryFn: () => api.get<DeviceType[]>('/device-types') });
  const meta = useQuery({ queryKey: ['library-meta'], queryFn: () => api.get<{ icons: string[]; portKinds: string[] }>('/library/meta') });
  const rackTypes = (types.data ?? []).filter((t) => t.kind === 'rack');
  const [name, setName] = useState(tpl?.name ?? ''); const [brand, setBrand] = useState(tpl?.brand ?? ''); const [model, setModel] = useState(tpl?.model ?? ''); const [typeId, setTypeId] = useState(tpl?.device_type_id ?? 0); const [height, setHeight] = useState(tpl?.height_u ?? 1); const [width, setWidth] = useState(tpl?.width_pct ?? 100); const [color, setColor] = useState(tpl?.color || '#ffffff');
  const [ports, setPorts] = useState<TPort[]>((tpl?.ports ?? []).map((p) => ({ name: p.name, kind: p.kind, face: p.face as 'front' | 'rear' })));
  const [face, setFace] = useState<'front' | 'rear'>('front');
  useEffect(() => { if (!typeId && rackTypes.length) setTypeId(rackTypes[0].id); }, [rackTypes, typeId]);
  const shown = ports.filter((p) => p.face === face);
  return <Form submitLabel={tpl ? 'Save' : 'Create'} onCancel={onDone} onSubmit={async () => { const b = { name, brand, model, device_type_id: typeId, height_u: Number(height), width_pct: Number(width), color: color === '#ffffff' ? '' : color, ports }; if (tpl) await api.put(`/templates/${tpl.id}`, b); else await api.post('/templates', b); onDone(); }}>
    <div className="form-row-3"><Field label="Name" required><input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></Field><Field label="Brand"><input value={brand} onChange={(e) => setBrand(e.target.value)} /></Field><Field label="Model"><input value={model} onChange={(e) => setModel(e.target.value)} /></Field></div>
    <div className="form-row-3"><Field label="Device type" required><select value={typeId} onChange={(e) => setTypeId(Number(e.target.value))}>{rackTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field><Field label="Rack units"><select value={height} onChange={(e) => setHeight(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6, 8, 10, 12].map((u) => <option key={u} value={u}>{u} RU</option>)}</select></Field><Field label="Width" hint="Less than full width lets devices sit side by side, e.g. on a shelf or tray"><select value={width} onChange={(e) => setWidth(Number(e.target.value))}>{[[100, 'Full width'], [75, '3/4 width'], [67, '2/3 width'], [50, '1/2 width'], [33, '1/3 width'], [25, '1/4 width']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field><Field label="Panel colour"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></Field></div>
    <div className="btn-row"><span className="field-label">Port layout</span><span className="grow" /><div className="seg"><button type="button" className={face === 'front' ? 'active' : ''} onClick={() => setFace('front')}>Front</button><button type="button" className={face === 'rear' ? 'active' : ''} onClick={() => setFace('rear')}>Back</button></div></div>
    <div className="ports-preview"><PanelPreview ports={shown} heightU={Number(height)} color={color === '#ffffff' ? '' : color} width={Math.round(640 * Number(width) / 100)} /></div>
    <PortsEditor ports={ports} setPorts={setPorts} kinds={meta.data?.portKinds ?? ['rj45', 'sfp', 'sfp+', 'lc', 'power', 'other']} />
    {tpl && tpl.device_count > 0 && <div className="muted small">Used by {tpl.device_count} device(s). Devices already placed keep their current ports.</div>}
  </Form>;
}
/** Simple rendering of a device panel with ports in rows, shared with the rack editor. */
export function panelLayout(ports: { name: string; kind: string }[], heightU: number, width: number) {
  const n = ports.length; if (!n) return { rows: 0, cols: 0, cell: 0 };
  const maxRows = Math.max(1, heightU * 2); let rows = 1; while (Math.ceil(n / rows) * 15 > width - 50 && rows < maxRows) rows++;
  const cols = Math.ceil(n / rows); const cell = Math.min(16, Math.max(7, Math.floor((width - 50) / cols)));
  return { rows, cols, cell };
}
export function PanelPreview({ ports, heightU, color, width = 640 }: { ports: { name: string; kind: string }[]; heightU: number; color: string; width?: number }) {
  const h = heightU * 22; const { rows, cols, cell } = panelLayout(ports, heightU, width);
  return <svg viewBox={`0 0 ${width} ${h}`} width="100%" style={{ maxHeight: 160 }}><rect x={0} y={0} width={width} height={h} rx={3} fill={color || 'var(--surface)'} stroke="var(--border-strong)" />
    {ports.length === 0 && <text x={width / 2} y={h / 2 + 4} fontSize={11} textAnchor="middle" fill="var(--muted)">No ports on this side</text>}
    {ports.map((p, i) => { const r = Math.floor(i / cols), c = i % cols; const x = 24 + c * cell, y = 3 + r * (h - 6) / rows; const s = Math.min(cell - 2, (h - 6) / rows - 3); return <g key={i}><rect x={x} y={y} width={s} height={s} rx={1.5} fill="none" stroke="var(--port-none)" strokeWidth={1.2} /><text x={x + s / 2} y={y + s + 7} fontSize={5} textAnchor="middle" fill="var(--muted)">{p.name.length > 5 ? p.name.slice(0, 4) + '…' : p.name}</text></g>; })}
  </svg>;
}

function DeviceTypes({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient(); const toast = useToast();
  const q = useQuery({ queryKey: ['device-types'], queryFn: () => api.get<DeviceType[]>('/device-types') });
  const [prefixes, setPrefixes] = useState<Record<number, string>>({}); const [modal, setModal] = useState<null | { kind: 'edit'; dt?: DeviceType; forKind: 'floor' | 'rack' } | { kind: 'delete'; dt: DeviceType }>(null);
  useEffect(() => { if (q.data) setPrefixes(Object.fromEntries(q.data.map((t) => [t.id, t.prefix]))); }, [q.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['device-types'] });
  if (q.isLoading) return <Loading />; if (q.error) return <ErrorBox error={q.error} />;
  const col = (kind: 'floor' | 'rack') => {
    const std = (q.data ?? []).filter((t) => t.kind === kind && t.is_builtin); const custom = (q.data ?? []).filter((t) => t.kind === kind && !t.is_builtin);
    const dirty = std.some((t) => prefixes[t.id] !== undefined && prefixes[t.id] !== t.prefix);
    return <div className="card"><h2 style={{ marginBottom: 10 }}>{kind === 'floor' ? 'Floor' : 'Rack'} Device Types</h2>
      <div className="card" style={{ padding: 0, marginBottom: 12 }}><div className="section-head" style={{ cursor: 'default', borderRadius: '10px 10px 0 0' }}>Standard Device Types</div><div style={{ padding: 12 }}>
        <div className="type-grid">{std.map((t) => <div key={t.id} style={{ display: 'contents' }}><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><DeviceIcon name={t.icon} size={14} className="muted" />{t.name}</span><input value={prefixes[t.id] ?? t.prefix} onChange={(e) => setPrefixes({ ...prefixes, [t.id]: e.target.value.toUpperCase() })} disabled={!canEdit} className="code" /></div>)}</div>
        {canEdit && <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={!dirty} onClick={async () => { await api.put('/device-types/prefixes', std.filter((t) => prefixes[t.id] !== t.prefix).map((t) => ({ id: t.id, prefix: prefixes[t.id] }))); refresh(); toast('Prefixes saved'); }}>Save changes</button>}</div></div>
      <div className="card" style={{ padding: 0 }}><div className="section-head" style={{ cursor: 'default', borderRadius: '10px 10px 0 0' }}>Custom Device Types<span>{canEdit && <button className="btn btn-sm" onClick={() => setModal({ kind: 'edit', forKind: kind })}><Plus size={13} /> Add</button>}</span></div><div style={{ padding: 12 }}>
        {custom.length === 0 && <div className="muted small">No custom types yet.</div>}
        {custom.map((t) => <div key={t.id} className="custom-type-row"><DeviceIcon name={t.icon} size={16} /><span className="prefix-chip">{t.prefix}</span><span className="grow">{t.name}{t.passive ? <span className="muted small"> · passive</span> : null}</span>{canEdit && <><IconBtn title="Edit" onClick={() => setModal({ kind: 'edit', dt: t, forKind: kind })}><Pencil size={14} /></IconBtn><IconBtn title="Delete" danger disabled={t.device_count > 0} onClick={() => setModal({ kind: 'delete', dt: t })}><Trash2 size={14} /></IconBtn></>}</div>)}</div></div></div>;
  };
  return <>
    <div className="lib-grid">{col('floor')}{col('rack')}</div>
    <Dialog open={modal?.kind === 'edit'} onClose={() => setModal(null)} title={modal?.kind === 'edit' && modal.dt ? 'Edit device type' : 'Add device type'} wide>{modal?.kind === 'edit' && <TypeForm dt={modal.dt} kind={modal.forKind} onDone={() => { setModal(null); refresh(); }} />}</Dialog>
    <Confirm open={modal?.kind === 'delete'} onClose={() => setModal(null)} title="Delete device type" text={`Delete ${modal?.kind === 'delete' ? modal.dt.name : ''}?`} onConfirm={async () => { if (modal?.kind === 'delete') { await api.del(`/device-types/${modal.dt.id}`); refresh(); } }} />
  </>;
}
function TypeForm({ dt, kind, onDone }: { dt?: DeviceType; kind: 'floor' | 'rack'; onDone: () => void }) {
  const meta = useQuery({ queryKey: ['library-meta'], queryFn: () => api.get<{ icons: string[]; portKinds: string[] }>('/library/meta') });
  const [name, setName] = useState(dt?.name ?? ''); const [prefix, setPrefix] = useState(dt?.prefix ?? ''); const [icon, setIcon] = useState(dt?.icon ?? 'box'); const [passive, setPassive] = useState(!!dt?.passive);
  const [ports, setPorts] = useState<TPort[]>((dt?.ports ?? []).map((p) => ({ name: p.name, kind: p.kind, face: p.face as 'front' | 'rear', wireless_mode: p.wireless_mode })));
  return <Form submitLabel={dt ? 'Save' : 'Add'} onCancel={onDone} onSubmit={async () => { const b = { name, prefix, kind, icon, passive, ports }; if (dt) await api.patch(`/device-types/${dt.id}`, b); else await api.post('/device-types', b); onDone(); }}>
    <div className="form-row-3"><Field label="Name" required><input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></Field><Field label="ID prefix" required hint="e.g. PLC"><input value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} required className="code" /></Field>
      <Field label="Icon"><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><DeviceIcon name={icon} size={18} /><select value={icon} onChange={(e) => setIcon(e.target.value)}>{(meta.data?.icons ?? ICON_NAMES).map((i) => <option key={i} value={i}>{i}</option>)}</select></div></Field></div>
    {!dt?.is_builtin && <label className="checkbox"><input type="checkbox" checked={passive} onChange={(e) => setPassive(e.target.checked)} /> Passive device (like an outlet or patch panel): ports take building connections and pass them through</label>}
    {kind === 'floor' && <><div className="field-label">Default ports for new devices of this type</div><PortsEditor ports={ports} setPorts={setPorts} kinds={meta.data?.portKinds ?? ['rj45', 'wireless', 'other']} allowWireless /></>}
    {kind === 'rack' && <div className="muted small">Rack device types get their ports from templates on the Rack Devices tab.</div>}
  </Form>;
}
