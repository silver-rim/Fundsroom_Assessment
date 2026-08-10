/**
 * Route table.
 *
 * Phase 1 has a single screen. Later phases add the auth routes, the
 * ProtectedRoute / RoleRoute wrappers and the AppLayout shell around the
 * module pages; the router lives here throughout.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import SystemStatusPage from './pages/SystemStatus/SystemStatusPage';

export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/status" element={<SystemStatusPage />} />
      <Route path="/" element={<Navigate to="/status" replace />} />
      <Route path="*" element={<Navigate to="/status" replace />} />
    </Routes>
  );
}
