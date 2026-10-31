import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useCanEdit } from '../lib/auth';
import type { Site } from '../lib/types';
import { Dialog, Empty, ErrorBox, Field, Form, Loading } from '../components/ui';

export function SiteForm({ initial, onDone }: { initial?: Partial<Site>; onDone: () => void }) {
  const [code, setCode] = useState(initial?.code ?? ''); const [name, setName] = useState(initial?.name ?? '');
  const [address, setAddress] = useState(initial?.address ?? ''); const [notes, setNotes] = useState(initial?.notes ?? '');
  const qc = useQueryClient();
  return (
    <Form onCancel={onDone} onSubmit={async () => {
      const body = { code, name, address, notes };
      if (initial?.id) await api.patch(`/sites/${initial.id}`, body); else await api.post('/sites', body);
      await qc.invalidateQueries({ queryKey: ['sites'] }); if (initial?.id) await qc.invalidateQueries({ queryKey: ['site', initial.id] });
      onDone();
    }}>
      <Field label="Site code" hint="Short unique ID, e.g. SYD or HQ. Used as a prefix everywhere."><input value={code} onChange={(e) => setCode(e.target.value)} required autoFocus /></Field>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
      <Field label="Address"><input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
      <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} /></Field>
    </Form>
  );
}

export function Sites() {
  const q = useQuery({ queryKey: ['sites'], queryFn: () => api.get<Site[]>('/sites') });
  const canEdit = useCanEdit();
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <div className="page-head"><h1>Sites</h1>{canEdit && <button className="btn btn-primary" onClick={() => setCreating(true)}>+ New site</button>}</div>
      {q.isLoading && <Loading />}{q.error && <ErrorBox error={q.error} />}
      {q.data && q.data.length === 0 && <Empty text="No sites yet. A site is a building or location that holds floors, rooms and racks.">{canEdit && <button className="btn btn-primary" onClick={() => setCreating(true)}>Create your first site</button>}</Empty>}
      <div className="cards">
        {q.data?.map((s) => (
          <Link key={s.id} to={`/sites/${s.id}`} className="card">
            <div className="card-title"><span className="code">{s.code}</span> {s.name}</div>
            {s.address && <div className="muted">{s.address}</div>}
            <div className="card-stats"><span>{s.floor_count} floors</span><span>{s.rack_count} racks</span><span>{s.device_count} devices</span></div>
          </Link>
        ))}
      </div>
      <Dialog open={creating} onClose={() => setCreating(false)} title="New site"><SiteForm onDone={() => setCreating(false)} /></Dialog>
    </div>
  );
}
