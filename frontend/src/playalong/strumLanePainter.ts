// The strum lane under the guitar neck (D-20): the current bar and the next as
// boxes split into beats and eighths, one ↓ or ↑ chip per stroke, the stroke
// to play now lit, a push stroke ringed and named after the chord it plays,
// and a cursor sweeping the current bar. The beat lane's layout (beatLanePainter)
// with strokes where it has notes.
import type { GuitarBar } from '../music/guitarSource';
import type { PlayAlongColors } from './colors';

export const STRUM_LANE_H = 96;

export interface StrumLaneBar {
  bar: GuitarBar;
  title: string;
}

export function paintStrumLane(
  ctx: CanvasRenderingContext2D,
  width: number,
  colors: PlayAlongColors,
  current: StrumLaneBar | null,
  next: StrumLaneBar | null,
  beatsPerBar: number,
  frac: number,
  hot: number,
): void {
  ctx.clearRect(0, 0, width, STRUM_LANE_H);
  const boxW = (width - 20) / 2;
  const beatW = boxW / beatsPerBar;
  const chipW = Math.max(22, Math.min(62, beatW / 2 - 8));
  const boxes: [StrumLaneBar | null, boolean][] = [
    [current, false],
    [next, true],
  ];

  boxes.forEach(([lane, isNext], i) => {
    const x0 = 10 + i * boxW;
    ctx.fillStyle = isNext ? colors.ground : colors.raised;
    ctx.fillRect(x0 + 3, 22, boxW - 6, 66);
    ctx.strokeStyle = colors.fret;
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 3, 22, boxW - 6, 66);
    if (!lane) return;

    ctx.textAlign = 'left';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillStyle = isNext ? colors.textDim : colors.text;
    ctx.fillText(lane.title, x0 + 10, 15, boxW - 20);

    ctx.font = '500 11px ui-monospace, monospace';
    ctx.fillStyle = colors.textDim;
    for (let q = 0; q < beatsPerBar; q++) {
      const x = x0 + q * beatW;
      if (q > 0) {
        ctx.beginPath();
        ctx.moveTo(x, 28);
        ctx.lineTo(x, 82);
        ctx.stroke();
      }
      ctx.fillText(String(q + 1), x + 8, 38);
      ctx.fillText('&', x + beatW / 2 + 4, 38);
    }

    ctx.textAlign = 'center';
    lane.bar.strokes.forEach((s, n) => {
      const cx = x0 + s.beat * beatW + beatW / 4;
      ctx.beginPath();
      ctx.roundRect(cx - chipW / 2, 46, chipW, 34, 17);
      if (isNext) {
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = colors.textDim;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = n === hot ? colors.hot : colors.other;
        ctx.fill();
        if (s.early) {
          ctx.strokeStyle = colors.approach;
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }
      const arrow = s.dir === 'down' ? '↓' : '↑';
      // A push names the chord it already plays, if the chip has room.
      const text = !isNext && s.early && lane.bar.pushChord && chipW >= 52 ? `${arrow} ${lane.bar.pushChord}` : arrow;
      ctx.font = `700 ${s.accent ? 24 : 22}px system-ui, sans-serif`;
      ctx.fillStyle = isNext ? colors.textDim : colors.onNote;
      ctx.fillText(text, cx, 71);
    });
  });

  if (current) {
    const x = 10 + frac * boxW;
    ctx.strokeStyle = colors.hot;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, 18);
    ctx.lineTo(x, 92);
    ctx.stroke();
  }
}
