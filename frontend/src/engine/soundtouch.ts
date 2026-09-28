/**
 * Pure math for driving SoundTouchNode from a tempo ratio and a user pitch shift.
 * SoundTouchNode's own `playbackRate` param exists to tell its internal pitch
 * compensation the ratio to divide by (see its README) — it does not require a
 * literal upstream AudioBufferSourceNode, only this numeric value.
 */
export interface SoundTouchParams {
  playbackRate: number;
  pitch: number;
  pitchSemitones: number;
}

export function computeSoundTouchParams(tempoRatio: number, pitchSemitonesOffset: number): SoundTouchParams {
  return {
    playbackRate: tempoRatio,
    pitch: 1.0,
    pitchSemitones: pitchSemitonesOffset,
  };
}
