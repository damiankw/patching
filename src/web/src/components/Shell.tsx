import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { MapPin, Server, Globe, ListTree, History, Library, Users, Settings, Search, Menu as MenuIcon, BookOpen, ChevronsUpDown, ChevronRight, ChevronDown, Sun, Moon, LogOut, Bell, LifeBuoy, PanelLeftClose } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { getTheme, toggleTheme } from '../lib/theme';
import { CommandPalette } from './CommandPalette';
import { Menu } from './ui';

export interface Crumb { label: ReactNode; to?: string }
interface PageHeaderState { title: ReactNode; crumbs: Crumb[]; actions?: ReactNode; full?: boolean }
const PageCtx = createContext<{ set: (s: PageHeaderState) => void }>({ set: () => {} });
/** Pages describe their header; the shell renders it. */
export function usePageHeader(state: PageHeaderState, deps: unknown[] = []) {
  const { set } = useContext(PageCtx);
  useEffect(() => { set(state); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

export function Shell() {
  const { user, logout } = useAuth(); const nav = useNavigate();
  const [menuOpen, setMenuOpen] = useState(() => { try { return localStorage.getItem('rd-menu') !== 'closed'; } catch { return true; } });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [header, setHeader] = useState<PageHeaderState>({ title: '', crumbs: [] });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [theme, setTheme] = useState(getTheme());
  const [netOpen, setNetOpen] = useState(true);
  useEffect(() => { try { localStorage.setItem('rd-menu', menuOpen ? 'open' : 'closed'); } catch { /* ignore */ } }, [menuOpen]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen((o) => !o); }
      if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); setMenuOpen((o) => !o); }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, []);
  const link = (to: string, label: string, Icon: typeof MapPin, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} onClick={() => setMobileOpen(false)}><Icon size={16} /><span>{label}</span></NavLink>
  );
  const acct = user?.account_code ?? 'ACC';
  return (
    <PageCtx.Provider value={{ set: setHeader }}>
      <div className={`shell${menuOpen ? '' : ' menu-collapsed'}${mobileOpen ? ' mobile-open' : ''}`}>
        <aside className="mainmenu">
          <div className="acct-box"><div className="acct-logo">{acct.slice(0, 2)}</div><div className="acct-text"><div className="acct-name">{user?.account_name}</div><div className="acct-code muted">{acct}</div></div><ChevronsUpDown size={14} className="muted" /></div>
          <button className="menu-search" onClick={() => setPaletteOpen(true)}><Search size={14} /><span>Search</span><kbd>Ctrl K</kbd></button>
          <nav className="nav-group">
            {link('/locations', 'Locations', MapPin)}
            {link('/racks', 'Racks', Server)}
            <div className={`nav-link nav-parent`} onClick={() => setNetOpen(!netOpen)}><Globe size={16} /><span>Networks</span>{netOpen ? <ChevronDown size={14} className="nav-chev" /> : <ChevronRight size={14} className="nav-chev" />}</div>
            {netOpen && <div className="nav-sub">{link('/networks/vlans', 'VLAN', Globe)}{link('/networks/wlans', 'WLAN', Globe)}</div>}
            {link('/resources', 'Resources', ListTree)}
            {link('/activity', 'Activity Log', History)}
          </nav>
          <nav className="nav-group">
            {link('/library', 'Device Library', Library)}
            {user?.role === 'admin' && link('/users', 'Users & Permissions', Users)}
            {link('/settings', 'Settings', Settings)}
          </nav>
          <div className="grow" />
          <nav className="nav-group nav-bottom">
            <a className="nav-link small" href="https://github.com/damiankw/patching" target="_blank" rel="noreferrer"><Bell size={14} /><span>Announcements</span></a>
            <a className="nav-link small" href="https://github.com/damiankw/patching/issues" target="_blank" rel="noreferrer"><LifeBuoy size={14} /><span>Get support</span></a>
            <a className="nav-link small" href="https://github.com/damiankw/patching#readme" target="_blank" rel="noreferrer"><BookOpen size={14} /><span>Documentation</span></a>
            <div className="version muted">v2 · <Link to="/settings">Changelog</Link></div>
          </nav>
          <Menu align="left" button={<div className="user-box"><div className="avatar">{user?.name.slice(0, 1)}</div><div className="acct-text"><div className="acct-name">{user?.name}</div><div className="muted small">@ {user?.account_name}</div></div><ChevronsUpDown size={14} className="muted" /></div>}
            items={[{ label: <><span className="mi">{theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}</span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</>, onClick: () => setTheme(toggleTheme()) }, { label: <><span className="mi"><Settings size={14} /></span>Settings</>, onClick: () => nav('/settings') }, { sep: true, label: '' }, { label: <><span className="mi"><LogOut size={14} /></span>Sign out</>, onClick: () => logout().then(() => nav('/login')) }]} />
        </aside>
        <div className="mainarea">
          <header className="pagehead">
            <div className="pagehead-left">
              <button className="icon-btn menu-toggle" onClick={() => { setMenuOpen(!menuOpen); setMobileOpen(!mobileOpen); }} title="Toggle menu (Ctrl+B)">{menuOpen ? <PanelLeftClose size={16} /> : <MenuIcon size={16} />}</button>
              <div><div className="page-title">{header.title}</div>
                <div className="crumbs"><Link to="/locations">{acct}</Link>{header.crumbs.map((c, i) => <span key={i}><ChevronRight size={12} className="crumb-sep" />{c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}</span>)}</div></div>
            </div>
            <div className="pagehead-right">{header.actions}</div>
          </header>
          <main className={`content${header.full ? ' content-full' : ''}`}><Outlet /></main>
        </div>
        {mobileOpen && <div className="backdrop" onClick={() => setMobileOpen(false)} />}
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onToggleTheme={() => setTheme(toggleTheme())} />
    </PageCtx.Provider>
  );
}
