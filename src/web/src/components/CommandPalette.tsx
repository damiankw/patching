import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, X, SunMoon, LifeBuoy, MapPin, ListTree, History, Library, BookOpen } from 'lucide-react';
import { api } from '../lib/api';
import type { SearchHit } from '../lib/types';

export function CommandPalette({ open, onClose, onToggleTheme }: { open: boolean; onClose: () => void; onToggleTheme: () => void }) {
  const [q, setQ] = useState(''); const [idx, setIdx] = useState(0); const nav = useNavigate(); const input = useRef<HTMLInputElement>(null);
  const res = useQuery({ queryKey: ['search', q], queryFn: () => api.get<SearchHit[]>(`/search?q=${encodeURIComponent(q)}`), enabled: open && q.trim().length > 0 });
  useEffect(() => { if (open) { setQ(''); setIdx(0); setTimeout(() => input.current?.focus(), 10); } }, [open]);
  const quick = [
    { label: 'Locations', icon: MapPin, run: () => nav('/locations') }, { label: 'Resources', icon: ListTree, run: () => nav('/resources') },
    { label: 'Activity Log', icon: History, run: () => nav('/activity') }, { label: 'Device Library', icon: Library, run: () => nav('/library') },
    { label: 'Documentation', icon: BookOpen, run: () => window.open('https://github.com/damiankw/patching#readme', '_blank') },
  ];
  const actions = [{ label: 'Toggle theme', icon: SunMoon, run: onToggleTheme }, { label: 'Get support', icon: LifeBuoy, run: () => window.open('https://github.com/damiankw/patching/issues', '_blank') }];
  const items: { label: string; sub?: string; kind?: string; run: () => void; icon?: typeof MapPin }[] = q.trim()
    ? (res.data ?? []).map((h) => ({ label: h.path, sub: [h.name, h.sub].filter(Boolean).join(' · '), kind: h.kind, run: () => nav(h.to) }))
    : [...quick, ...actions];
  const choose = (i: number) => { const it = items[i]; if (it) { it.run(); onClose(); } };
  useEffect(() => { setIdx(0); }, [q, res.data]);
  if (!open) return null;
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input"><Search size={16} className="muted" /><input ref={input} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); } if (e.key === 'Enter') choose(idx); if (e.key === 'Escape') onClose(); }} /><button className="icon-btn" onClick={onClose}><X size={16} /></button></div>
        <div className="palette-list">
          {!q.trim() && <div className="palette-group">Quick Links</div>}
          {items.map((it, i) => <>
            {!q.trim() && i === quick.length && <div key="act" className="palette-group">Actions</div>}
            <div key={i} className={`palette-item${i === idx ? ' active' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => choose(i)}>
              {it.icon && <it.icon size={14} className="muted" />}<span className={it.kind ? 'code' : ''}>{it.label}</span>{it.sub && <span className="muted small">{it.sub}</span>}{it.kind && <span className="badge badge-grey palette-kind">{it.kind}</span>}
            </div></>)}
          {q.trim() && !res.isLoading && items.length === 0 && <div className="muted" style={{ padding: 12 }}>No results.</div>}
        </div>
      </div>
    </div>
  );
}
