export interface StemChannels {
  left: Float32Array;
  right: Float32Array;
}

export type FourStems = readonly [StemChannels, StemChannels, StemChannels, StemChannels];

export interface LoopBounds {
  startFrame: number; // device-domain frame index (already converted, Task 6)
  endFrame: number;
}

export interface MixParams {
  /** Linear gain per stem, fixed order [vocals, drums, bass, other]. */
  gains: readonly [number, number, number, number];
  /** Stem-domain samples advanced per output sample. 1.0 = original tempo. */
  readRate: number;
  loop: LoopBounds | null;
  crossfadeFrames: number;
}

export interface CursorState {
  position: number;
}

function readAt(channel: Float32Array, position: number): number {
  const i0 = Math.floor(position);
  const frac = position - i0;
  const s0 = channel[i0] ?? 0;
  const s1 = channel[i0 + 1] ?? s0;
  return s0 + (s1 - s0) * frac;
}

function readStereoMix(stems: FourStems, gains: MixParams['gains'], position: number): [number, number] {
  let left = 0;
  let right = 0;
  for (let i = 0; i < 4; i++) {
    // Non-null: i is always in [0, 4) and both tuples are fixed at exactly 4
    // elements — noUncheckedIndexedAccess can't see that from a loop index.
    const gain = gains[i]!;
    if (gain === 0) continue;
    const stem = stems[i]!;
    left += readAt(stem.left, position) * gain;
    right += readAt(stem.right, position) * gain;
  }
  return [left, right];
}

/**
 * Renders one block into outLeft/outRight, advancing `cursor` in place.
 * Pure function over plain arrays — no AudioContext, no worklet, fully testable.
 */
export function renderBlock(
  stems: FourStems,
  params: MixParams,
  cursor: CursorState,
  outLeft: Float32Array,
  outRight: Float32Array,
): void {
  const frameCount = outLeft.length;
  const loop = params.loop;

  for (let i = 0; i < frameCount; i++) {
    let pos = cursor.position;

    if (!loop) {
      const [l, r] = readStereoMix(stems, params.gains, pos);
      outLeft[i] = l;
      outRight[i] = r;
      cursor.position = pos + params.readRate;
      continue;
    }

    const { startFrame, endFrame } = loop;
    const tailStart = endFrame - params.crossfadeFrames;

    if (pos < tailStart || params.crossfadeFrames <= 0) {
      const [l, r] = readStereoMix(stems, params.gains, pos);
      outLeft[i] = l;
      outRight[i] = r;
    } else {
      const t = (pos - tailStart) / params.crossfadeFrames; // 0 -> 1 across the window
      const [tailL, tailR] = readStereoMix(stems, params.gains, pos);
      const [headL, headR] = readStereoMix(stems, params.gains, startFrame + (pos - tailStart));
      outLeft[i] = tailL * (1 - t) + headL * t;
      outRight[i] = tailR * (1 - t) + headR * t;
    }

    pos += params.readRate;
    if (pos >= endFrame) {
      pos = startFrame + params.crossfadeFrames + (pos - endFrame);
    }
    cursor.position = pos;
  }
}
