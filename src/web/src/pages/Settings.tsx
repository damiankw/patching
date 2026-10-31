import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { applyTheme, getTheme } from '../lib/theme';
import { usePageHeader } from '../components/Shell';
import { Field, Form, useToast } from '../components/ui';

export function Settings() {
  const { user, refresh } = useAuth(); const toast = useToast(); const qc = useQueryClient();
  usePageHeader({ title: 'Settings', crumbs: [{ label: 'Settings' }] });
  const [code, setCode] = useState(user?.account_code ?? ''); const [name, setName] = useState(user?.account_name ?? '');
  const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [theme, setTheme] = useState(getTheme());
  return <div style={{ display: 'grid', gap: 14, maxWidth: 760 }}>
    <div className="card"><div className="card-head"><h2>Account</h2></div>
      <Form submitLabel="Save changes" disabled={user?.role !== 'admin'} onSubmit={async () => { await api.patch('/settings', { account_code: code, account_name: name }); await refresh(); qc.invalidateQueries(); toast('Saved'); }}>
        <div className="form-row"><Field label="Account ID" hint="Shown at the start of every breadcrumb"><input value={code} onChange={(e) => setCode(e.target.value)} disabled={user?.role !== 'admin'} /></Field><Field label="Organisation name"><input value={name} onChange={(e) => setName(e.target.value)} disabled={user?.role !== 'admin'} /></Field></div></Form></div>
    <div className="card"><div className="card-head"><h2>Appearance</h2></div>
      <div className="seg"><button className={theme === 'light' ? 'active' : ''} onClick={() => { applyTheme('light'); setTheme('light'); }}>Light</button><button className={theme === 'dark' ? 'active' : ''} onClick={() => { applyTheme('dark'); setTheme('dark'); }}>Dark</button></div>
      <p className="muted small" style={{ marginTop: 8 }}>Keyboard: <kbd>Ctrl K</kbd> search · <kbd>Ctrl B</kbd> toggle menu · in editors <kbd>Ctrl H</kbd> toggle panels, <kbd>Esc</kbd> cancel drawing, <kbd>Backspace</kbd> delete selected connection.</p></div>
    <div className="card"><div className="card-head"><h2>Change password</h2></div>
      <Form submitLabel="Change password" onSubmit={async () => { await api.patch('/auth/password', { current: cur, next }); setCur(''); setNext(''); toast('Password changed'); }}>
        <div className="form-row"><Field label="Current password"><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} required /></Field><Field label="New password" hint="At least 8 characters"><input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} /></Field></div></Form></div>
    <div className="card"><div className="card-head"><h2>Changelog</h2></div>
      <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}><li><b>v2</b> — Map View, Location View with floor plans and rooms, building and user connections with end-to-end overview, WLANs, Resources, device library with prefixes and templates, exports.</li><li><b>v1</b> — Sites, racks, rack editor, connections, VLANs, activity log.</li></ul></div>
  </div>;
}
