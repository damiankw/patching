import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Field, Form } from '../components/ui';

export function Setup() {
  const [email, setEmail] = useState(''); const [name, setName] = useState(''); const [password, setPassword] = useState('');
  const [acc, setAcc] = useState(''); const [accName, setAccName] = useState('');
  const { refresh } = useAuth(); const nav = useNavigate();
  return <div className="auth-page"><div className="auth-card">
    <h1>Welcome to Rackdocs</h1><p className="muted">Set up your account and the first administrator.</p>
    <Form submitLabel="Create account" onSubmit={async () => { await api.post('/setup', { email, name, password, account_code: acc, account_name: accName }); await refresh(); nav('/locations'); }}>
      <div className="form-row"><Field label="Account ID" required hint="Short, e.g. ACME. Prefixes every resource path."><input value={acc} onChange={(e) => setAcc(e.target.value)} required autoFocus /></Field>
        <Field label="Organisation name" required><input value={accName} onChange={(e) => setAccName(e.target.value)} required /></Field></div>
      <Field label="Your name" required><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
      <Field label="Email" required><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
      <Field label="Password" required hint="At least 8 characters"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></Field>
    </Form></div></div>;
}
