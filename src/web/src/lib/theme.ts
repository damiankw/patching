export type Theme = 'light' | 'dark';
export function getTheme(): Theme { try { return (localStorage.getItem('rd-theme') as Theme) || 'light'; } catch { return 'light'; } }
export function applyTheme(t: Theme) { document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('rd-theme', t); } catch { /* ignore */ } }
export function toggleTheme() { const t = getTheme() === 'dark' ? 'light' : 'dark'; applyTheme(t); return t; }
