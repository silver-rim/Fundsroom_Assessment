/**
 * Authenticated landing page.
 *
 * Confirms who is signed in and what that role is allowed to do. Phase 6
 * replaces this with the real dashboard (live counters, low stock, recent
 * challans) once the modules behind those numbers exist.
 */
import { useAuth } from '../../context/AuthContext';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '../../types/auth';
import styles from './HomePage.module.css';

export default function HomePage(): JSX.Element {
  const { user } = useAuth();

  if (!user) return <></>;

  const details: Array<{ label: string; value: string }> = [
    { label: 'Name', value: user.name },
    { label: 'Email', value: user.email },
    { label: 'Role', value: ROLE_LABELS[user.role] },
    { label: 'Account status', value: user.isActive ? 'Active' : 'Inactive' },
    { label: 'Member since', value: new Date(user.createdAt).toLocaleDateString() },
  ];

  return (
    <>
      <div className="page-header">
        <h1>Welcome back, {user.name.split(' ')[0]}</h1>
        <p>{ROLE_DESCRIPTIONS[user.role]}</p>
      </div>

      <div className={styles.grid}>
        <section className="card">
          <div className={styles.cardHeader}>
            <h3>Your account</h3>
            <span className="badge badge--info">{ROLE_LABELS[user.role]}</span>
          </div>

          <dl className={styles.details}>
            {details.map((detail) => (
              <div className={styles.detailRow} key={detail.label}>
                <dt className={styles.detailLabel}>{detail.label}</dt>
                <dd className={styles.detailValue}>{detail.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="card">
          <div className={styles.cardHeader}>
            <h3>Build progress</h3>
          </div>
          <p className={styles.note}>
            Authentication and role-based access are complete. The business modules arrive in the
            next phases:
          </p>
          <ul className={styles.phaseList}>
            <li>
              <span className="badge badge--success">Done</span> Authentication &amp; roles
            </li>
            <li>
              <span className="badge badge--neutral">Next</span> Customer CRM
            </li>
            <li>
              <span className="badge badge--neutral">Planned</span> Products &amp; inventory
            </li>
            <li>
              <span className="badge badge--neutral">Planned</span> Sales challans
            </li>
          </ul>
        </section>
      </div>
    </>
  );
}
