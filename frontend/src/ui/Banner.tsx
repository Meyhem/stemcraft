import type { ReactNode } from 'react';

import styles from './Banner.module.css';

export interface BannerProps {
  tone: 'warn' | 'error';
  title?: ReactNode;
  /** U-09: the real message from the real tool. Rendered verbatim, never paraphrased. */
  trace?: string | null;
  role?: string;
  className?: string;
  children?: ReactNode;
}

export function Banner({ tone, title, trace, role, className, children }: BannerProps) {
  const cls = [styles.banner, tone === 'error' ? styles.error : styles.warn, className]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} role={role ?? (tone === 'error' ? 'alert' : 'status')}>
      <div className={styles.body}>
        {title && <p className={styles.title}>{title}</p>}
        {children && <div className={styles.text}>{children}</div>}
        {trace && <pre className={styles.trace}>{trace}</pre>}
      </div>
    </div>
  );
}
