import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import L from 'leaflet';
import { Building2, Plus, Pencil, FileText, MoreVertical, Layers, DoorOpen, Boxes, MapPin, BookOpen } from 'lucide-react';
import { api } from '../lib/api';
import { useCanEdit } from '../lib/auth';
import type { Location } from '../lib/types';
import { usePageHeader } from '../components/Shell';
import { Confirm, Dialog, Empty, ErrorBox, Field, Form, IconBtn, Loading, Menu, PersonSelect, useToast } from '../components/ui';

export function Locations() {
  const q = useQuery({ queryKey: ['locations'], queryFn: () => api.get<Location[]>('/locations') });
  const canEdit = useCanEdit(); const qc = useQueryClient(); const toast = useToast(); const nav = useNavigate();
  const [modal, setModal] = useState<null | { kind: 'add' } | { kind: 'edit'; loc: Location } | { kind: 'notes'; loc: Location } | { kind: 'delete'; loc: Location }>(null);
  usePageHeader({ title: 'Locations', crumbs: [{ label: 'Locations' }], actions: <>{canEdit && <button className="btn btn-primary" onClick={() => setModal({ kind: 'add' })}><Plus size={15} /> Add location</button>}<a className="icon-btn bordered" href="https://github.com/damiankw/patching#readme" target="_blank" rel="noreferrer" title="Documentation"><BookOpen size={15} /></a></> }, [canEdit]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['locations'] });
  return <div>
    <MapPanel locations={q.data ?? []} />
    {q.isLoading && <Loading />}{q.error && <ErrorBox error={q.error} />}
    {q.data?.length === 0 && <Empty text="No locations yet. A location is a building or site; everything you document lives inside one.">{canEdit && <button className="btn btn-primary" onClick={() => setModal({ kind: 'add' })}><Plus size={15} /> Add location</button>}</Empty>}
    <div className="loc-cards">{q.data?.map((l) => (
      <div key={l.id} className="loc-card">
        <div className="loc-card-head"><div className="loc-icon"><Building2 size={18} /></div>
          <div className="grow"><div className="loc-name"><Link to={`/locations/${l.id}`}>{l.name}</Link></div><div className="muted small">{l.code}</div></div>
          <div className="btn-row">
            {canEdit && <IconBtn title="Edit" onClick={() => setModal({ kind: 'edit', loc: l })}><Pencil size={15} /></IconBtn>}
            <IconBtn title="Notes" onClick={() => setModal({ kind: 'notes', loc: l })} active={!!l.notes}><FileText size={15} /></IconBtn>
            <Menu button={<IconBtn title="More"><MoreVertical size={15} /></IconBtn>} items={[
              { label: 'Copy ID', onClick: () => { navigator.clipboard?.writeText(l.code); toast('Copied'); } },
              { label: 'Copy link', onClick: () => { navigator.clipboard?.writeText(`${location.origin}/locations/${l.id}`); toast('Copied'); } },
              { label: 'Export as PDF', onClick: () => window.open(`/report/location/${l.id}`, '_blank') },
              { label: 'Activity Log', onClick: () => nav(`/activity?q=${encodeURIComponent(l.code + '/')}`) },
              { sep: true, label: '' }, { label: 'Delete', danger: true, disabled: !canEdit, onClick: () => setModal({ kind: 'delete', loc: l }) }]} />
          </div></div>
        <div className="loc-stats"><div className="loc-stat"><div className="muted"><Layers size={12} /> Floors</div><b>{l.floor_count}</b></div><div className="loc-stat"><div className="muted"><DoorOpen size={12} /> Rooms</div><b>{l.room_count}</b></div><div className="loc-stat"><div className="muted"><Boxes size={12} /> Devices</div><b>{l.device_count}</b></div></div>
        {l.address && <div className="loc-addr"><MapPin size={13} className="muted" />{l.address}</div>}
      </div>))}</div>
    <Dialog open={modal?.kind === 'add' || modal?.kind === 'edit'} onClose={() => setModal(null)} title={modal?.kind === 'edit' ? 'Edit location' : 'Add location'} subtitle={modal?.kind === 'add' ? 'A Ground Floor is created automatically.' : undefined}>
      {(modal?.kind === 'add' || modal?.kind === 'edit') && <LocationForm initial={modal.kind === 'edit' ? modal.loc : undefined} onDone={async (created) => { setModal(null); await refresh(); if (created) nav(`/locations/${created.id}`); }} />}
    </Dialog>
    <Dialog open={modal?.kind === 'notes'} onClose={() => setModal(null)} title={`Notes · ${modal?.kind === 'notes' ? modal.loc.code : ''}`}>
      {modal?.kind === 'notes' && <NotesForm value={modal.loc.notes} canEdit={canEdit} onSave={async (notes) => { await api.patch(`/locations/${modal.loc.id}`, { notes }); setModal(null); refresh(); }} />}
    </Dialog>
    <Confirm open={modal?.kind === 'delete'} onClose={() => setModal(null)} title="Delete location" text={modal?.kind === 'delete' ? `Delete ${modal.loc.code} with ${modal.loc.floor_count} floors, ${modal.loc.room_count} rooms and ${modal.loc.device_count} devices? This cannot be undone.` : ''}
      onConfirm={async () => { if (modal?.kind === 'delete') { await api.del(`/locations/${modal.loc.id}`); refresh(); } }} />
  </div>;
}

export function NotesForm({ value, canEdit, onSave }: { value: string; canEdit: boolean; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = useState(value);
  return <Form submitLabel="Save notes" onSubmit={() => onSave(v)} disabled={!canEdit}><textarea rows={8} value={v} onChange={(e) => setV(e.target.value)} disabled={!canEdit} placeholder="Access rules, contacts, anything a technician should know…" /></Form>;
}

export function LocationForm({ initial, onDone }: { initial?: Location; onDone: (created?: Location) => void }) {
  const [code, setCode] = useState(initial?.code ?? ''); const [name, setName] = useState(initial?.name ?? ''); const [address, setAddress] = useState(initial?.address ?? '');
  const [contact, setContact] = useState(initial?.contact ?? ''); const [resp, setResp] = useState<number | null>(initial?.responsible_user_id ?? null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(initial?.lat != null && initial?.lng != null ? { lat: initial.lat, lng: initial.lng } : null);
  const [sugg, setSugg] = useState<{ address: string; lat: number; lng: number }[]>([]); const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lookup = (v: string) => { setAddress(v); clearTimeout(timer.current); if (v.trim().length < 4) { setSugg([]); return; } timer.current = setTimeout(() => api.get<typeof sugg>(`/geocode?q=${encodeURIComponent(v)}`).then(setSugg).catch(() => setSugg([])), 500); };
  return <Form onCancel={() => onDone()} onSubmit={async () => {
    let c = coords;
    if (!c && address.trim() && (!initial || address !== initial.address)) { const r = await api.get<typeof sugg>(`/geocode?q=${encodeURIComponent(address)}`).catch(() => []); if (r[0]) c = { lat: r[0].lat, lng: r[0].lng }; }
    const body = { code, name, address, contact, responsible_user_id: resp, lat: c?.lat ?? null, lng: c?.lng ?? null };
    if (initial) { await api.patch(`/locations/${initial.id}`, body); onDone(); } else { const created = await api.post<Location>('/locations', body); onDone(created); }
  }}>
    <div className="form-row"><Field label="ID" required hint="e.g. HQ, HALL-A, STORE-042"><input value={code} onChange={(e) => setCode(e.target.value)} required autoFocus /></Field><Field label="Name" required><input value={name} onChange={(e) => setName(e.target.value)} required /></Field></div>
    <Field label="Address" hint="Start typing to search; the map marker is placed automatically."><div style={{ position: 'relative' }}><input value={address} onChange={(e) => { lookup(e.target.value); setCoords(null); }} />
      {sugg.length > 0 && <div className="menu-list menu-left" style={{ top: '100%', bottom: 'auto', width: '100%' }}>{sugg.map((s, i) => <button key={i} type="button" className="menu-item" onClick={() => { setAddress(s.address); setCoords({ lat: s.lat, lng: s.lng }); setSugg([]); }}>{s.address}</button>)}</div>}</div></Field>
    <div className="form-row"><Field label="Responsible person"><PersonSelect value={resp} onChange={setResp} /></Field><Field label="Contact person"><input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Name, phone…" /></Field></div>
  </Form>;
}

function MapPanel({ locations }: { locations: Location[] }) {
  const ref = useRef<HTMLDivElement>(null); const map = useRef<L.Map | null>(null); const layer = useRef<L.LayerGroup | null>(null); const nav = useNavigate();
  useEffect(() => {
    if (!ref.current || map.current) return;
    map.current = L.map(ref.current, { zoomControl: true, scrollWheelZoom: false }).setView([-25, 134], 4);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
  }, []);
  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    const pts = locations.filter((l) => l.lat != null && l.lng != null);
    for (const l of pts) {
      const icon = L.divIcon({ className: '', html: '<div class="loc-marker"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></svg></div>', iconSize: [28, 28], iconAnchor: [14, 28] });
      L.marker([l.lat!, l.lng!], { icon }).addTo(layer.current).bindTooltip(`${l.code} · ${l.name}`).on('click', () => nav(`/locations/${l.id}`));
    }
    if (pts.length === 1) map.current.setView([pts[0].lat!, pts[0].lng!], 12);
    else if (pts.length > 1) map.current.fitBounds(L.latLngBounds(pts.map((l) => [l.lat!, l.lng!] as [number, number])), { padding: [40, 40] });
  }, [locations, nav]);
  return <div className="map-wrap" ref={ref} />;
}
