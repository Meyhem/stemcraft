// The Theory tab's neck (D-19, U-13): any instrument and tuning, a fret window,
// an open-string column left of the nut, markers, a highlighted position,
// click targets and a left-handed mirror. SVG, not canvas: it is static between
// clicks and nothing on it moves with the engine clock. (playalong/Neck is the
// canvas one that does.) Reference: design/ui/src/pages/components/neck.html.
import type { KeyboardEvent } from 'react';

import type { Cell } from '../music/positions';
import { pretty } from '../music/spell';
import type { Instrument } from '../music/tuning';
import styles from './TheoryNeck.module.css';

export type Marker = 'root' | 'tone' | 'accent' | 'question' | 'next' | 'ok' | 'wrong' | 'mute';

export interface NeckDot extends Cell {
  label: string;
  marker: Marker;
  /** Outside the highlighted position: drawn at 28 % with a legible label. */
  dim?: boolean;
}

export interface HeatCell extends Cell {
  /** 0 strong … 1 weak. */
  weakness: number;
}

export interface TheoryNeckProps {
  instrument: Instrument;
  /** First fret column drawn. 1 (the default) also draws the open-string column. */
  start?: number;
  /** How many fret columns. */
  frets: number;
  dots: readonly NeckDot[];
  window?: { lo: number; hi: number } | null;
  heat?: readonly HeatCell[];
  onPick?: (cell: Cell) => void;
  size?: 'full' | 'card';
  /** Accessible name, e.g. "A minor pentatonic on bass". */
  label: string;
}

const INLAYS = new Set([3, 5, 7, 9, 12, 15, 17, 19, 21, 24]);

const MARKER_CLASS: Record<Marker, string | undefined> = {
  root: styles.root,
  tone: styles.tone,
  accent: styles.accent,
  question: styles.question,
  next: styles.next,
  ok: styles.ok,
  wrong: styles.wrong,
  mute: undefined,
};

export function TheoryNeck({
  instrument,
  start = 1,
  frets,
  dots,
  window,
  heat,
  onPick,
  size = 'full',
  label,
}: TheoryNeckProps) {
  const card = size === 'card';
  const W = card ? 360 : 1000;
  const SH = card ? 26 : 40;
  const R = card ? 11 : 14;
  const open = start === 1;
  const NUT = open ? 66 : 40;
  const TOP = 24;
  const fw = (W - NUT - 18) / frets;
  const rows = [...instrument.tuning].reverse();
  const H = TOP + SH * (rows.length - 1) + 32;
  // Fret 0 is the open column left of the nut; on a zoomed window it is the ✕ column for muted strings.
  const x = (fret: number) => (fret === 0 ? (open ? NUT - 22 : NUT - 10) : NUT + fw * (fret - start + 0.5));
  const y = (string: number) => TOP + SH * string;
  // Mirrored for a left-handed player; text is flipped back so it still reads.
  const flip = (cx: number) => (instrument.left_handed ? `translate(${2 * cx} 0) scale(-1 1)` : undefined);
  // Two strings can share a note name (low and high E; drop D's two Ds). Those, and only those, are named with
  // their octave so no two click targets read alike: "E2 string", "E4 string", but plain "A string".
  const letters = rows.map((n) => n.replace(/-?\d+$/, ''));
  const stringName = (string: number) =>
    `${pretty(letters.filter((l) => l === letters[string]).length > 1 ? rows[string]! : letters[string]!)} string`;
  const columns = [...(open ? [0] : []), ...Array.from({ length: frets }, (_, i) => start + i)];

  const key = (cell: Cell) => (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onPick?.(cell);
    }
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="group" aria-label={label}>
      <g transform={instrument.left_handed ? `translate(${W} 0) scale(-1 1)` : undefined}>
        {window && (
          <rect
            className={styles.window}
            x={NUT + fw * (window.lo - start)}
            y={TOP - 14}
            width={fw * (window.hi - window.lo + 1)}
            height={SH * (rows.length - 1) + 28}
            rx={8}
          />
        )}
        {heat?.map((h) => (
          <rect
            key={`heat-${h.string}-${h.fret}`}
            data-heat={`s${h.string}f${h.fret}`}
            className={h.weakness >= 0.5 ? styles.heatWeak : styles.heatStrong}
            style={{ opacity: 0.12 + 0.38 * Math.abs(h.weakness - 0.5) * 2 }}
            x={h.fret === 0 ? NUT - 40 : NUT + fw * (h.fret - start) + 2}
            y={y(h.string) - SH / 2 + 2}
            width={h.fret === 0 ? 36 : fw - 4}
            height={SH - 4}
            rx={4}
          />
        ))}
        {Array.from({ length: frets + 1 }, (_, i) => (
          <line
            key={`fret-${i}`}
            className={i === 0 && open ? styles.nut : styles.fret}
            x1={NUT + fw * i}
            x2={NUT + fw * i}
            y1={TOP - 8}
            y2={y(rows.length - 1) + 8}
          />
        ))}
        {columns
          .filter((f) => f > 0 && (INLAYS.has(f) || (f === start && !open)))
          .map((f) => (
            <text key={`inlay-${f}`} className={styles.inlay} x={x(f)} y={H - 6} transform={flip(x(f))}>
              {f}
            </text>
          ))}
        {rows.map((note, string) => (
          <g key={`string-${string}`}>
            <line className={styles.string} x1={NUT} x2={W - 18} y1={y(string)} y2={y(string)} strokeWidth={1 + string * 0.5} />
            <text className={styles.stringName} x={14} y={y(string)} transform={flip(14)}>
              {pretty(note.replace(/-?\d+$/, ''))}
            </text>
          </g>
        ))}
        {dots.map((dot) => {
          const cx = x(dot.fret);
          const cy = y(dot.string);
          const common = { 'data-cell': `s${dot.string}f${dot.fret}`, 'data-marker': dot.marker };
          if (dot.marker === 'mute') {
            return (
              <text key={common['data-cell']} {...common} className={styles.muteMark} x={cx} y={cy} transform={flip(cx)}>
                ✕
              </text>
            );
          }
          const text = dot.marker === 'wrong' ? '✕' : dot.marker === 'question' ? '?' : dot.label;
          return (
            <g key={common['data-cell']} {...common} data-dim={dot.dim ? 'true' : undefined} className={dot.dim ? styles.dim : undefined}>
              {dot.marker === 'accent' && <circle className={styles.halo} cx={cx} cy={cy} r={R + 6} />}
              <circle className={MARKER_CLASS[dot.marker]} cx={cx} cy={cy} r={R} />
              {text && (
                <text
                  className={`${styles.label} ${styles[`label_${dot.marker}`] ?? ''}`}
                  x={cx}
                  y={cy}
                  transform={flip(cx)}
                  fontSize={text.length > 1 ? (card ? 10 : 12) : card ? 11 : 13}
                >
                  {text}
                </text>
              )}
            </g>
          );
        })}
        {onPick &&
          rows.flatMap((_, string) =>
            columns.map((fret) => {
              const cell = { string, fret };
              const name = `${stringName(string)}, ${fret === 0 ? 'open' : `fret ${fret}`}`;
              return (
                <rect
                  key={`pick-${string}-${fret}`}
                  className={styles.pick}
                  role="button"
                  tabIndex={0}
                  aria-label={name}
                  x={fret === 0 ? NUT - 40 : NUT + fw * (fret - start)}
                  y={y(string) - SH / 2}
                  width={fret === 0 ? 36 : fw}
                  height={SH}
                  onClick={() => onPick(cell)}
                  onKeyDown={key(cell)}
                />
              );
            }),
          )}
      </g>
    </svg>
  );
}
