/**
 * Authenticated application shell: sidebar navigation, top bar, content outlet.
 *
 * Navigation is role-aware — a link is only rendered if the signed-in role can
 * actually use the screen behind it. Phase 6 fills in the remaining modules and
 * the page title; the structure is established here so every screen added from
 * Phase 3 onwards lands in a consistent frame.
 */
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { config } from '../config/env';
import { ROLE_LABELS, type Role } from '../types/auth';
import styles from './AppLayout.module.css';

interface NavItem {
  to: string;
  label: string;
  /** Omitted means every authenticated role may see it. */
  allow?: readonly Role[];
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Home' },
  { to: '/customers', label: 'Customers' },
  { to: '/users', label: 'Users', allow: ['ADMIN'] },
  { to: '/status', label: 'System status' },
];

/** Modules that do not exist yet, shown greyed out so the plan is visible. */
const UPCOMING = ['Products', 'Inventory', 'Sales challans'];

export default function AppLayout(): JSX.Element {
  const { user, logout } = useAuth();

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.allow || (user && item.allow.includes(user.role)),
  );

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandName}>{config.appName}</div>
          <div className={styles.brandTag}>Operations Portal</div>
        </div>

        <nav className={styles.nav}>
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
              }
            >
              {item.label}
            </NavLink>
          ))}

          <div className={styles.navSection}>Coming in later phases</div>
          {UPCOMING.map((label) => (
            <span key={label} className={styles.navPending}>
              {label}
            </span>
          ))}
        </nav>
      </aside>

      <header className={styles.topbar}>
        <span className={styles.pageTitle}>Operations Portal</span>

        <div className={styles.userArea}>
          <div className={styles.userInfo}>
            <div className={styles.userName}>{user?.name}</div>
            <div className={styles.userRole}>{user ? ROLE_LABELS[user.role] : ''}</div>
          </div>
          <button type="button" className={styles.logout} onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}
