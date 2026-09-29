import type { ReactNode } from 'react';

import styles from './Table.module.css';

export function Table({ className, children }: { className?: string; children: ReactNode }) {
  return <table className={[styles.tbl, className].filter(Boolean).join(' ')}>{children}</table>;
}
