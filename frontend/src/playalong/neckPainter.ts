// Drawing the Play along neck (D-18), kept apart from the component so the
// geometry and what gets drawn are testable against a recording context.
// Mirrors the mockup (design/ui/src/pages/screens/play-along.html): this bar's
// notes filled and numbered, the one to play now lit with a halo, approach
// notes ringed, the next bar's notes as dashed hollow rings.
import { MAX_FRET, type PlacedBar } from '../music/fingering';
import type { PlayAlongColors } from './colors';

export const NECK_H = 214;
const TOP = 40;
const STRING_GAP = 44;
const STRINGS = 'EADG';

export interface NeckGeometry {
  width: number;
  nutX: number;
  fretW: number;
}

export function neckGeometry(width: number): NeckGeometry {
  const nutX = 48;
  return { width, nutX, fretW: Math.max(0, (width - nutX - 18) / MAX_FRET) };
}

/** 0 = low E, drawn at the bottom, as a player looks down at the neck. */
export function stringY(string: number): number {
  return TOP + STRING_GAP * (3 - string);
}

/** Centre of a fretted note: between wire fret-1 and wire fret. Open notes sit left of the nut. */
export function noteX(g: NeckGeometry, fret: number): number {
  return fret === 0 ? g.nutX - 22 : g.nutX + g.fretW * (fret - 0.5);
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

export function paintNeck(
  ctx: CanvasRenderingContext2D,
  width: number,
  colors: PlayAlongColors,
  current: PlacedBar | null,
  next: PlacedBar | null,
  hot: number,
): void {
  const g = neckGeometry(width);
  const top = stringY(3) - 22;
  const bottom = stringY(0) + 22;
  ctx.clearRect(0, 0, width, NECK_H);

  ctx.fillStyle = colors.board;
  ctx.fillRect(g.nutX, top, g.fretW * MAX_FRET, bottom - top);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '500 13px ui-monospace, monospace';
  ctx.fillStyle = colors.label;
  for (let f = 1; f <= MAX_FRET; f++) ctx.fillText(String(f), noteX(g, f), 16);

  for (let f = 0; f <= MAX_FRET; f++) {
    ctx.strokeStyle = f === 0 ? colors.nut : colors.fret;
    ctx.lineWidth = f === 0 ? 6 : 2;
    const x = g.nutX + g.fretW * f;
    line(ctx, x, top, x, bottom);
  }

  ctx.font = '600 17px system-ui, sans-serif';
  ctx.textAlign = 'left';
  for (let s = 0; s < 4; s++) {
    ctx.strokeStyle = colors.string;
    ctx.lineWidth = 3.2 - s * 0.6;
    line(ctx, g.nutX, stringY(s), g.nutX + g.fretW * MAX_FRET, stringY(s));
    ctx.fillStyle = colors.label;
    ctx.fillText(STRINGS[s]!, 8, stringY(s) + 6);
  }

  ctx.fillStyle = colors.fret;
  for (const f of [3, 5, 7, 9]) {
    dot(ctx, noteX(g, f), bottom + 18, 5);
    ctx.fill();
  }
  for (const d of [-10, 10]) {
    dot(ctx, noteX(g, 12) + d, bottom + 18, 5);
    ctx.fill();
  }

  if (next) {
    ctx.strokeStyle = colors.next;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    for (const n of next.notes) {
      dot(ctx, noteX(g, n.position.fret), stringY(n.position.string), 18);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  if (!current) return;
  // One dot per position, numbered with every beat it is played on ("2·4").
  const byPosition = new Map<string, { index: number[]; approach: boolean; name: string; string: number; fret: number }>();
  current.notes.forEach((n, i) => {
    const k = `${n.position.string}:${n.position.fret}`;
    const entry = byPosition.get(k);
    if (entry) {
      entry.index.push(i);
      entry.approach ||= n.approach;
    } else {
      byPosition.set(k, { index: [i], approach: n.approach, name: n.name, string: n.position.string, fret: n.position.fret });
    }
  });

  ctx.textAlign = 'center';
  for (const d of byPosition.values()) {
    const x = noteX(g, d.fret);
    const y = stringY(d.string);
    const isHot = d.index.includes(hot);
    if (isHot) {
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = colors.hot;
      dot(ctx, x, y, 30);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = isHot ? colors.hot : colors.note;
    dot(ctx, x, y, 21);
    ctx.fill();
    if (d.approach) {
      ctx.strokeStyle = colors.approach;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.fillStyle = colors.onNote;
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillText(d.name, x, y - 1);
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.fillText(d.index.map((i) => i + 1).join('·'), x, y + 13);
  }
}
