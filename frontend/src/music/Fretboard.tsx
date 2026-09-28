import { noteAtFret, noteName, pitchClassOf } from './theory';
import type { Mode } from './theory';
import styles from './Fretboard.module.css';

const FRETS = 12;
const STRING_GAP = 32;
const FRET_GAP = 56;
const NECK_LEFT = 40;
const TOP = 20;

export interface FretboardProps {
  tuning: string[]; // low to high, e.g. ['E', 'A', 'D', 'G']
  tonic: string; // sharp-spelled pitch-class name from analysis.json, e.g. 'G'
  mode: Mode;
  scaleNotes: Set<number>; // pitch classes (0-11) in the currently displayed scale
}

export function Fretboard({ tuning, tonic, mode, scaleNotes }: FretboardProps) {
  const tonicPc = pitchClassOf(tonic);
  const tonicLabel = noteName(tonicPc, tonicPc, mode);
  const width = NECK_LEFT + FRET_GAP * FRETS + 20;
  const height = TOP + STRING_GAP * (tuning.length - 1) + 20;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={styles.svg}
      role="img"
      aria-label={`${tonicLabel} ${mode} fretboard`}
    >
      {Array.from({ length: FRETS + 1 }, (_, fret) => (
        <line
          key={`fret-${fret}`}
          x1={NECK_LEFT + fret * FRET_GAP}
          x2={NECK_LEFT + fret * FRET_GAP}
          y1={TOP}
          y2={TOP + STRING_GAP * (tuning.length - 1)}
          className={fret === 0 ? styles.nut : styles.fret}
        />
      ))}
      {tuning.map((_, stringIndex) => (
        <line
          key={`string-${stringIndex}`}
          x1={NECK_LEFT}
          x2={NECK_LEFT + FRET_GAP * FRETS}
          y1={TOP + STRING_GAP * stringIndex}
          y2={TOP + STRING_GAP * stringIndex}
          className={styles.string}
        />
      ))}
      {tuning.map((openNote, stringIndex) => {
        const openPc = pitchClassOf(openNote);
        return Array.from({ length: FRETS + 1 }, (_, fret) => {
          const pc = (openPc + fret) % 12;
          if (!scaleNotes.has(pc)) return null;
          const isRoot = pc === tonicPc;
          const cx = fret === 0 ? NECK_LEFT - 14 : NECK_LEFT + fret * FRET_GAP - FRET_GAP / 2;
          const cy = TOP + STRING_GAP * stringIndex;
          return (
            <g key={`${stringIndex}-${fret}`}>
              <circle cx={cx} cy={cy} r={12} className={isRoot ? styles.root : styles.note} />
              <text x={cx} y={cy} className={styles.label}>
                {noteAtFret(openPc, fret, tonicPc, mode)}
              </text>
            </g>
          );
        });
      })}
    </svg>
  );
}
