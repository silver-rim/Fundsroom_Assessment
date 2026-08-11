/**
 * Route table.
 *
 * Structure:
 *   /login                     public
 *   ProtectedRoute             requires any authenticated user
 *     └─ AppLayout             sidebar + topbar shell
 *          ├─ /                dashboard
 *          ├─ module screens   customers, products, inventory, challans
 *          ├─ /status          system status
 *          ├─ /forbidden       shown when RoleRoute blocks a screen
 *          ├─ RoleRoute        requires a specific role
 *          │    └─ /users      Admin only
 *          └─ *                404, framed by the shell
 *
 * The catch-all sits INSIDE the guard on purpose: a signed-out visitor
 * following a stale link is sent to /login and returned to it afterwards,
 * while a signed-in one gets a real 404 instead of a silent bounce home.
 */
import { Route, Routes } from 'react-router-dom';
import { ProtectedRoute, RoleRoute } from './routes/ProtectedRoute';
import AppLayout from './layouts/AppLayout';
import LoginPage from './pages/Login/LoginPage';
import DashboardPage from './pages/Dashboard/DashboardPage';
import UsersPage from './pages/Users/UsersPage';
import ForbiddenPage from './pages/Forbidden/ForbiddenPage';
import NotFoundPage from './pages/NotFound/NotFoundPage';
import SystemStatusPage from './pages/SystemStatus/SystemStatusPage';
import CustomersListPage from './pages/Customers/CustomersListPage';
import CustomerDetailPage from './pages/Customers/CustomerDetailPage';
import CustomerFormPage from './pages/Customers/CustomerFormPage';
import ProductsListPage from './pages/Products/ProductsListPage';
import ProductDetailPage from './pages/Products/ProductDetailPage';
import ProductFormPage from './pages/Products/ProductFormPage';
import StockMovementsPage from './pages/Inventory/StockMovementsPage';
import ChallansListPage from './pages/Challans/ChallansListPage';
import ChallanDetailPage from './pages/Challans/ChallanDetailPage';
import ChallanFormPage from './pages/Challans/ChallanFormPage';

export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
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

          {/* Products & inventory — all roles may read; writes are Warehouse/Admin. */}
          <Route path="/products" element={<ProductsListPage />} />
          <Route path="/products/:id" element={<ProductDetailPage />} />
          <Route path="/inventory" element={<StockMovementsPage />} />

          <Route element={<RoleRoute allow={['ADMIN', 'WAREHOUSE']} />}>
            <Route path="/products/new" element={<ProductFormPage />} />
            <Route path="/products/:id/edit" element={<ProductFormPage />} />
          </Route>

          {/* Sales challans — all roles may read; creating and editing a draft
              is Admin/Sales. Confirming is additionally open to Warehouse, and
              that rule lives on the detail page and in the API. */}
          <Route path="/challans" element={<ChallansListPage />} />
          <Route path="/challans/:id" element={<ChallanDetailPage />} />

          <Route element={<RoleRoute allow={['ADMIN', 'SALES']} />}>
            <Route path="/challans/new" element={<ChallanFormPage />} />
            <Route path="/challans/:id/edit" element={<ChallanFormPage />} />
          </Route>

          <Route element={<RoleRoute allow={['ADMIN']} />}>
            <Route path="/users" element={<UsersPage />} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
