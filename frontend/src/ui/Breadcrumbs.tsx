import { Link } from 'react-router-dom';

import styles from './Breadcrumbs.module.css';

export interface Crumb {
  label: string;
  /** Ancestors link; the current page (the last crumb) has no `to`. */
  to?: string;
}

/** The trail from the top of the app to the current screen. */
export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className={styles.nav}>
      <ol className={styles.list}>
        {crumbs.map((crumb, index) => (
          <li key={`${index}-${crumb.label}`} className={styles.item}>
            {crumb.to ? (
              <Link className={styles.link} to={crumb.to}>
                {crumb.label}
              </Link>
            ) : (
              <span aria-current="page" className={styles.current}>
                {crumb.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
