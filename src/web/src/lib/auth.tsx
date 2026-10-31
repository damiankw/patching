import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import type { User } from './types';

interface AuthState { user: User | null; loading: boolean; needsSetup: boolean; refresh: () => Promise<void>; logout: () => Promise<void> }
const Ctx = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null); const [needsSetup, setNeedsSetup] = useState(false); const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try { const st = await api.get<{ needsSetup: boolean }>('/setup/status'); setNeedsSetup(st.needsSetup); if (st.needsSetup) { setUser(null); return; } setUser(await api.get<User>('/auth/me')); }
    catch (e) { if (e instanceof ApiError && e.status === 401) setUser(null); else throw e; } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh().catch(() => setLoading(false)); }, [refresh]);
  const logout = useCallback(async () => { await api.post('/auth/logout'); setUser(null); }, []);
  return <Ctx.Provider value={{ user, loading, needsSetup, refresh, logout }}>{children}</Ctx.Provider>;
}
export function useAuth() { const v = useContext(Ctx); if (!v) throw new Error('useAuth outside provider'); return v; }
export function useCanEdit() { const { user } = useAuth(); return user?.role === 'admin' || user?.role === 'editor'; }
