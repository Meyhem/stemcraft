// A small floating panel anchored to its trigger. The transport's Loop and Practice
// editors use it; SavedLoops used to carry a private copy of this dismiss logic.
// The panel sits above the pinned transport's own layer and the time axis (z 10).
import { useEffect, useRef, type ReactNode } from 'react';

import styles from './Popover.module.css';

export interface PopoverProps {
  open: boolean;
  onClose(): void;
  /** The control(s) that open it; the caller owns aria-expanded. */
  trigger: ReactNode;
  /** Accessible name of the dialog. */
  label: string;
  children: ReactNode;
  /** Which edge of the trigger the panel lines up with. */
  align?: 'start' | 'end';
}

export function Popover({ open, onClose, trigger, label, children, align = 'end' }: PopoverProps) {
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [open, onClose]);

  return (
    <div className={styles.anchor} ref={root}>
      {trigger}
      {open && (
        <div role="dialog" aria-label={label} className={[styles.panel, align === 'start' ? styles.start : styles.end].join(' ')}>
          {children}
        </div>
      )}
    </div>
  );
}
