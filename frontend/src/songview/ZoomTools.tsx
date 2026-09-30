// How the Stems time axis is drawn: zoom and follow. View state, set up with both
// hands free, so setup tier (40 px). It sits beside the Stems/Tabs switch because it
// means nothing in the Tabs view. The wheel and drag-to-zoom on the axis reach the
// same zoom (U-12).
import { Button } from '../ui';
import styles from './ZoomTools.module.css';

export interface ZoomToolsProps {
  /** What the zoom shows: "Whole song", or how much of it is in view. */
  zoomLabel: string;
  onZoomIn(): void;
  onZoomOut(): void;
  onZoomFit(): void;
  follow: boolean;
  onFollowToggle(): void;
}

export function ZoomTools({ zoomLabel, onZoomIn, onZoomOut, onZoomFit, follow, onFollowToggle }: ZoomToolsProps) {
  return (
    <div className={styles.tools}>
      <div className={styles.readout}>
        <span className={styles.caption} aria-hidden="true">
          Zoom
        </span>
        <div role="group" aria-label="Zoom" className={styles.zoom}>
          <Button aria-label="Zoom out" onClick={onZoomOut}>
            −
          </Button>
          <output className={styles.zoomValue} data-testid="song-zoom">
            {zoomLabel}
          </output>
          <Button aria-label="Zoom in" onClick={onZoomIn}>
            +
          </Button>
          <Button onClick={onZoomFit}>Fit</Button>
        </div>
      </div>
      <Button aria-pressed={follow} onClick={onFollowToggle}>
        Follow playhead
      </Button>
    </div>
  );
}
