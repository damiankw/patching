import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

// ---------- Toasts ----------
interface Toast { id: number; text: string; kind: 'error' | 'ok' }
const ToastCtx = createContext<(text: string, kind?: 'error' | 'ok') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: 'error' | 'ok' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>)}</div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
export function errMsg(e: unknown) { return e instanceof Error ? e.message : String(e); }

// ---------- Dialog ----------
export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`dialog${wide ? ' dialog-wide' : ''}`} onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <div className="dialog-body">
          <div className="dialog-head"><h2>{title}</h2><button className="btn btn-ghost" onClick={onClose} aria-label="Close">✕</button></div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function Form({ onSubmit, children, submitLabel = 'Save', busy, onCancel, danger }: { onSubmit: () => Promise<void> | void; children: ReactNode; submitLabel?: string; busy?: boolean; onCancel?: () => void; danger?: boolean }) {
  const [err, setErr] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const handle = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setWorking(true);
    try { await onSubmit(); } catch (ex) { setErr(errMsg(ex)); } finally { setWorking(false); }
  };
  return (
    <form onSubmit={handle} className="form">
      {children}
      {err && <div className="error-box">{err}</div>}
      <div className="form-actions">
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
        <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy || working}>{working ? '…' : submitLabel}</button>
      </div>
    </form>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}

export function Confirm({ open, onClose, onConfirm, title, text }: { open: boolean; onClose: () => void; onConfirm: () => Promise<void> | void; title: string; text: string }) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <Form onSubmit={async () => { await onConfirm(); onClose(); }} submitLabel="Delete" danger onCancel={onClose}>
        <p>{text}</p>
      </Form>
    </Dialog>
  );
}

export function Empty({ text, children }: { text: string; children?: ReactNode }) {
  return <div className="empty"><p>{text}</p>{children}</div>;
}
export function Loading() { return <div className="loading">Loading…</div>; }
export function ErrorBox({ error }: { error: unknown }) { return <div className="error-box">{errMsg(error)}</div>; }

export function Badge({ children, color }: { children: ReactNode; color?: string }) {
  return <span className="badge" style={color ? { background: color, color: '#fff', borderColor: color } : undefined}>{children}</span>;
}
