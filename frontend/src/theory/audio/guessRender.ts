// Guess the note's sound (D-23): the question as four stem-shaped buffers at
// 48 kHz for the engine, in the Practice tab's voices (D-22). The voice sits in
// the slot Practice uses for that instrument; the other slots are silent. With
// a reference, the A rings, a short silence follows, then the target.
import type { StemChannels } from '../../engine/loopCursor';
import { SAMPLE_RATE, STEM_ORDER, type StemName } from '../../engine/types';
import { bassNote, pluckNote } from '../../practice/audio/voices';

export const REFERENCE_FRAMES = Math.round(0.8 * SAMPLE_RATE);
const GAP_FRAMES = Math.round(0.25 * SAMPLE_RATE);
export const TARGET_FRAMES = Math.round(1.4 * SAMPLE_RATE);
/** Where the target starts when an A is played first. The A's release ends inside the gap. */
export const TARGET_AT = REFERENCE_FRAMES + GAP_FRAMES;

export const VOICE_SLOT: Record<'bass' | 'guitar', StemName> = { bass: 'bass', guitar: 'other' };

/** A note rings on well past its length (the bass has barely decayed), so the voice's own 30 ms release would chop it. */
const FADE_FRAMES = Math.round(0.3 * SAMPLE_RATE);

function voice(kind: 'bass' | 'guitar', midi: number, frames: number): Float32Array {
  // The pluck's noise is seeded by the pitch, so a replay sounds the same.
  const note = kind === 'bass' ? bassNote(midi, frames) : pluckNote(midi, frames, midi);
  const from = Math.max(0, note.length - FADE_FRAMES);
  for (let i = from; i < note.length; i++) note[i]! *= 0.5 * (1 + Math.cos((Math.PI * (i - from)) / (note.length - from)));
  return note;
}

export function renderGuess(kind: 'bass' | 'guitar', target: number, reference: number | null): StemChannels[] {
  const at = reference === null ? 0 : TARGET_AT;
  const note = voice(kind, target, TARGET_FRAMES);
  const mono = new Float32Array(at + note.length);
  if (reference !== null) mono.set(voice(kind, reference, REFERENCE_FRAMES), 0);
  mono.set(note, at);
  // Each channel its own buffer: the engine transfers them to the worklet.
  return STEM_ORDER.map((name) =>
    name === VOICE_SLOT[kind]
      ? { left: mono, right: mono.slice() }
      : { left: new Float32Array(mono.length), right: new Float32Array(mono.length) },
  );
}
