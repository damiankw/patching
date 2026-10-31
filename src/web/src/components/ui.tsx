import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { User } from '../lib/types';

// ---------- Toasts ----------
interface Toast { id: number; text: string; kind: 'error' | 'ok' }
const ToastCtx = createContext<(text: string, kind?: 'error' | 'ok') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: 'error' | 'ok' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 2500);
  }, []);
  return <ToastCtx.Provider value={push}>{children}<div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>)}</div></ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);
export function errMsg(e: unknown) { return e instanceof Error ? e.message : String(e); }

// ---------- Dialog ----------
export function Dialog({ open, onClose, title, subtitle, children, wide, extra }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: string; children: ReactNode; wide?: boolean | 'xl'; extra?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  return (
    <dialog ref={ref} className={`dialog${wide === 'xl' ? ' dialog-xl' : wide ? ' dialog-wide' : ''}`} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && <div className="dialog-body">
        <div className="dialog-head"><div><h2>{title}</h2>{subtitle && <div className="muted small">{subtitle}</div>}</div><div className="btn-row">{extra}<button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button></div></div>
        {children}
      </div>}
    </dialog>
  );
}
export function Form({ onSubmit, children, submitLabel = 'Save', onCancel, danger, disabled }: { onSubmit: () => Promise<void> | void; children: ReactNode; submitLabel?: string; onCancel?: () => void; danger?: boolean; disabled?: boolean }) {
  const [err, setErr] = useState<string | null>(null); const [working, setWorking] = useState(false);
  const handle = async (e: FormEvent) => { e.preventDefault(); setErr(null); setWorking(true); try { await onSubmit(); } catch (ex) { setErr(errMsg(ex)); } finally { setWorking(false); } };
  return <form onSubmit={handle} className="form">{children}{err && <div className="error-box">{err}</div>}
    <div className="form-actions">{onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}<button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={working || disabled}>{working ? '…' : submitLabel}</button></div></form>;
}
export function Field({ label, children, hint, inline, required }: { label: ReactNode; children: ReactNode; hint?: ReactNode; inline?: boolean; required?: boolean }) {
  return <label className={`field${inline ? ' field-inline' : ''}`}><span className="field-label">{label}{required && <span className="req"> *</span>}</span><span className="field-control">{children}{hint && <span className="field-hint">{hint}</span>}</span></label>;
}
export function Confirm({ open, onClose, onConfirm, title, text, label = 'Delete' }: { open: boolean; onClose: () => void; onConfirm: () => Promise<void> | void; title: string; text: ReactNode; label?: string }) {
  return <Dialog open={open} onClose={onClose} title={title}><Form onSubmit={async () => { await onConfirm(); onClose(); }} submitLabel={label} danger onCancel={onClose}><div>{text}</div></Form></Dialog>;
}
export function Empty({ text, children }: { text: ReactNode; children?: ReactNode }) { return <div className="empty"><div>{text}</div>{children}</div>; }
export function Loading() { return <div className="loading">Loading…</div>; }
export function ErrorBox({ error }: { error: unknown }) { return <div className="error-box">{errMsg(error)}</div>; }
export function Badge({ children, tone }: { children: ReactNode; tone?: 'blue' | 'green' | 'red' | 'grey' | 'amber' }) { return <span className={`badge badge-${tone ?? 'grey'}`}>{children}</span>; }
export function IconBtn({ children, title, onClick, active, danger, disabled, type = 'button', className = '' }: { children: ReactNode; title: string; onClick?: (e: React.MouseEvent) => void; active?: boolean; danger?: boolean; disabled?: boolean; type?: 'button' | 'submit'; className?: string }) {
  return <button type={type} className={`icon-btn${active ? ' active' : ''}${danger ? ' danger' : ''} ${className}`} title={title} aria-label={title} onClick={onClick} disabled={disabled}>{children}</button>;
}

// ---------- Dropdown menu ----------
export function Menu({ button, items, align = 'right' }: { button: ReactNode; items: { label: ReactNode; onClick?: () => void; href?: string; danger?: boolean; disabled?: boolean; sep?: boolean }[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [open]);
  return <div className="menu" ref={ref}><span onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>{button}</span>
    {open && <div className={`menu-list menu-${align}`}>{items.map((it, i) => it.sep ? <div key={i} className="menu-sep" /> : it.href ? <a key={i} className="menu-item" href={it.href} onClick={() => setOpen(false)}>{it.label}</a> : <button key={i} className={`menu-item${it.danger ? ' danger' : ''}`} disabled={it.disabled} onClick={() => { setOpen(false); it.onClick?.(); }}>{it.label}</button>)}</div>}</div>;
}

// ---------- Collapsible sidebar section ----------
export function Section({ title, children, right, defaultOpen = true }: { title: ReactNode; children: ReactNode; right?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return <div className="section"><div className="section-head" onClick={() => setOpen(!open)}><span>{title}</span><span className="btn-row" onClick={(e) => e.stopPropagation()}>{right}<span className="chev" onClick={() => setOpen(!open)}>{open ? '⌃' : '⌄'}</span></span></div>{open && <div className="section-body">{children}</div>}</div>;
}

// ---------- People select ----------
export function useUsers() { return useQuery({ queryKey: ['users-lite'], queryFn: () => api.get<User[]>('/users/lite'), staleTime: 60000 }); }
export function PersonSelect({ value, onChange, disabled }: { value: number | null; onChange: (v: number | null) => void; disabled?: boolean }) {
  const u = useUsers();
  return <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} disabled={disabled}><option value="">Unassigned</option>{u.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>;
}

/** Debounced autosave text/number inputs used throughout the settings sidebars. */
export function useAutosave<T extends Record<string, unknown>>(initial: T, save: (patch: Partial<T>) => Promise<unknown>, key: unknown) {
  const [values, setValues] = useState<T>(initial);
  const [status, setStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const toast = useToast();
  useEffect(() => { setValues(initial); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof T, v: T[keyof T], immediate = false) => {
    setValues((s) => ({ ...s, [k]: v }));
    clearTimeout(timers.current[k as string]);
    const run = async () => { setStatus('saving'); try { await save({ [k]: v } as Partial<T>); setStatus('saved'); } catch (e) { setStatus('error'); toast(errMsg(e), 'error'); setValues((s) => ({ ...s, [k]: initial[k] })); } };
    if (immediate) void run(); else timers.current[k as string] = setTimeout(run, 600);
  };
  return { values, set, status };
}
export function SaveStatus({ status }: { status: 'saved' | 'saving' | 'error' }) {
  return <span className={`save-status save-${status}`}>{status === 'saved' ? '✓ Saved' : status === 'saving' ? 'Saving…' : 'Not saved'}</span>;
}
export function Tabs({ tabs, value, onChange, pill }: { tabs: { id: string; label: ReactNode }[]; value: string; onChange: (id: string) => void; pill?: boolean }) {
  return <div className={pill ? 'pill-tabs' : 'tabs'}>{tabs.map((t) => <button key={t.id} className={value === t.id ? 'active' : ''} onClick={() => onChange(t.id)}>{t.label}</button>)}</div>;
}
