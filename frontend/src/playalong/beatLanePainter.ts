// The beat lane under the neck (D-18): the current bar and the next as boxes
// divided into beats, one chip per note at its rhythmic position, and a cursor
// sweeping the current bar. It gives the rhythm the neck cannot show: roots in
// quarters and an octave pump in eighths look alike on a neck.
import type { PlacedBar } from '../music/fingering';
import type { PlayAlongColors } from './colors';

export const LANE_H = 92;

export interface LaneBar {
  bar: PlacedBar;
  title: string;
}

export function paintBeatLane(
  ctx: CanvasRenderingContext2D,
  width: number,
  colors: PlayAlongColors,
  current: LaneBar | null,
  next: LaneBar | null,
  beatsPerBar: number,
  frac: number,
  hot: number,
): void {
  ctx.clearRect(0, 0, width, LANE_H);
  const boxW = (width - 20) / 2;
  const boxes: [LaneBar | null, boolean][] = [
    [current, false],
    [next, true],
  ];

  boxes.forEach(([lane, isNext], i) => {
    const x0 = 10 + i * boxW;
    ctx.fillStyle = isNext ? colors.ground : colors.raised;
    ctx.fillRect(x0 + 3, 22, boxW - 6, 62);
    ctx.strokeStyle = colors.fret;
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 3, 22, boxW - 6, 62);
    if (!lane) return;

    ctx.textAlign = 'left';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillStyle = isNext ? colors.textDim : colors.text;
    ctx.fillText(lane.title, x0 + 10, 15, boxW - 20);

    for (let q = 1; q < beatsPerBar; q++) {
      const x = x0 + (q * boxW) / beatsPerBar;
      ctx.beginPath();
      ctx.moveTo(x, 28);
      ctx.lineTo(x, 78);
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.font = '700 15px system-ui, sans-serif';
    lane.bar.notes.forEach((note, n) => {
      const x = x0 + (note.beat / beatsPerBar) * boxW + 6;
      const w = Math.max(18, (note.beats / beatsPerBar) * boxW - 12);
      ctx.beginPath();
      ctx.roundRect(x, 37, w, 32, 16);
      if (isNext) {
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = colors.textDim;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = n === hot ? colors.hot : colors.note;
        ctx.fill();
        if (note.approach) {
          ctx.strokeStyle = colors.approach;
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }
      const label = isNext ? note.name : `${n + 1} · ${note.name}`;
      // A chip too narrow for its number (eighths on a phone) keeps just the name.
      const text = !isNext && w < 64 ? note.name : label;
      ctx.fillStyle = isNext ? colors.textDim : colors.onNote;
      ctx.fillText(text, x + w / 2, 58);
    });
  });

  if (current) {
    const x = 10 + frac * boxW;
    ctx.strokeStyle = colors.hot;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, 18);
    ctx.lineTo(x, 88);
    ctx.stroke();
  }
}
