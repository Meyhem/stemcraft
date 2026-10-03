// Drawing the Play along neck (D-18), kept apart from the component so the
// geometry and what gets drawn are testable against a recording context.
// Mirrors the mockup (design/ui/src/pages/screens/play-along.html): this bar's
// notes filled and numbered, the one to play now lit with a halo, approach
// notes ringed, the next bar's notes as dashed hollow rings. The Tab view (D-21) feeds
// it a transcription's bars, whose unsure notes are dimmed and badged "?" and whose
// octave-shifted notes take the warn ring (U-16).
import { MAX_FRET, type Position } from '../music/fingering';
import type { PlayAlongColors } from './colors';

export const NECK_H = 214;

/** What the neck draws. PlacedBar satisfies it; so does a transcription's bar (D-21). */
export interface NeckNote {
  name: string;
  position: Position;
  approach?: boolean;
  /** U-16: drawn at 40 % with a "?" badge. */
  unsure?: boolean;
  /** U-16: moved by octaves to fit the neck; drawn with the warn ring. */
  octave?: number;
}

export interface NeckBar {
  notes: readonly NeckNote[];
}
const TOP = 40;
const STRING_GAP = 44;

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

/** Strings and spacing. The bass default is exactly the Play along neck (D-18); Practice adds six strings (D-22). */
export interface NeckLayout {
  /** Low string first. */
  names: readonly string[];
  top: number;
  gap: number;
  height: number;
}
export const BASS_LAYOUT: NeckLayout = { names: ['E', 'A', 'D', 'G'], top: TOP, gap: STRING_GAP, height: NECK_H };
export const GUITAR_LINE_LAYOUT: NeckLayout = { names: ['E', 'A', 'D', 'G', 'B', 'e'], top: 40, gap: 30, height: 250 };

function yOf(layout: NeckLayout, string: number): number {
  return layout.top + layout.gap * (layout.names.length - 1 - string);
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
  current: NeckBar | null,
  next: NeckBar | null,
  hot: number,
  layout: NeckLayout = BASS_LAYOUT,
): void {
  const g = neckGeometry(width);
  const top = yOf(layout, layout.names.length - 1) - 22;
  const bottom = yOf(layout, 0) + 22;
  // Dots shrink with the frets on a phone so adjacent frets do not overlap; 21 on desktop.
  const r = Math.min(21, layout.gap * 0.48, g.fretW * 0.48);
  const scale = r / 21;
  ctx.clearRect(0, 0, width, layout.height);

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
  for (let s = 0; s < layout.names.length; s++) {
    ctx.strokeStyle = colors.string;
    ctx.lineWidth = 3.2 - s * (layout.names.length === 4 ? 0.6 : 0.45);
    line(ctx, g.nutX, yOf(layout, s), g.nutX + g.fretW * MAX_FRET, yOf(layout, s));
    ctx.fillStyle = colors.label;
    ctx.fillText(layout.names[s]!, 8, yOf(layout, s) + 6);
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
      dot(ctx, noteX(g, n.position.fret), yOf(layout, n.position.string), r * (18 / 21));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  if (!current) return;
  // One dot per position, numbered with every beat it is played on ("2·4").
  // Unsure only if every play at that position is; shifted if any is.
  const byPosition = new Map<
    string,
    { index: number[]; approach: boolean; unsure: boolean; shifted: boolean; name: string; string: number; fret: number }
  >();
  current.notes.forEach((n, i) => {
    const k = `${n.position.string}:${n.position.fret}`;
    const entry = byPosition.get(k);
    const shifted = (n.octave ?? 0) !== 0;
    if (entry) {
      entry.index.push(i);
      entry.approach ||= n.approach === true;
      entry.unsure &&= n.unsure === true;
      entry.shifted ||= shifted;
    } else {
      byPosition.set(k, {
        index: [i],
        approach: n.approach === true,
        unsure: n.unsure === true,
        shifted,
        name: n.name,
        string: n.position.string,
        fret: n.position.fret,
      });
    }
  });

  ctx.textAlign = 'center';
  for (const d of byPosition.values()) {
    const x = noteX(g, d.fret);
    const y = yOf(layout, d.string);
    const isHot = d.index.includes(hot);
    if (isHot) {
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = colors.hot;
      dot(ctx, x, y, r * (30 / 21));
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    const dim = d.unsure && !isHot;
    ctx.globalAlpha = dim ? 0.4 : 1;
    ctx.fillStyle = isHot ? colors.hot : colors.note;
    dot(ctx, x, y, r);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (d.approach || d.shifted) {
      ctx.strokeStyle = colors.approach;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.fillStyle = dim ? colors.text : colors.onNote;
    ctx.font = `700 ${Math.max(9, 15 * scale)}px system-ui, sans-serif`;
    ctx.fillText(d.name, x, y - scale);
    ctx.font = `700 ${Math.max(7, 10 * scale)}px system-ui, sans-serif`;
    // Up to three plays are listed ("2·4"); more would spill out of the dot, so they are counted.
    ctx.fillText(d.index.length > 3 ? `${d.index.length}×` : d.index.map((i) => i + 1).join('·'), x, y + 13 * scale);
    if (d.unsure) {
      const bx = x + r * 0.8;
      const by = y - r * 0.8;
      ctx.fillStyle = colors.raised;
      dot(ctx, bx, by, 10 * scale);
      ctx.fill();
      ctx.strokeStyle = colors.next;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = colors.text;
      ctx.font = `700 ${Math.max(8, 13 * scale)}px system-ui, sans-serif`;
      ctx.fillText('?', bx, by + 4.5 * scale);
    }
  }
}
