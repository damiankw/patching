import { useState, type FormEvent } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const search = (e: FormEvent) => { e.preventDefault(); if (q.trim()) { nav(`/search?q=${encodeURIComponent(q.trim())}`); setOpen(false); } };
  const link = (to: string, label: string, icon: string) => (
    <NavLink to={to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} onClick={() => setOpen(false)}>
      <span className="nav-icon" aria-hidden>{icon}</span>{label}
    </NavLink>
  );
  return (
    <div className="shell">
      <header className="topbar">
        <button className="btn btn-ghost menu-btn" onClick={() => setOpen(!open)} aria-label="Menu">☰</button>
        <NavLink to="/" className="brand">Rackdocs</NavLink>
        <form className="search" onSubmit={search}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sites, racks, devices, serials, IPs…" aria-label="Search" />
        </form>
        <div className="topbar-user">
          <span className="muted">{user?.name} · {user?.role}</span>
          <button className="btn btn-ghost" onClick={() => logout().then(() => nav('/login'))}>Sign out</button>
        </div>
      </header>
      <div className="body">
        <nav className={`sidebar${open ? ' open' : ''}`}>
          {link('/', 'Sites', '▦')}
          {link('/racks', 'Racks', '▤')}
          {link('/connections', 'Connections', '⇄')}
          {link('/device-types', 'Device library', '▣')}
          {link('/activity', 'Activity', '≡')}
          {user?.role === 'admin' && link('/users', 'Users', '☺')}
          <div className="sidebar-section">Export CSV</div>
          {['racks', 'devices', 'ports', 'connections', 'vlans'].map((w) => (
            <a key={w} className="nav-link nav-sub" href={`/api/export/${w}.csv`}>{w}</a>
          ))}
        </nav>
        <main className="content"><Outlet /></main>
      </div>
    </div>
  );
}
