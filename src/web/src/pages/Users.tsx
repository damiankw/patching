import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Role, User } from '../lib/types';
import { Confirm, Dialog, ErrorBox, Field, Form, Loading } from '../components/ui';

export function Users() {
  const qc = useQueryClient(); const { user: me } = useAuth();
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') });
  const [edit, setEdit] = useState<User | null | 'new'>(null); const [del, setDel] = useState<User | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });
  return (
    <div>
      <div className="page-head"><h1>Users</h1><button className="btn btn-primary" onClick={() => setEdit('new')}>+ New user</button></div>
      <p className="muted">Admins manage users. Editors can change documentation. Viewers can only read.</p>
      {q.isLoading && <Loading />}{q.error && <ErrorBox error={q.error} />}
      {q.data && (
        <table className="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th /></tr></thead>
          <tbody>{q.data.map((u) => (
            <tr key={u.id}><td>{u.name}{u.id === me?.id && <span className="muted"> (you)</span>}</td><td>{u.email}</td><td><span className="badge">{u.role}</span></td>
              <td className="row-actions"><button className="btn btn-sm btn-ghost" onClick={() => setEdit(u)}>Edit</button>{u.id !== me?.id && <button className="btn btn-sm btn-ghost" onClick={() => setDel(u)}>Delete</button>}</td></tr>
          ))}</tbody></table>
      )}
      <Dialog open={edit !== null} onClose={() => setEdit(null)} title={edit === 'new' ? 'New user' : 'Edit user'}>
        {edit !== null && <UserForm user={edit === 'new' ? undefined : edit} onDone={() => { setEdit(null); refresh(); }} />}
      </Dialog>
      <Confirm open={del !== null} onClose={() => setDel(null)} title="Delete user" text={`Delete ${del?.email}?`} onConfirm={async () => { await api.del(`/users/${del!.id}`); await refresh(); }} />
    </div>
  );
}

function UserForm({ user, onDone }: { user?: User; onDone: () => void }) {
  const [name, setName] = useState(user?.name ?? ''); const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState(''); const [role, setRole] = useState<Role>(user?.role ?? 'editor');
  return (
    <Form onCancel={onDone} onSubmit={async () => {
      const b: Record<string, unknown> = { name, email, role }; if (password) b.password = password;
      if (user) await api.patch(`/users/${user.id}`, b); else await api.post('/users', { ...b, password }); onDone();
    }}>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></Field>
      <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
      <Field label={user ? 'New password (leave blank to keep)' : 'Password'} hint="At least 8 characters"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required={!user} /></Field>
      <Field label="Role"><select value={role} onChange={(e) => setRole(e.target.value as Role)}><option value="admin">Admin</option><option value="editor">Editor</option><option value="viewer">Viewer</option></select></Field>
    </Form>
  );
}
