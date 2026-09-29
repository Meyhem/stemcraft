import { useState, type DragEvent, type ReactNode } from 'react';

import styles from './DropZone.module.css';

export interface DropZoneProps {
  id: string;
  label: ReactNode;
  file: File | null;
  onFile: (file: File | null) => void;
  hint?: ReactNode;
  className?: string;
}

/**
 * A file drop zone wrapping a real <input type="file">.
 *
 * There is deliberately no `accept` prop: there is no format whitelist in this app --
 * whatever ffmpeg decodes is accepted -- and an accept filter would hide valid files
 * from the picker.
 */
export function DropZone({ id, label, file, onFile, hint, className }: DropZoneProps) {
  const [over, setOver] = useState(false);

  function take(files: FileList | File[] | null) {
    const list = files ? Array.from(files) : [];
    onFile(list.length > 0 ? list[0]! : null);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    // Without this the browser navigates to the dropped file and the page is gone.
    event.preventDefault();
    setOver(false);
    take(event.dataTransfer?.files ?? null);
  }

  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div
        className={styles.drop}
        data-over={over}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={handleDrop}
      >
        <input
          id={id}
          className={styles.input}
          type="file"
          onChange={(event) => take(event.target.files)}
        />
        <p className={styles.primary}>{file ? file.name : 'Drop a file here, or choose one'}</p>
        {hint && <p className={styles.hint}>{hint}</p>}
      </div>
    </div>
  );
}
