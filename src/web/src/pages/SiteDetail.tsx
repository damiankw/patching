import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useCanEdit } from '../lib/auth';
import type { Floor, Room, RackSummary, SiteDetail as SiteDetailT, Vlan } from '../lib/types';
import { Confirm, Dialog, Empty, ErrorBox, Field, Form, Loading, useToast } from '../components/ui';
import { SiteForm } from './Sites';

type Modal =
  | { kind: 'editSite' } | { kind: 'deleteSite' }
  | { kind: 'floor'; floor?: Floor } | { kind: 'deleteFloor'; floor: Floor }
  | { kind: 'room'; floorId: number; room?: Room } | { kind: 'deleteRoom'; room: Room }
  | { kind: 'rack'; roomId: number; rack?: RackSummary } | { kind: 'deleteRack'; rack: RackSummary }
  | { kind: 'vlan'; vlan?: Vlan } | { kind: 'deleteVlan'; vlan: Vlan } | null;

export function SiteDetail() {
  const id = Number(useParams().id);
  const qc = useQueryClient(); const nav = useNavigate(); const toast = useToast();
  const canEdit = useCanEdit();
  const q = useQuery({ queryKey: ['site', id], queryFn: () => api.get<SiteDetailT>(`/sites/${id}`) });
  const vq = useQuery({ queryKey: ['vlans', id], queryFn: () => api.get<Vlan[]>(`/sites/${id}/vlans`) });
  const [modal, setModal] = useState<Modal>(null);
  const [tab, setTab] = useState<'layout' | 'vlans'>('layout');
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['site', id] }), qc.invalidateQueries({ queryKey: ['sites'] }), qc.invalidateQueries({ queryKey: ['racks'] }), qc.invalidateQueries({ queryKey: ['vlans', id] })]);
  const close = () => setModal(null);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const site = q.data!;
  return (
    <div>
      <div className="breadcrumb"><Link to="/">Sites</Link> / <span className="code">{site.code}</span></div>
      <div className="page-head">
        <div><h1>{site.name}</h1>{site.address && <div className="muted">{site.address}</div>}</div>
        {canEdit && <div className="btn-row"><button className="btn" onClick={() => setModal({ kind: 'editSite' })}>Edit</button><button className="btn btn-danger-ghost" onClick={() => setModal({ kind: 'deleteSite' })}>Delete</button></div>}
      </div>
      {site.notes && <p className="notes">{site.notes}</p>}
      <div className="tabs"><button className={tab === 'layout' ? 'active' : ''} onClick={() => setTab('layout')}>Floors & racks</button><button className={tab === 'vlans' ? 'active' : ''} onClick={() => setTab('vlans')}>VLANs ({vq.data?.length ?? 0})</button></div>

      {tab === 'layout' && (
        <div>
          {canEdit && <div className="btn-row" style={{ marginBottom: 12 }}><button className="btn btn-primary" onClick={() => setModal({ kind: 'floor' })}>+ Floor</button></div>}
          {site.floors.length === 0 && <Empty text="No floors yet. Add a floor, then rooms, then racks." />}
          {site.floors.map((f) => (
            <section key={f.id} className="floor">
              <div className="floor-head">
                <h2><span className="code">{f.code}</span> {f.name}</h2>
                {canEdit && <div className="btn-row">
                  <button className="btn btn-sm" onClick={() => setModal({ kind: 'room', floorId: f.id })}>+ Room</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setModal({ kind: 'floor', floor: f })}>Edit</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setModal({ kind: 'deleteFloor', floor: f })}>Delete</button>
                </div>}
              </div>
              {f.rooms.length === 0 && <div className="muted" style={{ padding: '4px 0 12px' }}>No rooms on this floor.</div>}
              {f.rooms.map((r) => (
                <div key={r.id} className="room">
                  <div className="room-head">
                    <h3><span className="code">{r.code}</span> {r.name}</h3>
                    {canEdit && <div className="btn-row">
                      <button className="btn btn-sm" onClick={() => setModal({ kind: 'rack', roomId: r.id })}>+ Rack</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setModal({ kind: 'room', floorId: f.id, room: r })}>Edit</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setModal({ kind: 'deleteRoom', room: r })}>Delete</button>
                    </div>}
                  </div>
                  <div className="rack-cards">
                    {r.racks.length === 0 && <div className="muted">No racks in this room.</div>}
                    {r.racks.map((k) => (
                      <div key={k.id} className="rack-card">
                        <Link to={`/racks/${k.id}`} className="rack-card-main">
                          <div className="card-title"><span className="code">{k.code}</span> {k.name}</div>
                          <div className="muted">{k.height_u}U · {k.device_count} devices · {k.used_u}U used</div>
                          <div className="fill"><div className="fill-bar" style={{ width: `${Math.min(100, (k.used_u / k.height_u) * 100)}%` }} /></div>
                        </Link>
                        {canEdit && <div className="btn-row"><button className="btn btn-sm btn-ghost" onClick={() => setModal({ kind: 'rack', roomId: r.id, rack: k })}>Edit</button><button className="btn btn-sm btn-ghost" onClick={() => setModal({ kind: 'deleteRack', rack: k })}>Delete</button></div>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}

      {tab === 'vlans' && (
        <div>
          {canEdit && <div className="btn-row" style={{ marginBottom: 12 }}><button className="btn btn-primary" onClick={() => setModal({ kind: 'vlan' })}>+ VLAN</button></div>}
          {vq.data?.length === 0 && <Empty text="No VLANs defined for this site. VLANs can be assigned to switch ports in the rack editor." />}
          {vq.data && vq.data.length > 0 && (
            <table className="table"><thead><tr><th>VID</th><th>Name</th><th>Description</th><th>Ports</th><th /></tr></thead>
              <tbody>{vq.data.map((v) => (
                <tr key={v.id}><td><span className="code">{v.vid}</span></td><td>{v.name}</td><td className="muted">{v.description}</td><td>{v.port_count}</td>
                  <td className="row-actions">{canEdit && <><button className="btn btn-sm btn-ghost" onClick={() => setModal({ kind: 'vlan', vlan: v })}>Edit</button><button className="btn btn-sm btn-ghost" onClick={() => setModal({ kind: 'deleteVlan', vlan: v })}>Delete</button></>}</td></tr>
              ))}</tbody></table>
          )}
        </div>
      )}

      <Dialog open={modal?.kind === 'editSite'} onClose={close} title="Edit site">{modal?.kind === 'editSite' && <SiteForm initial={site} onDone={() => { close(); refresh(); }} />}</Dialog>
      <Confirm open={modal?.kind === 'deleteSite'} onClose={close} title="Delete site" text={`Delete ${site.code} and all of its floors, rooms, racks, devices and connections? This cannot be undone.`}
        onConfirm={async () => { await api.del(`/sites/${id}`); await qc.invalidateQueries({ queryKey: ['sites'] }); toast(`Deleted ${site.code}`); nav('/'); }} />

      <Dialog open={modal?.kind === 'floor'} onClose={close} title={modal?.kind === 'floor' && modal.floor ? 'Edit floor' : 'New floor'}>
        {modal?.kind === 'floor' && <FloorForm siteId={id} floor={modal.floor} onDone={() => { close(); refresh(); }} />}
      </Dialog>
      <Confirm open={modal?.kind === 'deleteFloor'} onClose={close} title="Delete floor" text={modal?.kind === 'deleteFloor' ? `Delete floor ${modal.floor.code} with all rooms, racks and devices on it?` : ''}
        onConfirm={async () => { if (modal?.kind === 'deleteFloor') { await api.del(`/floors/${modal.floor.id}`); await refresh(); } }} />

      <Dialog open={modal?.kind === 'room'} onClose={close} title={modal?.kind === 'room' && modal.room ? 'Edit room' : 'New room'}>
        {modal?.kind === 'room' && <RoomForm floorId={modal.floorId} room={modal.room} onDone={() => { close(); refresh(); }} />}
      </Dialog>
      <Confirm open={modal?.kind === 'deleteRoom'} onClose={close} title="Delete room" text={modal?.kind === 'deleteRoom' ? `Delete room ${modal.room.code} with all racks and devices in it?` : ''}
        onConfirm={async () => { if (modal?.kind === 'deleteRoom') { await api.del(`/rooms/${modal.room.id}`); await refresh(); } }} />

      <Dialog open={modal?.kind === 'rack'} onClose={close} title={modal?.kind === 'rack' && modal.rack ? 'Edit rack' : 'New rack'}>
        {modal?.kind === 'rack' && <RackForm roomId={modal.roomId} rack={modal.rack} onDone={() => { close(); refresh(); }} />}
      </Dialog>
      <Confirm open={modal?.kind === 'deleteRack'} onClose={close} title="Delete rack" text={modal?.kind === 'deleteRack' ? `Delete rack ${modal.rack.code} with ${modal.rack.device_count} devices and their connections?` : ''}
        onConfirm={async () => { if (modal?.kind === 'deleteRack') { await api.del(`/racks/${modal.rack.id}`); await refresh(); } }} />

      <Dialog open={modal?.kind === 'vlan'} onClose={close} title={modal?.kind === 'vlan' && modal.vlan ? 'Edit VLAN' : 'New VLAN'}>
        {modal?.kind === 'vlan' && <VlanForm siteId={id} vlan={modal.vlan} onDone={() => { close(); refresh(); }} />}
      </Dialog>
      <Confirm open={modal?.kind === 'deleteVlan'} onClose={close} title="Delete VLAN" text={modal?.kind === 'deleteVlan' ? `Delete VLAN ${modal.vlan.vid} ${modal.vlan.name}? Ports assigned to it will be cleared.` : ''}
        onConfirm={async () => { if (modal?.kind === 'deleteVlan') { await api.del(`/vlans/${modal.vlan.id}`); await refresh(); } }} />
    </div>
  );
}

function FloorForm({ siteId, floor, onDone }: { siteId: number; floor?: Floor; onDone: () => void }) {
  const [code, setCode] = useState(floor?.code ?? ''); const [name, setName] = useState(floor?.name ?? ''); const [sort, setSort] = useState(floor?.sort ?? 0);
  return (
    <Form onCancel={onDone} onSubmit={async () => { const b = { code, name, sort: Number(sort) }; if (floor) await api.patch(`/floors/${floor.id}`, b); else await api.post(`/sites/${siteId}/floors`, b); onDone(); }}>
      <Field label="Floor code" hint="e.g. B1, G, L1, L2"><input value={code} onChange={(e) => setCode(e.target.value)} required autoFocus /></Field>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
      <Field label="Sort order" hint="Lower numbers appear first"><input type="number" value={sort} onChange={(e) => setSort(Number(e.target.value))} /></Field>
    </Form>
  );
}

function RoomForm({ floorId, room, onDone }: { floorId: number; room?: Room; onDone: () => void }) {
  const [code, setCode] = useState(room?.code ?? ''); const [name, setName] = useState(room?.name ?? ''); const [notes, setNotes] = useState(room?.notes ?? '');
  return (
    <Form onCancel={onDone} onSubmit={async () => { const b = { code, name, notes }; if (room) await api.patch(`/rooms/${room.id}`, b); else await api.post(`/floors/${floorId}/rooms`, b); onDone(); }}>
      <Field label="Room code" hint="e.g. MDF, IDF1, COMMS"><input value={code} onChange={(e) => setCode(e.target.value)} required autoFocus /></Field>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
      <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
    </Form>
  );
}

export function RackForm({ roomId, rack, onDone }: { roomId: number; rack?: RackSummary; onDone: () => void }) {
  const [code, setCode] = useState(rack?.code ?? ''); const [name, setName] = useState(rack?.name ?? ''); const [height, setHeight] = useState(rack?.height_u ?? 42); const [notes, setNotes] = useState(rack?.notes ?? '');
  return (
    <Form onCancel={onDone} onSubmit={async () => { const b = { code, name, height_u: Number(height), notes }; if (rack) await api.patch(`/racks/${rack.id}`, b); else await api.post(`/rooms/${roomId}/racks`, b); onDone(); }}>
      <Field label="Rack code" hint="e.g. R01, RK-A"><input value={code} onChange={(e) => setCode(e.target.value)} required autoFocus /></Field>
      <Field label="Name (optional)"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Height (U)"><input type="number" min={1} max={60} value={height} onChange={(e) => setHeight(Number(e.target.value))} required /></Field>
      <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
    </Form>
  );
}

function VlanForm({ siteId, vlan, onDone }: { siteId: number; vlan?: Vlan; onDone: () => void }) {
  const [vid, setVid] = useState(vlan?.vid ?? 1); const [name, setName] = useState(vlan?.name ?? ''); const [description, setDescription] = useState(vlan?.description ?? '');
  return (
    <Form onCancel={onDone} onSubmit={async () => { const b = { vid: Number(vid), name, description }; if (vlan) await api.patch(`/vlans/${vlan.id}`, b); else await api.post(`/sites/${siteId}/vlans`, b); onDone(); }}>
      <Field label="VLAN ID" hint="1 to 4094"><input type="number" min={1} max={4094} value={vid} onChange={(e) => setVid(Number(e.target.value))} required autoFocus /></Field>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
      <Field label="Description"><input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
    </Form>
  );
}
