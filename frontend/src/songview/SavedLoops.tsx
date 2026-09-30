// Saved loops, as a menu in the transport (they lived in the right rail until the
// song screen was unified). The button is performance tier: recalling a loop happens
// mid-practice. Naming and deleting are setup tier, inside the popover.
// Bars read 1-based and inclusive, like LoopBars: start_bar 4, end_bar 8 is "5–8".
import { useEffect, useRef, useState, type FormEvent } from 'react';

import type { Loop } from '../api/client';
import { Button } from '../ui';
import styles from './SavedLoops.module.css';

export interface SavedLoopsProps {
  savedLoops: Loop[];
  activeLoop: Loop | null;
  onRecallLoop(loop: Loop): void;
  onSaveActiveLoop(name: string): void;
  onDeleteLoop(name: string): void;
}

const bars = (loop: Loop) => `${loop.start_bar + 1}–${loop.end_bar}`;

export function SavedLoops({ savedLoops, activeLoop, onRecallLoop, onSaveActiveLoop, onDeleteLoop }: SavedLoopsProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!activeLoop || name.trim() === '') return;
    onSaveActiveLoop(name.trim());
    setName('');
  };

  return (
    <div className={styles.root} ref={root}>
      <span className={styles.caption} aria-hidden="true">
        Saved loops
      </span>
      <Button
        tier="perform"
        className={styles.button}
        aria-label="Saved loops"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span>{activeLoop ? activeLoop.name || 'Unsaved' : 'None'}</span>
        <span className={styles.bars}>{activeLoop ? bars(activeLoop) : ''} ▾</span>
      </Button>

      {open && (
        <div role="dialog" aria-label="Saved loops" className={styles.pop}>
          {savedLoops.length === 0 && <p className={styles.note}>No saved loops yet.</p>}
          <ul className={styles.list}>
            {savedLoops.map((loop) => (
              <li key={loop.name} className={styles.row}>
                <button
                  type="button"
                  className={styles.recall}
                  aria-label={`Recall loop ${loop.name}, bars ${bars(loop)}`}
                  aria-current={loop.name === activeLoop?.name ? 'true' : undefined}
                  onClick={() => {
                    onRecallLoop(loop);
                    setOpen(false);
                  }}
                >
                  <span>{loop.name}</span>
                  <span className={styles.bars}>{bars(loop)}</span>
                </button>
                <Button
                  variant="ghost"
                  className={styles.delete}
                  aria-label={`Delete loop ${loop.name}, bars ${bars(loop)}`}
                  onClick={() => onDeleteLoop(loop.name)}
                >
                  &times;
                </Button>
              </li>
            ))}
          </ul>
          <form className={styles.save} onSubmit={save}>
            <input
              type="text"
              aria-label="Loop name"
              className={styles.input}
              value={name}
              disabled={!activeLoop}
              onChange={(e) => setName(e.target.value)}
              placeholder={activeLoop ? `Name bars ${bars(activeLoop)}` : 'Set loop bars first'}
            />
            <Button type="submit" disabled={!activeLoop || name.trim() === ''}>
              Save loop
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
