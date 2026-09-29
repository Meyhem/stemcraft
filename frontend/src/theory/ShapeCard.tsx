// A small zoomed neck for one chord shape (D-19): a guitar voicing or a bass
// arpeggio. Five frets, starting where the shape needs; the open column only
// when the shape uses open strings.
import type { Cell } from '../music/positions';
import type { Instrument } from '../music/tuning';
import { Panel } from '../ui';
import styles from './Theory.module.css';
import { TheoryNeck, type NeckDot } from './TheoryNeck';

const SPAN = 5;

/** First fret of a 5-fret window that holds every fretted note: 1 (with the open column) near the nut. */
export function cardStart(frets: readonly number[]): number {
  const fretted = frets.filter((f) => f > 0);
  if (fretted.length === 0) return 1;
  const hi = Math.max(...fretted);
  if (hi <= SPAN) return 1;
  return Math.max(1, Math.min(Math.min(...fretted) - 1, hi - SPAN + 1));
}

export function ShapeCard({
  title,
  subtitle,
  instrument,
  dots,
  current = false,
}: {
  title: string;
  subtitle?: string;
  instrument: Instrument;
  dots: readonly NeckDot[];
  current?: boolean;
}) {
  const start = cardStart(dots.filter((d) => d.marker !== 'mute').map((d: Cell) => d.fret));
  const shown = start === 1 ? dots : dots.map((d) => (d.marker === 'mute' ? { ...d, fret: 0 } : d));
  return (
    <Panel className={current ? `${styles.shapeCard} ${styles.shapeCardCurrent}` : styles.shapeCard}>
      <div className={styles.row}>
        <b>{title}</b>
        {subtitle && <span className={styles.mono}>{subtitle}</span>}
      </div>
      <TheoryNeck instrument={instrument} start={start} frets={SPAN} size="card" dots={shown} label={`${title} ${subtitle ?? ''}`.trim()} />
    </Panel>
  );
}
