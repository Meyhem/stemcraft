// Drawing the Tab staff (D-21, U-16), apart from the component so it is testable
// against a recording context. Mirrors design/ui/src/pages/components/tabstaff.html:
// four strings, highest on top; a note is a mono fret chip whose left edge is its
// onset, with a tail to where it stops, never snapped to the grid. Only the visible
// slice [scrollLeft, scrollLeft + width) is painted.
import type { TabNote } from '../music/bassTab';
import { showBeatLines, type TimeScale } from '../music/timeScale';
import type { PlayAlongColors } from '../playalong/colors';

export const STAFF_H = 180;
const TOP = 30;
const GAP = 40;
const CHIP_H = 28;

/** 0 = low E, drawn at the bottom, as on every neck (U-13). */
export function staffStringY(string: number): number {
  return TOP + GAP * (3 - string);
}

export function chipLabel(note: TabNote): string {
  return note.unsure ? `${note.position.fret}?` : String(note.position.fret);
}

const chipWidth = (label: string) => Math.max(30, 14 + 11 * label.length);
const octaveLabel = (octave: number) => `${octave > 0 ? '↑' : '↓'}${8 * Math.abs(octave)}`;

export interface StaffView {
  width: number;
  scrollLeft: number;
  scale: TimeScale;
  notes: readonly TabNote[];
  /** Index of the sounding note, or -1. */
  hot: number;
  bars: readonly number[];
  beats: readonly number[];
  colors: PlayAlongColors;
}

function vline(ctx: CanvasRenderingContext2D, x: number) {
  ctx.beginPath();
  ctx.moveTo(x, TOP - 14);
  ctx.lineTo(x, staffStringY(0) + 14);
  ctx.stroke();
}

export function paintStaff(ctx: CanvasRenderingContext2D, view: StaffView): void {
  const { width, scrollLeft, scale, notes, hot, colors } = view;
  const x = (sample: number) => sample * scale.pxPerSample - scrollLeft;
  ctx.clearRect(0, 0, width, STAFF_H);

  // Beat lines faint, bar lines bright, as on the Stems lanes.
  ctx.strokeStyle = colors.fret;
  if (showBeatLines(scale.pxPerBar)) {
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    for (const b of view.beats) {
      const bx = x(b);
      if (bx >= 0 && bx <= width) vline(ctx, bx);
    }
    ctx.globalAlpha = 1;
  }
  ctx.lineWidth = 2;
  for (const b of view.bars) {
    const bx = x(b);
    if (bx >= 0 && bx <= width) vline(ctx, bx);
  }
  ctx.strokeStyle = colors.string;
  for (let s = 0; s < 4; s++) {
    ctx.lineWidth = 3.2 - s * 0.6;
    ctx.beginPath();
    ctx.moveTo(0, staffStringY(s));
    ctx.lineTo(width, staffStringY(s));
    ctx.stroke();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  notes.forEach((note, i) => {
    const label = chipLabel(note);
    const cw = chipWidth(label);
    const left = x(note.start);
    const end = x(note.end);
    if (left > width || Math.max(left + cw, end) < 0) return;
    const y = staffStringY(note.position.string);
    const isHot = i === hot;
    const fill = isHot ? colors.hot : colors.note;
    const alpha = note.unsure && !isHot ? 0.4 : 1;

    if (end > left + cw) {
      ctx.strokeStyle = fill;
      ctx.globalAlpha = 0.55 * alpha;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(left + cw, y);
      ctx.lineTo(end - 3, y);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
    if (isHot) {
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = colors.hot;
      ctx.beginPath();
      ctx.roundRect(left - 6, y - 20, cw + 12, 40, 10);
      ctx.fill();
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(left, y - CHIP_H / 2, cw, CHIP_H, 7);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (note.octave !== 0) {
      // A substitution says what it changed (U-16, N-08).
      ctx.strokeStyle = colors.approach;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = colors.approach;
      ctx.font = '700 13px ui-monospace, monospace';
      ctx.fillText(octaveLabel(note.octave), left + cw / 2, y - 19);
    }
    ctx.fillStyle = note.unsure && !isHot ? colors.text : colors.onNote;
    ctx.font = '700 17px ui-monospace, monospace';
    ctx.fillText(label, left + cw / 2, y + 6);
  });
}
