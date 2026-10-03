// The Practice loop as audio for the engine (D-22). Every onset is rounded to an
// integer sample at 48 kHz once, here (invariant 4), and the grid comes from the
// same arithmetic, so the click, the notes and the painters agree to the
// sample. Two silent bars lead in, because the engine's count-in cannot start
// before sample 0 (EngineController.countInAndPlay); the loop is bar 1 to the
// end. Anything that rings past the loop end is folded onto the loop start,
// so the buffer is truly circular and the wrap has no seam (R-01).
import { DEFAULT_INSTRUMENT_SETTINGS, type PracticeBacking } from '../../api/client';
import { STEM_ORDER, SAMPLE_RATE, sampleIndex, type SampleIndex, type StemName } from '../../engine/types';
import type { StemChannels } from '../../engine/loopCursor';
import type { Grid } from '../../music/grid';
import { BEATS_PER_BAR, type PracticeLoop } from '../../music/practice/types';
import { drumHit, drumHits } from './drums';
import { chordHits, keysNote, padNote, voicing } from './pad';
import { bassNote, pluckNote } from './voices';

export const LEAD_IN_BARS = 2;
export const STRUM_STAGGER_FRAMES = Math.round(0.008 * SAMPLE_RATE);
const HEADROOM = 0.98;

export interface RenderedPractice {
  stems: StemChannels[];
  grid: Grid;
  display: Grid;
  loopStart: SampleIndex;
  loopEnd: SampleIndex;
  bpm: number;
}

export function beatFrames(beat: number, bpm: number): number {
  return Math.round((beat * 60 * SAMPLE_RATE) / bpm);
}

function gridOf(barCount: number, firstBar: number, bpm: number): Grid {
  const bars = Array.from({ length: barCount }, (_, b) => sampleIndex(beatFrames((firstBar + b) * BEATS_PER_BAR, bpm)));
  const beats = Array.from({ length: barCount * BEATS_PER_BAR }, (_, k) => sampleIndex(beatFrames(firstBar * BEATS_PER_BAR + k, bpm)));
  return { bars, beats, beatsPerBar: BEATS_PER_BAR, bpm, barCount, medianBarSamples: beatFrames(BEATS_PER_BAR, bpm) };
}

export function renderPractice(
  loop: PracticeLoop,
  bpm: number,
  backing: PracticeBacking = DEFAULT_INSTRUMENT_SETTINGS.backing,
): RenderedPractice {
  const loopBars = loop.bars.length;
  const loopStart = beatFrames(LEAD_IN_BARS * BEATS_PER_BAR, bpm);
  const loopEnd = loopStart + beatFrames(loopBars * BEATS_PER_BAR, bpm);
  const loopLength = loopEnd - loopStart;
  const mono: Record<StemName, Float32Array> = {
    vocals: new Float32Array(loopEnd),
    drums: new Float32Array(loopEnd),
    bass: new Float32Array(loopEnd),
    other: new Float32Array(loopEnd),
  };

  const mix = (into: Float32Array, samples: Float32Array, at: number) => {
    for (let i = 0; i < samples.length; i++) {
      let index = at + i;
      if (index >= loopEnd) index = loopStart + ((index - loopEnd) % loopLength);
      into[index]! += samples[i]!;
    }
  };
  const span = (start: number, dur: number) => {
    const from = beatFrames(start, bpm);
    return { at: loopStart + from, frames: Math.max(1, beatFrames(start + dur, bpm) - from) };
  };

  if (loop.instrument === 'bass') {
    for (const note of loop.notes) {
      const { at, frames } = span(note.start, note.dur);
      mix(mono.bass, bassNote(note.midi, frames), at);
    }
  } else {
    const groups = new Map<number, typeof loop.notes>();
    for (const note of loop.notes) groups.set(note.group, [...(groups.get(note.group) ?? []), note]);
    for (const strum of groups.values()) {
      // A downstroke reaches the low string first, an upstroke the high one.
      const order = [...strum].sort((a, b) => (strum[0]!.stroke === 'up' ? b.string - a.string : a.string - b.string));
      order.forEach((note, k) => {
        const { at, frames } = span(note.start, note.dur);
        const offset = k * STRUM_STAGGER_FRAMES;
        mix(mono.other, pluckNote(note.midi, Math.max(1, frames - offset), note.group * 16 + note.string), at + offset);
      });
    }
    for (const note of loop.backing) {
      const { at, frames } = span(note.start, note.dur);
      mix(mono.bass, bassNote(note.midi, frames), at);
    }
  }

  // Drums, both instruments: one pattern per bar for the whole loop.
  drumHits(backing.drum_groove, loopBars).forEach((hit, k) => {
    mix(mono.drums, drumHit(hit.voice, k + 1), loopStart + beatFrames(hit.beat, bpm));
  });

  // The chord part, bass mode only: in guitar mode `other` is the reference guitar.
  if (loop.instrument === 'bass') {
    const voice = backing.chord_sound === 'pad' ? padNote : keysNote;
    loop.bars.forEach((bar, b) => {
      const notes = bar.chord ? voicing(bar.chord) : null;
      if (!notes) return;
      for (const hit of chordHits(backing.chord_sound)) {
        const { at, frames } = span(b * BEATS_PER_BAR + hit.beat, hit.dur);
        for (const midi of notes) mix(mono.other, voice(midi, frames), at);
      }
    });
  }

  for (const samples of Object.values(mono)) {
    const peak = samples.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    if (peak > HEADROOM) for (let i = 0; i < samples.length; i++) samples[i]! *= HEADROOM / peak;
  }

  return {
    stems: STEM_ORDER.map((name) => ({ left: mono[name], right: mono[name] })),
    grid: gridOf(LEAD_IN_BARS + loopBars, 0, bpm),
    display: gridOf(loopBars, LEAD_IN_BARS, bpm),
    loopStart: sampleIndex(loopStart),
    loopEnd: sampleIndex(loopEnd),
    bpm,
  };
}
