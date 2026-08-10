/**
 * Route table.
 *
 * Structure:
 *   /login                     public
 *   ProtectedRoute             requires any authenticated user
 *     └─ AppLayout             sidebar + topbar shell
 *          ├─ /                home
 *          ├─ /status          system status
 *          ├─ /forbidden       shown when RoleRoute blocks a screen
 *          └─ RoleRoute        requires a specific role
 *               └─ /users      Admin only
 *
 * Module routes (customers, products, inventory, challans) are added inside
 * AppLayout from Phase 3 onwards.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute, RoleRoute } from './routes/ProtectedRoute';
import AppLayout from './layouts/AppLayout';
import LoginPage from './pages/Login/LoginPage';
import HomePage from './pages/Home/HomePage';
import UsersPage from './pages/Users/UsersPage';
import ForbiddenPage from './pages/Forbidden/ForbiddenPage';
import SystemStatusPage from './pages/SystemStatus/SystemStatusPage';
import CustomersListPage from './pages/Customers/CustomersListPage';
import CustomerDetailPage from './pages/Customers/CustomerDetailPage';
import CustomerFormPage from './pages/Customers/CustomerFormPage';

export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/status" element={<SystemStatusPage />} />
          <Route path="/forbidden" element={<ForbiddenPage />} />

          {/* Customers — every role may read; the write screens are guarded
              below and the API enforces the same rules independently. */}
          <Route path="/customers" element={<CustomersListPage />} />
          <Route path="/customers/:id" element={<CustomerDetailPage />} />

          <Route element={<RoleRoute allow={['ADMIN', 'SALES']} />}>
            <Route path="/customers/new" element={<CustomerFormPage />} />
            <Route path="/customers/:id/edit" element={<CustomerFormPage />} />
          </Route>

          <Route element={<RoleRoute allow={['ADMIN']} />}>
            <Route path="/users" element={<UsersPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
