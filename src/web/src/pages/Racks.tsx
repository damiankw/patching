import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { api, fmtDate } from '../lib/api';
import type { RackRow } from '../lib/types';
import { usePageHeader } from '../components/Shell';
import { DataTable } from '../components/DataTable';
import { ErrorBox, Loading } from '../components/ui';

export function Racks() {
  usePageHeader({ title: 'Racks', crumbs: [{ label: 'Racks' }], actions: <a className="icon-btn bordered" href="https://github.com/damiankw/patching#readme" target="_blank" rel="noreferrer" title="Documentation"><BookOpen size={15} /></a> });
  const q = useQuery({ queryKey: ['racks'], queryFn: () => api.get<RackRow[]>('/racks') });
  if (q.isLoading) return <Loading />; if (q.error) return <ErrorBox error={q.error} />;
  return <DataTable rows={q.data ?? []} csvHref="/api/export/racks.csv" empty="No racks yet. Place a Rack on a floor in the Location View." columns={[
    { key: 'path', label: 'ID', render: (r) => <Link to={`/racks/${r.id}`}>{r.path}</Link> },
    { key: 'name', label: 'Name' },
    { key: 'location_code', label: 'Location', render: (r) => <Link to={`/locations/${r.location_id}`}>{r.location_code}</Link> },
    { key: 'floor_code', label: 'Floor', render: (r) => <Link to={`/floors/${r.floor_id}`}>{r.location_code}/{r.floor_code}</Link> },
    { key: 'room_code', label: 'Room', render: (r) => <Link to={`/floors/${r.floor_id}?room=${r.room_id ?? ''}`}>{r.location_code}/{r.floor_code}/{r.room_code ?? 'DEFAULT'}</Link> },
    { key: 'height_u', label: 'Rack units' }, { key: 'device_count', label: 'Devices' }, { key: 'used_u', label: 'Used U' },
    { key: 'created_at', label: 'Created', render: (r) => fmtDate(r.created_at) }, { key: 'updated_at', label: 'Updated', render: (r) => fmtDate(r.updated_at) },
  ]} />;
}
