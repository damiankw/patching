import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { applyTheme, getTheme } from '../lib/theme';
import { usePageHeader } from '../components/Shell';
import { Field, Form, errMsg, useToast } from '../components/ui';

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
    <AiSettings isAdmin={user?.role === 'admin'} />
    <div className="card"><div className="card-head"><h2>Change password</h2></div>
      <Form submitLabel="Change password" onSubmit={async () => { await api.patch('/auth/password', { current: cur, next }); setCur(''); setNext(''); toast('Password changed'); }}>
        <div className="form-row"><Field label="Current password"><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} required /></Field><Field label="New password" hint="At least 8 characters"><input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} /></Field></div></Form></div>
    <div className="card"><div className="card-head"><h2>Changelog</h2></div>
      <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}><li><b>v2</b> — Map View, Location View with floor plans and rooms, building and user connections with end-to-end overview, WLANs, Resources, device library with prefixes and templates, exports.</li><li><b>v1</b> — Sites, racks, rack editor, connections, VLANs, activity log.</li></ul></div>
  </div>;
}

interface AiSettingsData { provider: 'openrouter' | 'anthropic'; effort: string; keySource: string; defaults: Record<string, string>; openrouter: { model: string; key_masked: string; key_saved: boolean }; anthropic: { model: string; key_masked: string; key_saved: boolean } }
function AiSettings({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient(); const toast = useToast();
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => api.get<{ enabled: boolean; model: string; provider: string }>('/ai/status') });
  const q = useQuery({ queryKey: ['ai-settings'], queryFn: () => api.get<AiSettingsData>('/ai/settings'), enabled: isAdmin });
  const [provider, setProvider] = useState<'openrouter' | 'anthropic'>('openrouter'); const [model, setModel] = useState(''); const [key, setKey] = useState(''); const [effort, setEffort] = useState('medium');
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null); const [testing, setTesting] = useState(false);
  useEffect(() => { if (q.data) { setProvider(q.data.provider); setModel(q.data[q.data.provider].model); setEffort(q.data.effort); setKey(''); setTest(null); } }, [q.data]);
  const switchProvider = (p: 'openrouter' | 'anthropic') => { setProvider(p); setModel(q.data?.[p].model ?? ''); setKey(''); setTest(null); };
  const d = q.data;
  return <div className="card"><div className="card-head"><h2>AI Assistant</h2>{status.data && <span className={`badge ${status.data.enabled ? 'badge-green' : 'badge-amber'}`}>{status.data.enabled ? `Enabled · ${status.data.provider} · ${status.data.model}` : 'Not configured'}</span>}</div>
    {!isAdmin && <p className="muted small">An admin configures the assistant here.</p>}
    {isAdmin && d && <Form submitLabel="Save" onSubmit={async () => {
      const body: Record<string, unknown> = { provider, effort, [`${provider}_model`]: model }; if (key.trim()) body[`${provider}_key`] = key.trim();
      await api.patch('/ai/settings', body); setKey(''); await Promise.all([qc.invalidateQueries({ queryKey: ['ai-settings'] }), qc.invalidateQueries({ queryKey: ['ai-status'] })]); toast('AI settings saved');
    }}>
      <Field label="Provider"><div className="seg"><button type="button" className={provider === 'openrouter' ? 'active' : ''} onClick={() => switchProvider('openrouter')}>OpenRouter</button><button type="button" className={provider === 'anthropic' ? 'active' : ''} onClick={() => switchProvider('anthropic')}>Anthropic API</button></div></Field>
      <div className="form-row">
        <Field label="API key" hint={d[provider].key_masked ? `Saved: ${d[provider].key_masked}${d[provider].key_saved ? '' : ' (from environment)'}. Leave blank to keep it.` : 'Paste the key here; it is stored in the Rackdocs database.'}><input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={provider === 'openrouter' ? 'sk-or-…' : 'sk-ant-…'} autoComplete="off" /></Field>
        <Field label="Model" hint={provider === 'openrouter' ? 'Any id from openrouter.ai/models that supports tool calling' : 'e.g. claude-opus-5-5, claude-sonnet-5-5'}><input value={model} onChange={(e) => setModel(e.target.value)} placeholder={d.defaults[provider]} className="code" /></Field>
      </div>
      {provider === 'anthropic' && <Field label="Reasoning effort"><select value={effort} onChange={(e) => setEffort(e.target.value)} style={{ maxWidth: 200 }}>{['low', 'medium', 'high', 'xhigh', 'max'].map((x) => <option key={x}>{x}</option>)}</select></Field>}
      <div className="btn-row"><button type="button" className="btn" disabled={testing} onClick={async () => { setTesting(true); setTest(null); try { setTest(await api.post<{ ok: boolean; message: string }>('/ai/test')); } catch (e) { setTest({ ok: false, message: errMsg(e) }); } finally { setTesting(false); } }}>{testing ? 'Testing…' : 'Test connection'}</button>{test && <span className={`badge ${test.ok ? 'badge-green' : 'badge-red'}`}>{test.message}</span>}<span className="muted tiny">Test uses the saved settings, so save first.</span></div>
      <p className="muted small" style={{ margin: 0 }}>Uploaded documents are sent to the provider for the duration of a conversation. Every change the assistant makes runs through the same validation as manual edits and is logged under the user's name. Prefer your own Claude Code? Run <code>npm run mcp</code> and point it at this server (see README).</p>
    </Form>}
  </div>;
}
