import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Field, Form } from '../components/ui';

export function Setup() {
  const [email, setEmail] = useState(''); const [name, setName] = useState(''); const [password, setPassword] = useState('');
  const { refresh } = useAuth(); const nav = useNavigate();
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Welcome to Rackdocs</h1>
        <p className="muted">Create the first administrator account. You can add editors and viewers later.</p>
        <Form submitLabel="Create admin account" onSubmit={async () => { await api.post('/setup', { email, name, password }); await refresh(); nav('/'); }}>
          <Field label="Your name"><input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></Field>
          <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Password" hint="At least 8 characters"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></Field>
        </Form>
      </div>
    </div>
  );
}
