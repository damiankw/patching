import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { api, fmtDate } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Role, User } from '../lib/types';
import { usePageHeader } from '../components/Shell';
import { DataTable } from '../components/DataTable';
import { Badge, Confirm, Dialog, ErrorBox, Field, Form, IconBtn, Loading } from '../components/ui';

export function Users() {
  const qc = useQueryClient(); const { user: me } = useAuth();
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') });
  const [edit, setEdit] = useState<User | null | 'new'>(null); const [del, setDel] = useState<User | null>(null);
  usePageHeader({ title: 'Users & Permissions', crumbs: [{ label: 'Users & Permissions' }], actions: <button className="btn btn-primary" onClick={() => setEdit('new')}><Plus size={15} /> Invite user</button> });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['users'] }), qc.invalidateQueries({ queryKey: ['users-lite'] })]);
  if (q.isLoading) return <Loading />; if (q.error) return <ErrorBox error={q.error} />;
  return <div>
    <p className="muted">Admins manage users and settings. Editors change documentation. Viewers read only.</p>
    <DataTable rows={q.data ?? []} search={false} columns={[
      { key: 'name', label: 'Name', render: (u) => <>{u.name}{u.id === me?.id && <span className="muted"> (you)</span>}</> }, { key: 'email', label: 'Email' },
      { key: 'role', label: 'Role', render: (u) => <Badge tone={u.role === 'admin' ? 'blue' : u.role === 'editor' ? 'green' : 'grey'}>{u.role}</Badge> }, { key: 'created_at', label: 'Created', render: (u) => fmtDate(u.created_at) },
      { key: 'actions', label: 'Actions', align: 'right', render: (u) => <div className="row-actions"><IconBtn title="Edit" onClick={() => setEdit(u)}><Pencil size={14} /></IconBtn>{u.id !== me?.id && <IconBtn title="Delete" danger onClick={() => setDel(u)}><Trash2 size={14} /></IconBtn>}</div> }]} />
    <Dialog open={edit !== null} onClose={() => setEdit(null)} title={edit === 'new' ? 'Invite user' : 'Edit user'}>{edit !== null && <UserForm user={edit === 'new' ? undefined : edit} onDone={() => { setEdit(null); refresh(); }} />}</Dialog>
    <Confirm open={del !== null} onClose={() => setDel(null)} title="Delete user" text={`Delete ${del?.email}?`} onConfirm={async () => { await api.del(`/users/${del!.id}`); await refresh(); }} />
  </div>;
}
function UserForm({ user, onDone }: { user?: User; onDone: () => void }) {
  const [name, setName] = useState(user?.name ?? ''); const [email, setEmail] = useState(user?.email ?? ''); const [password, setPassword] = useState(''); const [role, setRole] = useState<Role>(user?.role ?? 'editor');
  return <Form onCancel={onDone} onSubmit={async () => { const b: Record<string, unknown> = { name, email, role }; if (password) b.password = password; if (user) await api.patch(`/users/${user.id}`, b); else await api.post('/users', { ...b, password }); onDone(); }}>
    <div className="form-row"><Field label="Name" required><input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></Field><Field label="Email" required><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field></div>
    <div className="form-row"><Field label={user ? 'New password' : 'Password'} required={!user} hint={user ? 'Leave blank to keep' : 'At least 8 characters'}><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required={!user} /></Field>
      <Field label="Role"><select value={role} onChange={(e) => setRole(e.target.value as Role)}><option value="admin">Admin</option><option value="editor">Editor</option><option value="viewer">Viewer</option></select></Field></div></Form>;
}
