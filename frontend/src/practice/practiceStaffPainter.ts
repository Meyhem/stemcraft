// Drawing the Practice tab staff (D-22), apart from the component so it is
// testable against a recording context. A loop of up to 8 bars is drawn whole,
// fitted to the width. A longer one shows 8 bars with the playhead a third of
// the way in, the loop drawn end to end (tiled), so the view slides straight
// through the wrap instead of jumping back. Highest string on top (U-13); a
// chip's left edge is its onset. It never plays (invariant 7).
import type { SampleIndex } from '../engine/types';
import type { Grid } from '../music/grid';
import type { PracticeLoop } from '../music/practice/types';
import type { PlayAlongColors } from '../playalong/colors';

export const VIEW_BEATS = 32;
const CHORD_ROW_H = 44;
const PAD = 16;
const ROW = 40;
const CHIP_H = 28;

const mod = (n: number, m: number) => ((n % m) + m) % m;

export function practiceStaffHeight(strings: number): number {
  return CHORD_ROW_H + PAD + strings * ROW;
}

function stringY(strings: number, string: number): number {
  return CHORD_ROW_H + PAD / 2 + ROW / 2 + (strings - 1 - string) * ROW;
}

export function staffWindow(totalBeats: number, beat: number | null): { from: number; to: number; tiled: boolean } {
  if (totalBeats <= VIEW_BEATS) return { from: 0, to: totalBeats, tiled: false };
  const from = (beat ?? 0) - VIEW_BEATS / 3;
  return { from, to: from + VIEW_BEATS, tiled: true };
}

export function beatAt(display: Grid, position: SampleIndex): number | null {
  const first = display.bars[0]!;
  if (position < first) return null;
  return (position - first) / (display.medianBarSamples / display.beatsPerBar);
}

export function chordNameAt(loop: PracticeLoop, bar: number): string {
  const n = loop.bars.length;
  let i = mod(bar, n);
  for (let k = 0; k < n && loop.bars[i]!.repeat; k++) i = mod(i - 1, n);
  return loop.bars[i]!.label;
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

export function paintPracticeStaff(
  ctx: CanvasRenderingContext2D,
  view: { width: number; loop: PracticeLoop; beat: number | null; colors: PlayAlongColors },
): void {
  const { width, loop, beat, colors } = view;
  const strings = loop.strings;
  const height = practiceStaffHeight(strings);
  const total = loop.bars.length * 4;
  const w = staffWindow(total, beat);
  const pxPerBeat = width / (w.to - w.from);
  const x = (b: number) => (b - w.from) * pxPerBeat;
  const nowBar = beat === null ? null : Math.floor(beat / 4);
  const fill = loop.instrument === 'guitar' ? colors.other : colors.note;
  ctx.clearRect(0, 0, width, height);

  // Chord row: the bar under the playhead tinted, repeats as "%", but the first bar in view always named.
  const firstBar = Math.floor(w.from / 4);
  const lastBar = Math.ceil(w.to / 4) - 1;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '600 17px system-ui, sans-serif';
  for (let i = firstBar; i <= lastBar; i++) {
    const bar = loop.bars[mod(i, loop.bars.length)]!;
    if (i === nowBar) {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = colors.hot;
      ctx.fillRect(x(i * 4), 0, 4 * pxPerBeat, CHORD_ROW_H);
      ctx.globalAlpha = 1;
    }
    const text = bar.repeat && i !== firstBar ? '%' : chordNameAt(loop, i);
    if (!text) continue;
    ctx.fillStyle = i === nowBar ? colors.text : bar.repeat ? colors.label : colors.next;
    ctx.fillText(text, Math.max(x(i * 4), 0) + 10, CHORD_ROW_H / 2);
  }

  // Beat lines faint, bar lines bright (as on every time axis).
  for (let b = Math.ceil(w.from); b <= Math.floor(w.to); b++) {
    const isBar = mod(b, 4) === 0;
    ctx.globalAlpha = isBar ? 0.9 : 0.3;
    ctx.strokeStyle = colors.fret;
    ctx.lineWidth = isBar ? 2 : 1;
    line(ctx, x(b), isBar ? 0 : CHORD_ROW_H, x(b), height);
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = colors.string;
  ctx.lineWidth = 2;
  for (let s = 0; s < strings; s++) line(ctx, 0, stringY(strings, s), width, stringY(strings, s));

  ctx.textAlign = 'center';
  for (const copy of w.tiled ? [-1, 0, 1] : [0]) {
    for (const note of loop.notes) {
      const start = note.start + copy * total;
      if (start + note.dur < w.from || start > w.to) continue;
      const hot = beat !== null && beat >= start && beat < start + note.dur;
      const cx = x(start) + 2;
      const cw = Math.max(10, note.dur * pxPerBeat - 4);
      const cy = stringY(strings, note.string) - CHIP_H / 2;
      if (hot) {
        ctx.fillStyle = colors.hot;
        ctx.fillRect(cx, cy, cw, CHIP_H);
      } else if (note.kind === 'approach') {
        ctx.fillStyle = colors.raised;
        ctx.fillRect(cx, cy, cw, CHIP_H);
        ctx.strokeStyle = fill;
        ctx.lineWidth = 2;
        ctx.strokeRect(cx, cy, cw, CHIP_H);
      } else {
        ctx.fillStyle = fill;
        ctx.fillRect(cx, cy, cw, CHIP_H);
      }
      ctx.fillStyle = note.kind === 'approach' && !hot ? fill : colors.onNote;
      ctx.font = `700 ${cw >= 26 ? 15 : cw >= 16 ? 12 : 10}px ui-monospace, monospace`;
      ctx.fillText(String(note.fret), cx + cw / 2, cy + CHIP_H / 2);
    }
  }

  if (beat !== null) {
    ctx.strokeStyle = colors.hot;
    ctx.lineWidth = 2;
    line(ctx, x(beat), 0, x(beat), height);
  }
}
