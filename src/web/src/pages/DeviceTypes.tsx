import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useCanEdit } from '../lib/auth';
import type { DeviceType, DeviceTypePort } from '../lib/types';
import { Badge, Confirm, Dialog, ErrorBox, Field, Form, Loading } from '../components/ui';

const CATEGORY_LABEL: Record<string, string> = { switch: 'Switch', router: 'Router', firewall: 'Firewall', patch_panel: 'Patch panel', server: 'Server', storage: 'Storage', pdu: 'PDU', ups: 'UPS', other: 'Other' };

export function DeviceTypes() {
  const qc = useQueryClient(); const canEdit = useCanEdit();
  const q = useQuery({ queryKey: ['device-types'], queryFn: () => api.get<DeviceType[]>('/device-types') });
  const [filter, setFilter] = useState('');
  const [edit, setEdit] = useState<DeviceType | 'new' | null>(null); const [del, setDel] = useState<DeviceType | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['device-types'] });
  const f = filter.toLowerCase();
  const rows = (q.data ?? []).filter((t) => !f || `${t.name} ${t.manufacturer} ${t.model} ${t.category}`.toLowerCase().includes(f));
  return (
    <div>
      <div className="page-head"><div><h1>Device library</h1><div className="muted">Templates for devices you place in racks. Each defines height and ports.</div></div>
        <div className="btn-row"><input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 220 }} />{canEdit && <button className="btn btn-primary" onClick={() => setEdit('new')}>+ New type</button>}</div></div>
      {q.isLoading && <Loading />}{q.error && <ErrorBox error={q.error} />}
      {q.data && (
        <table className="table"><thead><tr><th>Name</th><th>Category</th><th>Make / model</th><th>Height</th><th>Ports</th><th>In use</th><th /></tr></thead>
          <tbody>{rows.map((t) => (
            <tr key={t.id}><td><span className="swatch" style={{ background: t.color }} />{t.name}{t.is_builtin ? <span className="muted small"> · built-in</span> : null}{t.passthrough ? <Badge>pass-through</Badge> : null}</td>
              <td>{CATEGORY_LABEL[t.category] ?? t.category}</td><td className="muted">{t.manufacturer} {t.model}</td><td>{t.height_u}U</td><td>{t.port_count}</td><td>{t.device_count}</td>
              <td className="row-actions">{canEdit && <><button className="btn btn-sm btn-ghost" onClick={() => setEdit(t)}>Edit</button><button className="btn btn-sm btn-ghost" disabled={!!t.device_count} title={t.device_count ? 'In use' : ''} onClick={() => setDel(t)}>Delete</button></>}</td></tr>
          ))}</tbody></table>
      )}
      <Dialog open={edit !== null} onClose={() => setEdit(null)} title={edit === 'new' ? 'New device type' : 'Edit device type'} wide>
        {edit !== null && <TypeForm typeId={edit === 'new' ? null : edit.id} onDone={() => { setEdit(null); refresh(); }} />}
      </Dialog>
      <Confirm open={del !== null} onClose={() => setDel(null)} title="Delete device type" text={`Delete ${del?.name}?`} onConfirm={async () => { await api.del(`/device-types/${del!.id}`); await refresh(); }} />
    </div>
  );
}

function TypeForm({ typeId, onDone }: { typeId: number | null; onDone: () => void }) {
  const full = useQuery({ queryKey: ['device-type', typeId], queryFn: () => api.get<DeviceType>(`/device-types/${typeId}`), enabled: typeId !== null });
  const meta = useQuery({ queryKey: ['device-type-meta'], queryFn: () => api.get<{ categories: string[]; portKinds: string[] }>('/device-types/meta') });
  if (typeId !== null && full.isLoading) return <Loading />;
  if (full.error) return <ErrorBox error={full.error} />;
  return <TypeFormInner initial={typeId !== null ? full.data! : undefined} kinds={meta.data?.portKinds ?? []} categories={meta.data?.categories ?? []} onDone={onDone} />;
}

function TypeFormInner({ initial, kinds, categories, onDone }: { initial?: DeviceType; kinds: string[]; categories: string[]; onDone: () => void }) {
  const [name, setName] = useState(initial?.name ?? ''); const [manufacturer, setManufacturer] = useState(initial?.manufacturer ?? ''); const [model, setModel] = useState(initial?.model ?? '');
  const [category, setCategory] = useState(initial?.category ?? 'switch'); const [height, setHeight] = useState(initial?.height_u ?? 1);
  const [passthrough, setPassthrough] = useState(!!initial?.passthrough); const [color, setColor] = useState(initial?.color ?? '#2563eb');
  const [ports, setPorts] = useState<DeviceTypePort[]>(initial?.ports ?? []);
  const [gen, setGen] = useState({ prefix: '', from: 1, to: 24, kind: 'rj45', face: 'front' as 'front' | 'rear' });
  const addRange = () => {
    const out: DeviceTypePort[] = [];
    for (let i = Number(gen.from); i <= Number(gen.to); i++) out.push({ name: `${gen.prefix}${i}`.toUpperCase(), kind: gen.kind, face: gen.face });
    setPorts([...ports, ...out.filter((p) => !ports.some((e) => e.face === p.face && e.name === p.name))]);
  };
  const update = (i: number, patch: Partial<DeviceTypePort>) => setPorts(ports.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const inUse = initial?.device_count ?? 0;
  return (
    <Form onCancel={onDone} onSubmit={async () => {
      const body = { name, manufacturer, model, category, height_u: Number(height), passthrough, color, ports: ports.map((p) => ({ name: p.name, kind: p.kind, face: p.face })) };
      if (initial) await api.put(`/device-types/${initial.id}`, body); else await api.post('/device-types', body); onDone();
    }}>
      {inUse > 0 && <div className="muted">This type is used by {inUse} device(s). Port changes apply to new devices only; existing devices keep their ports.</div>}
      <div className="form-row">
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></Field>
        <Field label="Category"><select value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c] ?? c}</option>)}</select></Field>
      </div>
      <div className="form-row">
        <Field label="Manufacturer"><input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} /></Field>
        <Field label="Model"><input value={model} onChange={(e) => setModel(e.target.value)} /></Field>
      </div>
      <div className="form-row">
        <Field label="Height (U)"><input type="number" min={1} max={50} value={height} onChange={(e) => setHeight(Number(e.target.value))} required /></Field>
        <Field label="Colour in rack view"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></Field>
      </div>
      <label className="checkbox"><input type="checkbox" checked={passthrough} onChange={(e) => setPassthrough(e.target.checked)} /> Pass-through device (patch panel): front port N is internally wired to rear port N with the same name</label>

      <div className="field-label">Ports ({ports.length})</div>
      <div className="ports-gen">
        <Field label="Prefix"><input value={gen.prefix} onChange={(e) => setGen({ ...gen, prefix: e.target.value })} placeholder="(none)" /></Field>
        <Field label="From"><input type="number" value={gen.from} onChange={(e) => setGen({ ...gen, from: Number(e.target.value) })} /></Field>
        <Field label="To"><input type="number" value={gen.to} onChange={(e) => setGen({ ...gen, to: Number(e.target.value) })} /></Field>
        <Field label="Kind"><select value={gen.kind} onChange={(e) => setGen({ ...gen, kind: e.target.value })}>{kinds.map((k) => <option key={k}>{k}</option>)}</select></Field>
        <Field label="Face"><select value={gen.face} onChange={(e) => setGen({ ...gen, face: e.target.value as 'front' | 'rear' })}><option value="front">front</option><option value="rear">rear</option></select></Field>
        <button type="button" className="btn" onClick={addRange}>Add range</button>
      </div>
      <div className="ports-editor">
        {ports.map((p, i) => (
          <div key={i} className="row">
            <input value={p.name} onChange={(e) => update(i, { name: e.target.value.toUpperCase() })} />
            <select value={p.kind} onChange={(e) => update(i, { kind: e.target.value })}>{kinds.map((k) => <option key={k}>{k}</option>)}</select>
            <select value={p.face} onChange={(e) => update(i, { face: e.target.value as 'front' | 'rear' })}><option value="front">front</option><option value="rear">rear</option></select>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPorts(ports.filter((_, k) => k !== i))}>✕</button>
          </div>
        ))}
        {ports.length > 0 && <div><button type="button" className="btn btn-sm btn-ghost" onClick={() => setPorts([])}>Clear all ports</button></div>}
      </div>
    </Form>
  );
}
