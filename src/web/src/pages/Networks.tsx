import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Network, Copy, BookOpen } from 'lucide-react';
import { api, fmtDate } from '../lib/api';
import { useCanEdit } from '../lib/auth';
import type { Vlan, Wlan } from '../lib/types';
import { usePageHeader } from '../components/Shell';
import { DataTable } from '../components/DataTable';
import { Confirm, Dialog, ErrorBox, Field, Form, IconBtn, Loading, useToast } from '../components/ui';

export function Networks() {
  const tab = (useParams().tab ?? 'vlans') as 'vlans' | 'wlans'; const nav = useNavigate();
  const canEdit = useCanEdit(); const qc = useQueryClient(); const toast = useToast();
  const [modal, setModal] = useState<null | { kind: 'edit'; row?: Vlan | Wlan } | { kind: 'delete'; row: Vlan | Wlan } | { kind: 'ports'; row: Vlan | Wlan }>(null);
  const label = tab === 'vlans' ? 'VLAN' : 'WLAN';
  usePageHeader({ title: label, crumbs: [{ label }], actions: <>{canEdit && <button className="btn btn-primary" onClick={() => setModal({ kind: 'edit' })}><Plus size={15} /> Add {label}</button>}<a className="icon-btn bordered" href="https://github.com/damiankw/patching#readme" target="_blank" rel="noreferrer" title="Documentation"><BookOpen size={15} /></a></> }, [tab, canEdit]);
  const q = useQuery({ queryKey: [tab], queryFn: () => api.get<(Vlan | Wlan)[]>(`/${tab}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: [tab] });
  if (q.isLoading) return <Loading />; if (q.error) return <ErrorBox error={q.error} />;
  const actions = (r: Vlan | Wlan) => <div className="row-actions">
    <IconBtn title="Ports in this network" onClick={() => setModal({ kind: 'ports', row: r })}><Network size={14} /></IconBtn>
    <IconBtn title="Copy" onClick={() => { navigator.clipboard?.writeText('vid' in r ? String(r.vid) : r.ssid); toast('Copied'); }}><Copy size={14} /></IconBtn>
    {canEdit && <IconBtn title="Edit" onClick={() => setModal({ kind: 'edit', row: r })}><Pencil size={14} /></IconBtn>}
    {canEdit && <IconBtn title="Delete" danger onClick={() => setModal({ kind: 'delete', row: r })}><Trash2 size={14} /></IconBtn>}</div>;
  return <div>
    <div className="chip-tabs" style={{ marginBottom: 10 }}><button className={tab === 'vlans' ? 'active' : ''} onClick={() => nav('/networks/vlans')}>VLAN</button><button className={tab === 'wlans' ? 'active' : ''} onClick={() => nav('/networks/wlans')}>WLAN</button></div>
    {tab === 'vlans' ? <DataTable rows={q.data as Vlan[]} csvHref="/api/export/vlans.csv" empty="No VLANs yet." columns={[
      { key: 'name', label: 'Name' }, { key: 'vid', label: 'Network number' }, { key: 'description', label: 'Description' }, { key: 'port_count', label: 'Ports' },
      { key: 'created_at', label: 'Created', render: (r) => fmtDate(r.created_at) }, { key: 'updated_at', label: 'Updated', render: (r) => fmtDate(r.updated_at) }, { key: 'actions', label: 'Actions', align: 'right', render: actions }]} />
      : <DataTable rows={q.data as Wlan[]} csvHref="/api/export/wlans.csv" empty="No WLANs yet." columns={[
      { key: 'ssid', label: 'SSID' }, { key: 'name', label: 'Name' }, { key: 'security', label: 'Security' }, { key: 'description', label: 'Description' }, { key: 'port_count', label: 'Ports' },
      { key: 'created_at', label: 'Created', render: (r) => fmtDate(r.created_at) }, { key: 'updated_at', label: 'Updated', render: (r) => fmtDate(r.updated_at) }, { key: 'actions', label: 'Actions', align: 'right', render: actions }]} />}
    <Dialog open={modal?.kind === 'edit'} onClose={() => setModal(null)} title={modal?.kind === 'edit' && modal.row ? `Edit ${label}` : `Add ${label}`}>
      {modal?.kind === 'edit' && (tab === 'vlans' ? <VlanForm row={modal.row as Vlan | undefined} onDone={() => { setModal(null); refresh(); }} /> : <WlanForm row={modal.row as Wlan | undefined} onDone={() => { setModal(null); refresh(); }} />)}
    </Dialog>
    <Confirm open={modal?.kind === 'delete'} onClose={() => setModal(null)} title={`Delete ${label}`} text={modal?.kind === 'delete' ? `Delete ${'vid' in modal.row ? `VLAN ${modal.row.vid} ${modal.row.name}` : modal.row.ssid}? Assigned ports will be cleared.` : ''}
      onConfirm={async () => { if (modal?.kind === 'delete') { await api.del(`/${tab}/${modal.row.id}`); refresh(); } }} />
    <Dialog open={modal?.kind === 'ports'} onClose={() => setModal(null)} title={modal?.kind === 'ports' ? ('vid' in modal.row ? `Ports in VLAN ${modal.row.vid}` : `Ports in ${modal.row.ssid}`) : ''} wide>
      {modal?.kind === 'ports' && <NetworkPorts tab={tab} id={modal.row.id} />}
    </Dialog>
  </div>;
}
function NetworkPorts({ tab, id }: { tab: string; id: number }) {
  const q = useQuery({ queryKey: [tab, id, 'ports'], queryFn: () => api.get<{ id: number; path: string; type_name: string; device_id: number; rack_id: number | null; floor_id: number }[]>(`/${tab}/${id}/ports`) });
  if (q.isLoading) return <Loading />;
  if (!q.data?.length) return <div className="muted">No ports assigned.</div>;
  return <table className="table"><thead><tr><th>Port</th><th>Device type</th></tr></thead><tbody>{q.data.map((p) => <tr key={p.id}><td><Link to={p.rack_id ? `/racks/${p.rack_id}?device=${p.device_id}` : `/floors/${p.floor_id}?device=${p.device_id}`} className="code">{p.path}</Link></td><td>{p.type_name}</td></tr>)}</tbody></table>;
}
function VlanForm({ row, onDone }: { row?: Vlan; onDone: () => void }) {
  const [vid, setVid] = useState(row?.vid ?? 1); const [name, setName] = useState(row?.name ?? ''); const [description, setDescription] = useState(row?.description ?? '');
  return <Form onCancel={onDone} onSubmit={async () => { const b = { vid: Number(vid), name, description }; if (row) await api.patch(`/vlans/${row.id}`, b); else await api.post('/vlans', b); onDone(); }}>
    <div className="form-row"><Field label="Name" required><input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></Field><Field label="Network number" required hint="1 to 4094"><input type="number" min={1} max={4094} value={vid} onChange={(e) => setVid(Number(e.target.value))} required /></Field></div>
    <Field label="Description"><input value={description} onChange={(e) => setDescription(e.target.value)} /></Field></Form>;
}
function WlanForm({ row, onDone }: { row?: Wlan; onDone: () => void }) {
  const [ssid, setSsid] = useState(row?.ssid ?? ''); const [name, setName] = useState(row?.name ?? ''); const [security, setSecurity] = useState(row?.security ?? 'WPA2'); const [description, setDescription] = useState(row?.description ?? '');
  return <Form onCancel={onDone} onSubmit={async () => { const b = { ssid, name, security, description }; if (row) await api.patch(`/wlans/${row.id}`, b); else await api.post('/wlans', b); onDone(); }}>
    <div className="form-row"><Field label="SSID" required><input value={ssid} onChange={(e) => setSsid(e.target.value)} required autoFocus /></Field><Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
    <div className="form-row"><Field label="Security"><select value={security} onChange={(e) => setSecurity(e.target.value)}>{['Open', 'WEP', 'WPA', 'WPA2', 'WPA2-Enterprise', 'WPA3', 'WPA3-Enterprise'].map((s) => <option key={s}>{s}</option>)}</select></Field><Field label="Description"><input value={description} onChange={(e) => setDescription(e.target.value)} /></Field></div></Form>;
}
