// Drawing the guitar Tabs neck (D-20), kept apart from the component so what
// gets drawn is testable against a recording context, like neckPainter.ts.
// Mirrors the mockup (design/ui/src/pages/screens/play-along-guitar.html): this
// bar's shape filled in the other-stem colour with a chord degree on each dot,
// open strings as rings and muted ones as ✕ left of the nut, a barre as a bar,
// the next bar's shape as dashed rings, and a halo on every stroke.
import type { GuitarBar } from '../music/guitarSource';
import { guitarEmptyText } from '../music/guitarSource';
import { GUITAR_MAX_FRET } from '../music/guitarShapes';
import type { PlayAlongColors } from './colors';
import { noteX, type NeckGeometry } from './neckPainter';

export const GUITAR_NECK_H = 236;
const TOP = 40;
const STRING_GAP = 30;
/** Row 0 = high e, drawn at the top, as a player looks down at the neck. */
const NAMES = ['e', 'B', 'G', 'D', 'A', 'E'];

/** Wider than the bass nut, so open-string rings sit clear of the string names. */
export function guitarGeometry(width: number): NeckGeometry {
  const nutX = 72;
  return { width, nutX, fretW: Math.max(0, (width - nutX - 18) / GUITAR_MAX_FRET) };
}

export function rowY(row: number): number {
  return TOP + STRING_GAP * row;
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

export function paintGuitarNeck(
  ctx: CanvasRenderingContext2D,
  width: number,
  colors: PlayAlongColors,
  current: GuitarBar | null,
  next: GuitarBar | null,
  strumming: boolean,
): void {
  const g = guitarGeometry(width);
  const top = rowY(0) - 18;
  const bottom = rowY(5) + 18;
  // Dots shrink with the frets on a phone so adjacent frets do not overlap; 16 on desktop.
  const r = Math.min(16, g.fretW * 0.42);
  const scale = r / 16;
  ctx.clearRect(0, 0, width, GUITAR_NECK_H);

  ctx.fillStyle = colors.board;
  ctx.fillRect(g.nutX, top, g.fretW * GUITAR_MAX_FRET, bottom - top);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '500 13px ui-monospace, monospace';
  ctx.fillStyle = colors.label;
  for (let f = 1; f <= GUITAR_MAX_FRET; f++) ctx.fillText(String(f), noteX(g, f), 16);

  for (let f = 0; f <= GUITAR_MAX_FRET; f++) {
    ctx.strokeStyle = f === 0 ? colors.nut : colors.fret;
    ctx.lineWidth = f === 0 ? 6 : 2;
    const x = g.nutX + g.fretW * f;
    line(ctx, x, top, x, bottom);
  }

  ctx.font = '600 15px system-ui, sans-serif';
  ctx.textAlign = 'left';
  for (let row = 0; row < 6; row++) {
    ctx.strokeStyle = colors.string;
    ctx.lineWidth = 1.2 + row * 0.35;
    line(ctx, g.nutX, rowY(row), g.nutX + g.fretW * GUITAR_MAX_FRET, rowY(row));
    ctx.fillStyle = colors.label;
    ctx.fillText(NAMES[row]!, 8, rowY(row) + 5);
  }

  ctx.fillStyle = colors.fret;
  for (const f of [3, 5, 7, 9]) {
    dot(ctx, noteX(g, f), bottom + 16, 5);
    ctx.fill();
  }
  for (const d of [-10, 10]) {
    dot(ctx, noteX(g, 12) + d, bottom + 16, 5);
    ctx.fill();
  }

  if (next?.shape) {
    ctx.strokeStyle = colors.next;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    next.shape.frets.forEach((f, row) => {
      if (f === null) return;
      dot(ctx, noteX(g, f), rowY(row), r);
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }

  if (!current) return;
  const empty = guitarEmptyText(current);
  if (empty !== null || !current.shape) {
    ctx.textAlign = 'center';
    ctx.font = '600 17px system-ui, sans-serif';
    ctx.fillStyle = colors.textDim;
    ctx.fillText(empty ?? '', g.nutX + (g.fretW * GUITAR_MAX_FRET) / 2, (top + bottom) / 2 + 6);
    return;
  }

  const { frets, barre } = current.shape;
  if (strumming) {
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = colors.hot;
    frets.forEach((f, row) => {
      if (f === null) return;
      dot(ctx, noteX(g, f), rowY(row), r * 1.45);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  if (barre) {
    ctx.fillStyle = colors.other;
    ctx.beginPath();
    ctx.roundRect(noteX(g, barre.fret) - r * 0.55, rowY(barre.from) - r * 0.55, r * 1.1, rowY(barre.to) - rowY(barre.from) + r * 1.1, r * 0.55);
    ctx.fill();
  }

  ctx.textAlign = 'center';
  frets.forEach((f, row) => {
    const y = rowY(row);
    if (f === null) {
      ctx.fillStyle = colors.textDim;
      ctx.font = `700 ${Math.max(10, 15 * scale)}px system-ui, sans-serif`;
      ctx.fillText('✕', noteX(g, 0), y + 5 * scale);
      return;
    }
    const x = noteX(g, f);
    const degree = current.degrees[row] ?? '';
    dot(ctx, x, y, r);
    if (f === 0) {
      ctx.fillStyle = colors.ground;
      ctx.fill();
      ctx.strokeStyle = colors.other;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = colors.other;
    } else {
      ctx.fillStyle = colors.other;
      ctx.fill();
      if (degree === 'R') {
        ctx.strokeStyle = colors.text;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.fillStyle = colors.onNote;
    }
    ctx.font = `700 ${Math.max(9, 14 * scale)}px system-ui, sans-serif`;
    ctx.fillText(degree, x, y + 5 * scale);
  });
}
