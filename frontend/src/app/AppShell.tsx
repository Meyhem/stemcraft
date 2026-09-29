import { NavLink, Outlet } from 'react-router-dom';

import { useHealth } from '../api/queries';
import { useJobStream } from '../api/useJobStream';
import { Banner } from '../ui';
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
        <Banner
          className={styles.notice}
          tone="error"
          title={broken.length === 1 ? 'A dependency is not usable' : 'Dependencies are not usable'}
          trace={broken.map((dep) => `${dep.name}: ${dep.detail}`).join('\n')}
        />
      )}

      {broken.length === 0 && health.data?.device === 'cpu' && (
        <Banner className={styles.notice} tone="warn">
          Running separation on CPU
          {health.data.fallback_reason ? ` (${health.data.fallback_reason})` : ''}
          {' '}
          — this is slower than GPU (N-01).
        </Banner>
      )}

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
