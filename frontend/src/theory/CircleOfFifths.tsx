// The circle of fifths (D-19): 12 major keys outside, their relative minors
// inside. The current key is lit in the accent (a selection is chrome, U-01)
// and its neighbours, which share six of seven notes, are outlined. Every key
// is a button. Drawn small on Chords in a key and large as its own tool.
import { keySignature, pcOf, pretty, type KeyMode } from '../music/spell';
import styles from './CircleOfFifths.module.css';

const MAJORS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
const MINORS = ['A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'Bb', 'F', 'C', 'G', 'D'];

export function signatureText(root: string, mode: KeyMode): string {
  const { accidentals, sharps } = keySignature(root, mode);
  if (accidentals.length === 0) return 'no sharps or flats';
  const n = accidentals.length;
  const word = sharps ? (n === 1 ? 'sharp' : 'sharps') : n === 1 ? 'flat' : 'flats';
  return `${n} ${word} · ${accidentals.map(pretty).join(' ')}`;
}

/** Position of a key on the circle, 0 = C / A minor at the top. */
export function circleIndex(root: string, mode: KeyMode): number {
  const pc = pcOf(root);
  return (mode === 'major' ? MAJORS : MINORS).findIndex((k) => pcOf(k) === pc);
}

export function CircleOfFifths({
  root,
  mode,
  size = 300,
  onPick,
}: {
  root: string;
  mode: KeyMode;
  size?: number;
  onPick: (root: string, mode: KeyMode) => void;
}) {
  const c = size / 2;
  const lit = circleIndex(root, mode);
  const near = (i: number) => (i - lit + 12) % 12 === 1 || (i - lit + 12) % 12 === 11;
  const ring = (i: number, r: number) => {
    const a = ((i * 30 - 90) * Math.PI) / 180;
    return { x: c + r * Math.cos(a), y: c + r * Math.sin(a) };
  };
  const key = (i: number, keyMode: KeyMode) => {
    const name = keyMode === 'major' ? MAJORS[i]! : MINORS[i]!;
    const on = i === lit && keyMode === mode;
    const outlined = !on && (i === lit || near(i));
    const { x, y } = ring(i, keyMode === 'major' ? c - 29 : c - 77);
    const label = keyMode === 'major' ? pretty(name) : `${pretty(name)}m`;
    return (
      <g
        key={`${keyMode}-${name}`}
        role="button"
        tabIndex={0}
        aria-label={`${pretty(name)} ${keyMode}`}
        aria-pressed={on}
        className={styles.key}
        onClick={() => onPick(name, keyMode)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onPick(name, keyMode);
          }
        }}
      >
        <circle cx={x} cy={y} r={keyMode === 'major' ? 19 : 17} className={on ? styles.on : outlined ? styles.near : styles.off} />
        <text x={x} y={y} className={`${keyMode === 'major' ? styles.major : styles.minor} ${on ? styles.onText : ''}`}>
          {label}
        </text>
      </g>
    );
  };
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className={styles.svg} role="group" aria-label="Circle of fifths">
      <circle cx={c} cy={c} r={c - 4} className={styles.outer} />
      <circle cx={c} cy={c} r={c - 54} className={styles.inner} />
      <circle cx={c} cy={c} r={c - 100} className={styles.hub} />
      {MAJORS.map((_, i) => key(i, 'major'))}
      {MINORS.map((_, i) => key(i, 'minor'))}
      <text x={c} y={c - 8} className={styles.center}>
        {pretty(root)} {mode}
      </text>
      <text x={c} y={c + 12} className={styles.sig}>
        {signatureText(root, mode).split(' · ')[0]}
      </text>
    </svg>
  );
}
