import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Plus, Paperclip, Send, Trash2, Wrench, Check, X, FileText } from 'lucide-react';
import { api, fmtDate } from '../lib/api';
import { useCanEdit } from '../lib/auth';
import { usePageHeader } from '../components/Shell';
import { Confirm, IconBtn, Loading, errMsg, useToast } from '../components/ui';

type Ev = { type: 'user'; text: string; attachments?: { name: string; mime: string; size: number }[] } | { type: 'assistant'; text: string } | { type: 'text'; text: string } | { type: 'tool_start'; name: string; input: unknown } | { type: 'tool_result'; name: string; ok: boolean; result: string } | { type: 'done'; usage: { input: number; output: number; cached: number } | null; model: string } | { type: 'error'; message: string };
interface Convo { id: number; title: string; created_at: string; updated_at: string }
interface Att { name: string; mime: string; data: string; size: number }

const SUGGESTIONS = ['Set up a location called HQ with floors G and 1, a comms room MDF on G, and a 42U rack in it with a 48-port patch panel and two 48-port switches.', 'Here is my cabling spreadsheet. Create the outlets, panels and building connections it describes.', 'What is connected to switch SW01 in RK01, port by port?', 'Create VLANs 10 Servers, 20 Users, 30 Voice and put ports 1-8 of SW01 in VLAN 10.'];

export function Assistant() {
  const qc = useQueryClient(); const toast = useToast(); const canEdit = useCanEdit();
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => api.get<{ enabled: boolean; model: string; provider: string }>('/ai/status') });
  const convos = useQuery({ queryKey: ['ai-convos'], queryFn: () => api.get<Convo[]>('/ai/conversations') });
  const [current, setCurrent] = useState<number | null>(null);
  const [events, setEvents] = useState<Ev[]>([]); const [text, setText] = useState(''); const [atts, setAtts] = useState<Att[]>([]); const [busy, setBusy] = useState(false); const [del, setDel] = useState<Convo | null>(null);
  const bottom = useRef<HTMLDivElement>(null); const abort = useRef<AbortController | null>(null);
  usePageHeader({ title: 'AI Assistant', crumbs: [{ label: 'AI Assistant' }], actions: canEdit ? <button className="btn btn-primary" onClick={() => newConvo()}><Plus size={15} /> New conversation</button> : undefined, full: true }, [canEdit]);
  useEffect(() => { if (current === null && convos.data?.length) load(convos.data[0].id); }, [convos.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [events]);
  const load = async (id: number) => { const c = await api.get<{ transcript: Ev[] }>(`/ai/conversations/${id}`); setCurrent(id); setEvents(c.transcript); };
  const newConvo = async () => { const c = await api.post<Convo>('/ai/conversations'); await qc.invalidateQueries({ queryKey: ['ai-convos'] }); setCurrent(c.id); setEvents([]); };
  const addFiles = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (f.size > 20 * 1024 * 1024) { toast(`${f.name} is larger than 20 MB`, 'error'); continue; }
      const mime = f.type || (f.name.endsWith('.csv') ? 'text/csv' : f.name.endsWith('.md') ? 'text/markdown' : 'text/plain');
      if (/(docx|xlsx|pptx)$/i.test(f.name)) { toast(`${f.name}: export it as PDF or CSV first; Office files are not read directly`, 'error'); continue; }
      const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });
      setAtts((a) => [...a, { name: f.name, mime, data, size: f.size }]);
    }
  };
  const sendMsg = async (override?: string) => {
    const t = (override ?? text).trim(); if (!t && atts.length === 0) return;
    let id = current; if (id === null) { const c = await api.post<Convo>('/ai/conversations'); id = c.id; setCurrent(id); qc.invalidateQueries({ queryKey: ['ai-convos'] }); }
    setBusy(true); setText(''); const sendAtts = atts; setAtts([]);
    setEvents((e) => [...e, { type: 'user', text: t, attachments: sendAtts.map((a) => ({ name: a.name, mime: a.mime, size: a.size })) }]);
    abort.current = new AbortController();
    try {
      const res = await fetch(`/api/ai/conversations/${id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t, attachments: sendAtts.map(({ name, mime, data }) => ({ name, mime, data })) }), signal: abort.current.signal });
      if (!res.ok || !res.body) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx; while ((idx = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2); const line = chunk.split('\n').find((l) => l.startsWith('data: ')); if (!line) continue; const ev = JSON.parse(line.slice(6)) as Ev;
          if (ev.type === 'user') continue;
          setEvents((e) => { if (ev.type === 'text') { const last = e[e.length - 1]; if (last && last.type === 'text') return [...e.slice(0, -1), { type: 'text', text: last.text + ev.text }]; return [...e, ev]; } if (ev.type === 'assistant') { const last = e[e.length - 1]; if (last && last.type === 'text') return [...e.slice(0, -1), ev]; return [...e, ev]; } return [...e, ev]; }); }
      }
      qc.invalidateQueries();
    } catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) setEvents((ev) => [...ev, { type: 'error', message: errMsg(e) }]); }
    finally { setBusy(false); abort.current = null; qc.invalidateQueries({ queryKey: ['ai-convos'] }); }
  };
  if (status.isLoading) return <Loading />;
  return <div className="ai-page">
    <aside className="ai-list">
      <div className="ai-list-head"><Sparkles size={14} /> Conversations</div>
      {convos.data?.map((c) => <div key={c.id} className={`ai-convo${c.id === current ? ' active' : ''}`} onClick={() => load(c.id)}><div className="ai-convo-title">{c.title}</div><div className="muted tiny">{fmtDate(c.updated_at)}</div><IconBtn title="Delete" onClick={(e) => { e.stopPropagation(); setDel(c); }}><Trash2 size={12} /></IconBtn></div>)}
      {convos.data?.length === 0 && <div className="muted small" style={{ padding: 10 }}>No conversations yet.</div>}
    </aside>
    <div className="ai-main">
      {!status.data?.enabled && <div className="ai-banner">The assistant is not configured yet. An admin can add an OpenRouter or Anthropic API key and pick a model on the <Link to="/settings">Settings</Link> page.</div>}
      <div className="ai-messages">
        {events.length === 0 && <div className="ai-empty"><Sparkles size={28} className="muted" /><h2>What would you like to document?</h2><p className="muted">Describe your network in plain language or attach exports, PDFs, notes and rack photos. The assistant reads them and builds locations, racks, devices, cabling and VLANs through the same checks you use, and logs every change in the Activity Log.</p>
          {canEdit && <div className="ai-suggestions">{SUGGESTIONS.map((s) => <button key={s} className="ai-chip" onClick={() => sendMsg(s)}>{s}</button>)}</div>}</div>}
        {events.map((ev, i) => {
          if (ev.type === 'user') return <div key={i} className="ai-msg ai-user"><div className="ai-bubble">{ev.text}{ev.attachments?.length ? <div className="ai-atts">{ev.attachments.map((a, k) => <span key={k} className="badge"><FileText size={11} /> {a.name}</span>)}</div> : null}</div></div>;
          if (ev.type === 'text' || ev.type === 'assistant') return <div key={i} className="ai-msg ai-assistant"><div className="ai-avatar"><Sparkles size={13} /></div><div className="ai-bubble ai-md">{ev.text}</div></div>;
          if (ev.type === 'tool_start') return <div key={i} className="ai-tool"><Wrench size={12} /><span className="code">{ev.name}</span><span className="muted tiny">{summarise(ev.input)}</span></div>;
          if (ev.type === 'tool_result') return <div key={i} className={`ai-tool ai-tool-result${ev.ok ? '' : ' err'}`}>{ev.ok ? <Check size={12} /> : <X size={12} />}<span className="tiny">{ev.result}</span></div>;
          if (ev.type === 'error') return <div key={i} className="error-box" style={{ margin: '6px 0' }}>{ev.message}</div>;
          if (ev.type === 'done') return <div key={i} className="muted tiny" style={{ textAlign: 'right' }}>{ev.model}{ev.usage ? ` · ${ev.usage.input.toLocaleString()} in (${ev.usage.cached.toLocaleString()} cached) · ${ev.usage.output.toLocaleString()} out` : ''}</div>;
          return null;
        })}
        {busy && <div className="muted small" style={{ padding: '4px 44px' }}>Working…</div>}
        <div ref={bottom} />
      </div>
      {canEdit && <div className="ai-composer" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
        {atts.length > 0 && <div className="ai-atts">{atts.map((a, k) => <span key={k} className="badge"><FileText size={11} /> {a.name} <span className="muted">{Math.round(a.size / 1024)} KB</span><button className="btn-link" onClick={() => setAtts(atts.filter((_, i) => i !== k))}><X size={11} /></button></span>)}</div>}
        <div className="ai-row">
          <label className="icon-btn bordered" title="Attach files (PDF, images, CSV, text)"><Paperclip size={15} /><input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.csv,.txt,.md,.json,.tsv,.log" style={{ display: 'none' }} onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} /></label>
          <textarea rows={2} placeholder="Describe what to document, or attach your existing documentation…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!busy) sendMsg(); } }} disabled={busy || !status.data?.enabled} />
          {busy ? <button className="btn" onClick={() => abort.current?.abort()}>Stop</button> : <button className="btn btn-primary" onClick={() => sendMsg()} disabled={!status.data?.enabled}><Send size={14} /> Send</button>}
        </div>
        <div className="muted tiny">Enter to send, Shift+Enter for a new line. Changes are made as you, through the normal validation, and appear in the Activity Log.</div>
      </div>}
    </div>
    <Confirm open={!!del} onClose={() => setDel(null)} title="Delete conversation" text={`Delete "${del?.title}"? Changes already made to the documentation stay.`} onConfirm={async () => { await api.del(`/ai/conversations/${del!.id}`); if (current === del!.id) { setCurrent(null); setEvents([]); } qc.invalidateQueries({ queryKey: ['ai-convos'] }); }} />
  </div>;
}
function summarise(input: unknown) { try { const s = JSON.stringify(input); return s.length > 120 ? s.slice(0, 118) + '…' : s === '{}' ? '' : s; } catch { return ''; } }
