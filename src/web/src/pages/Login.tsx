import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Field, Form } from '../components/ui';
export function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const { refresh } = useAuth(); const nav = useNavigate();
  return <div className="auth-page"><div className="auth-card"><h1>Rackdocs</h1><p className="muted">Sign in to continue.</p>
    <Form submitLabel="Sign in" onSubmit={async () => { await api.post('/auth/login', { email, password }); await refresh(); nav('/locations'); }}>
      <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
      <Field label="Password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
    </Form></div></div>;
}
