import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Shell } from './components/Shell';
import { Loading } from './components/ui';
import { Setup } from './pages/Setup';
import { Login } from './pages/Login';
import { Locations } from './pages/Locations';
import { LocationView } from './pages/LocationView';
import { RackEditor } from './pages/RackEditor';
import { Racks } from './pages/Racks';
import { Networks } from './pages/Networks';
import { Resources } from './pages/Resources';
import { Activity } from './pages/Activity';
import { DeviceLibrary } from './pages/DeviceLibrary';
import { Users } from './pages/Users';
import { Settings } from './pages/Settings';
import { Report } from './pages/Report';

export function App() {
  const { user, loading, needsSetup } = useAuth(); const loc = useLocation();
  if (loading) return <Loading />;
  if (needsSetup) return <Routes><Route path="*" element={<Setup />} /></Routes>;
  if (!user) return <Routes><Route path="/login" element={<Login />} /><Route path="*" element={<Navigate to="/login" replace state={{ from: loc.pathname }} />} /></Routes>;
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/locations" replace />} />
      <Route path="/report/:kind/:id" element={<Report />} />
      <Route element={<Shell />}>
        <Route path="/" element={<Navigate to="/locations" replace />} />
        <Route path="/locations" element={<Locations />} />
        <Route path="/locations/:id" element={<LocationView />} />
        <Route path="/floors/:floorId" element={<LocationView />} />
        <Route path="/racks" element={<Racks />} />
        <Route path="/racks/:id" element={<RackEditor />} />
        <Route path="/networks/:tab" element={<Networks />} />
        <Route path="/networks" element={<Navigate to="/networks/vlans" replace />} />
        <Route path="/resources" element={<Resources />} />
        <Route path="/resources/:tab" element={<Resources />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/library" element={<DeviceLibrary />} />
        <Route path="/library/:tab" element={<DeviceLibrary />} />
        <Route path="/users" element={user.role === 'admin' ? <Users /> : <Navigate to="/locations" replace />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/locations" replace />} />
      </Route>
    </Routes>
  );
}
