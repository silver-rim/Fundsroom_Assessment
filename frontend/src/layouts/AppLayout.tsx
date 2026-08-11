/**
 * Authenticated application shell: sidebar navigation, top bar, content outlet.
 *
 * Two things are role-aware here, and both are courtesies rather than controls —
 * the API enforces the same rules independently:
 *
 *   - a nav link is rendered only if the signed-in role can use the screen;
 *   - the sections group the modules the way the business does, so Sales and
 *     Warehouse each find their own work in one place.
 *
 * The top bar shows where the user actually is. A single static "Operations
 * Portal" told them nothing they could not already see in the sidebar.
 */
import { NavLink, Outlet, useLocation } from 'react-router-dom';
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

interface NavSection {
  /** Omitted on the first group — a heading above a single "Dashboard" link is noise. */
  title?: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    items: [{ to: '/', label: 'Dashboard' }],
  },
  {
    title: 'Sales',
    items: [
      { to: '/customers', label: 'Customers' },
      { to: '/challans', label: 'Sales challans' },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { to: '/products', label: 'Products' },
      { to: '/inventory', label: 'Stock ledger' },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/users', label: 'Users', allow: ['ADMIN'] },
      { to: '/status', label: 'System status' },
    ],
  },
];

/**
 * Page titles for the top bar, most specific pattern first — the first match
 * wins, so `/customers/new` never falls through to the list's title.
 */
const PAGE_TITLES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/$/, 'Dashboard'],
  [/^\/customers\/new$/, 'New customer'],
  [/^\/customers\/\d+\/edit$/, 'Edit customer'],
  [/^\/customers\/\d+$/, 'Customer'],
  [/^\/customers$/, 'Customers'],
  [/^\/products\/new$/, 'New product'],
  [/^\/products\/\d+\/edit$/, 'Edit product'],
  [/^\/products\/\d+$/, 'Product'],
  [/^\/products$/, 'Products'],
  [/^\/inventory$/, 'Stock ledger'],
  [/^\/challans\/new$/, 'New challan'],
  [/^\/challans\/\d+\/edit$/, 'Edit challan'],
  [/^\/challans\/\d+$/, 'Challan'],
  [/^\/challans$/, 'Sales challans'],
  [/^\/users$/, 'Users'],
  [/^\/status$/, 'System status'],
  [/^\/forbidden$/, 'Access denied'],
];

function titleFor(pathname: string): string {
  return PAGE_TITLES.find(([pattern]) => pattern.test(pathname))?.[1] ?? 'Not found';
}

export default function AppLayout(): JSX.Element {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();

  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => !item.allow || (user && item.allow.includes(user.role)),
    ),
  })).filter((section) => section.items.length > 0);

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandName}>{config.appName}</div>
          <div className={styles.brandTag}>Operations Portal</div>
        </div>

        <nav className={styles.nav} aria-label="Main">
          {visibleSections.map((section, index) => (
            <div className={styles.navGroup} key={section.title ?? `group-${index}`}>
              {section.title && <div className={styles.navSection}>{section.title}</div>}

              {section.items.map((item) => (
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
            </div>
          ))}
        </nav>
      </aside>

      <header className={styles.topbar}>
        <span className={styles.pageTitle}>{titleFor(pathname)}</span>

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
