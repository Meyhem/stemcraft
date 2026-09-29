import { Link, matchPath, Outlet, useLocation } from 'react-router-dom';

import { useHealth } from '../api/queries';
import { useJobStream } from '../api/useJobStream';
import { importLinkState } from '../screens/import/importLink';
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
  const location = useLocation();
  const health = useHealth();
  // Under the Import modal the page drawn is the one it was opened over. <Routes
  // location={background}> already makes useLocation() report that page, so the only
  // case left is a direct visit to /import, which draws the Library.
  const current = location.pathname === '/import' ? '/' : location.pathname;
  const active = (to: string) =>
    to !== '/import' && matchPath({ path: to, end: to === '/' }, current) !== null;
  const broken = health.data?.deps.filter((d) => !d.ok) ?? [];

  return (
    <div className={styles.shell}>
      <nav className={styles.nav}>
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            state={item.to === '/import' ? importLinkState(location) : undefined}
            className={active(item.to) ? styles.active : styles.link}
            aria-current={active(item.to) ? 'page' : undefined}
          >
            {item.label}
          </Link>
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
