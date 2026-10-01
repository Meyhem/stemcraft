import type { ReactNode } from 'react';

import { Breadcrumbs, type Crumb } from './Breadcrumbs';
import styles from './ScreenHeader.module.css';

export interface ScreenHeaderProps {
  crumbs: Crumb[];
  /** The screen's title: a string becomes the h1, a node (an editor) is placed as given. */
  title: ReactNode;
  subtitle?: string;
  actions?: ReactNode;
}

/** Breadcrumbs left, the screen title centred, actions right. */
export function ScreenHeader({ crumbs, title, subtitle, actions }: ScreenHeaderProps) {
  return (
    <header className={styles.head}>
      <Breadcrumbs crumbs={crumbs} />
      <div className={styles.title}>
        {typeof title === 'string' ? <h1>{title}</h1> : title}
        {subtitle && <p className={styles.sub}>{subtitle}</p>}
      </div>
      <div className={styles.actions}>{actions}</div>
    </header>
  );
}
