// Saved loops, as a panel inside the transport's loop editor popover (they lived in the
// right rail until the song screen was unified). Setup tier: recalling, naming and
// deleting all happen in the popover, not on the bar.
// Bars read 1-based and inclusive, like LoopBars: start_bar 4, end_bar 8 is "5–8".
import { useState, type FormEvent } from 'react';

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
  const [name, setName] = useState('');

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!activeLoop || name.trim() === '') return;
    onSaveActiveLoop(name.trim());
    setName('');
  };

  return (
    <div className={styles.root}>
      <span className={styles.caption}>Saved loops</span>
      {savedLoops.length === 0 && <p className={styles.note}>No saved loops yet.</p>}
      <ul className={styles.list}>
        {savedLoops.map((loop) => (
          <li key={loop.name} className={styles.row}>
            <button
              type="button"
              className={styles.recall}
              aria-label={`Recall loop ${loop.name}, bars ${bars(loop)}`}
              aria-current={loop.name === activeLoop?.name ? 'true' : undefined}
              onClick={() => onRecallLoop(loop)}
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
  );
}
