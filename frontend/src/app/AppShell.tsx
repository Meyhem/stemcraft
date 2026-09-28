import { NavLink, Outlet } from 'react-router-dom';

import { useHealth } from '../api/queries';
import { useJobStream } from '../api/useJobStream';
import styles from './AppShell.module.css';

const NAV = [
  { to: '/', label: 'Library' },
  { to: '/import', label: 'Import' },
  { to: '/splitter', label: 'Album splitter' },
  { to: '/jobs', label: 'Job queue' },
];

export function AppShell() {
  useJobStream();
  const health = useHealth();
  const broken = health.data?.deps.filter((d) => !d.ok) ?? [];

  return (
    <div className={styles.shell}>
      <nav className={styles.nav}>
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => (isActive ? styles.active : styles.link)}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* N-08: a missing dependency is visible, named, and quotes the real error. */}
      {broken.length > 0 && (
        <div className={styles.banner} role="alert">
          {broken.map((dep) => (
            <div key={dep.name}>
              <strong>{dep.name}</strong>: {dep.detail}
            </div>
          ))}
        </div>
      )}

      {broken.length === 0 && health.data?.device === 'cpu' && (
        <div className={styles.bannerWarn} role="status">
          Running separation on CPU
          {health.data.fallback_reason ? ` (${health.data.fallback_reason})` : ''}
          {' '}
          — this is slower than GPU (N-01).
        </div>
      )}

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
