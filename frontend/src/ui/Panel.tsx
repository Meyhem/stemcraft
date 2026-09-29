import type { ReactNode } from 'react';

import styles from './Panel.module.css';

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={[styles.panel, className].filter(Boolean).join(' ')}>{children}</div>;
}
