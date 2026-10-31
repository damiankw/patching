import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { Setup } from './pages/Setup';
import { Login } from './pages/Login';
import { Sites } from './pages/Sites';
import { SiteDetail } from './pages/SiteDetail';
import { Racks } from './pages/Racks';
import { RackEditor } from './pages/RackEditor';
import { DeviceTypes } from './pages/DeviceTypes';
import { Connections } from './pages/Connections';
import { Activity } from './pages/Activity';
import { Users } from './pages/Users';
import { Search } from './pages/Search';

export function App() {
  const { user, loading, needsSetup } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (needsSetup) return <Routes><Route path="*" element={<Setup />} /></Routes>;
  if (!user) return <Routes><Route path="/login" element={<Login />} /><Route path="*" element={<Navigate to="/login" replace state={{ from: loc.pathname }} />} /></Routes>;
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Sites />} />
        <Route path="/sites/:id" element={<SiteDetail />} />
        <Route path="/racks" element={<Racks />} />
        <Route path="/racks/:id" element={<RackEditor />} />
        <Route path="/device-types" element={<DeviceTypes />} />
        <Route path="/connections" element={<Connections />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/users" element={user.role === 'admin' ? <Users /> : <Navigate to="/" replace />} />
        <Route path="/search" element={<Search />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
