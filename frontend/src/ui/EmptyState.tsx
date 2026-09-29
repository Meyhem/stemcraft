import type { ReactNode } from 'react';

import styles from './EmptyState.module.css';

export function EmptyState({
  title,
  className,
  children,
}: {
  title: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={[styles.empty, className].filter(Boolean).join(' ')}>
      <p className={styles.title}>{title}</p>
      {children}
    </div>
  );
}
