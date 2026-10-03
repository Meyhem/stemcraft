// One plain sentence under the Practice screen saying what the exercise is and how to use it (the Theory tab's help box).
import type { InstrumentSettings, PracticeInstrument } from '../api/client';

export function helpFor(instrument: PracticeInstrument, s: InstrumentSettings): string {
  const ref = instrument === 'bass' ? 'reference bass' : 'reference guitar';
  const listen = `Listen to the ${ref} for a pass, press M to mute it, then play it yourself.`;
  switch (s.exercise) {
    case 'groove':
      return instrument === 'bass'
        ? `A bass line over the progression, from Play along's patterns. The approach note falls on the last beat before each chord change. ${listen}`
        : `Chord shapes and a strum over the progression, with a backing bass on the roots. ${listen}`;
    case 'scale':
      return `The scale in one hand position, or two octaves across the neck, walked by the path you choose. ${listen}`;
    case 'arpeggio':
      return `Each chord's tones from its root, cycling to fill the chord's bars. The hand stays as still as it can between chords. ${listen}`;
    case 'drill':
      return 'One finger per fret from the fret you choose, the index finger on the first. Keep every note even before you raise the tempo.';
  }
}
