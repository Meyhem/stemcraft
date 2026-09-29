// Domain spec, "Import": one source, a file or a link. The last one given wins.
import { Button, DropZone, TextField } from '../../ui';
import styles from './SourceZone.module.css';

export interface SourceZoneProps {
  file: File | null;
  link: string;
  onFile: (file: File | null) => void;
  onLink: (link: string) => void;
}

function size(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function SourceZone({ file, link, onFile, onLink }: SourceZoneProps) {
  if (file) {
    return (
      <div className={styles.chosen}>
        <span className={styles.ok} aria-hidden="true">✓</span>
        <span className={styles.name}>
          {file.name} · {size(file.size)}
        </span>
        <Button variant="ghost" onClick={() => onFile(null)}>
          Replace
        </Button>
      </div>
    );
  }
  return (
    <div className={styles.zone}>
      <DropZone
        id="import-file"
        label="Audio or video file"
        file={null}
        autoFocus
        onFile={onFile}
        hint="For video, the audio track is extracted."
      />
      <p className={styles.or}>or paste a link</p>
      <TextField
        id="import-link"
        label="Link"
        type="url"
        placeholder="https://… (YouTube and direct media links)"
        value={link}
        onChange={(event) => onLink(event.target.value)}
      />
    </div>
  );
}
