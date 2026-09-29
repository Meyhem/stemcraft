import { describe, expect, test } from 'vitest';

import { numeralInKey, scalesOverChord } from './harmony';
import { chordInfo, pcOf, QUALITIES, rootName, SCALES, type ChordInfo, type KeyMode, type QualityId } from './spell';

const chord = (s: string): ChordInfo => {
  const r = chordInfo(s);
  if (!r.ok) throw new Error(r.reason);
  return r.chord;
};

// Independent oracle: semitone tables typed out here, so nothing below asks the code under test (or tonal) what a
// chord or a scale contains.
const CHORD_STEPS: Record<QualityId, number[]> = {
  maj: [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], m7b5: [0, 3, 6, 10],
  dim: [0, 3, 6], dim7: [0, 3, 6, 9], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7], '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9], '9': [0, 4, 7, 10, 2], add9: [0, 4, 7, 2],
};
const SCALE_STEPS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], 'major-pentatonic': [0, 2, 4, 7, 9],
  'minor-pentatonic': [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10], 'harmonic-minor': [0, 2, 3, 5, 7, 8, 11], 'melodic-minor': [0, 2, 3, 5, 7, 9, 11],
  'whole-tone': [0, 2, 4, 6, 8, 10], diminished: [0, 2, 3, 5, 6, 8, 9, 11],
};
const mod12 = (n: number) => ((n % 12) + 12) % 12;
const ROOTS = Array.from({ length: 12 }, (_, pc) => rootName(pc, 'major'));

describe('scalesOverChord', () => {
  test('scales over a chord, safest first', () => {
    expect(scalesOverChord(chord('Am7')).map((s) => s.label)).toEqual([
      'A minor pentatonic', 'A blues', 'A minor', 'A dorian', 'A phrygian',
    ]);
    expect(scalesOverChord(chord('G7')).map((s) => s.label)).toEqual(['G mixolydian']);
  });

  test('the oracle knows every scale in SCALES, so a new scale cannot slip past the property test', () => {
    expect(Object.keys(SCALE_STEPS).sort()).toEqual(SCALES.map((s) => s.id).sort());
  });

  test('all 12 roots x every quality: exactly the scales on the root that hold every tone, fewest notes first, then SCALES order', () => {
    for (const root of ROOTS) {
      for (const q of QUALITIES) {
        const c = chord(`${root}${q.suffix}`);
        const rootPc = pcOf(root)!;
        const tones = CHORD_STEPS[q.id].map((s) => mod12(rootPc + s));
        const expected = SCALES.map((def, order) => ({ id: def.id, order, pcs: new Set(SCALE_STEPS[def.id]!.map((s) => mod12(rootPc + s))) }))
          .filter(({ pcs }) => tones.every((t) => pcs.has(t)))
          .sort((a, b) => a.pcs.size - b.pcs.size || a.order - b.order);
        const got = scalesOverChord(c);
        expect(got.map((f) => f.scale), `${root}${q.suffix}`).toEqual(expected.map((e) => e.id));
        for (const fit of got) {
          expect(fit.root).toBe(c.root);
          expect(pcOf(fit.root)).toBe(rootPc);
          expect(fit.label).toBe(`${c.root} ${SCALES.find((s) => s.id === fit.scale)!.label.toLowerCase()}`);
        }
      }
    }
  });

  test('some chords fit no scale in the list, and say so with an empty list', () => {
    expect(scalesOverChord(chord('C7#9b13'))).toEqual([]);
  });

  test('a slash bass does not change the scales: they are chosen for the chord above it', () => {
    expect(scalesOverChord(chord('Am7/G'))).toEqual(scalesOverChord(chord('Am7')));
  });
});

// The seven diatonic triads and sevenths of a key, from semitone tables typed out here.
const NUMERAL_WORDS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const KEY_STEPS: Record<KeyMode, number[]> = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
const SUFFIX: Record<string, string> = { '4,7': '', '3,7': 'm', '3,6': 'dim' };

/** What the seven degrees of a key are: root pc, numeral, the triad's suffix and the common seventh's suffix. */
function degrees(tonicPc: number, mode: KeyMode) {
  const s = KEY_STEPS[mode];
  return s.map((step, d) => {
    const third = mod12(s[(d + 2) % 7]! - step);
    const fifth = mod12(s[(d + 4) % 7]! - step);
    const seventh = mod12(s[(d + 6) % 7]! - step);
    const kind = `${third},${fifth}`;
    const numeral = third === 4 ? NUMERAL_WORDS[d]! : `${NUMERAL_WORDS[d]!.toLowerCase()}${fifth === 6 ? '°' : ''}`;
    const sevenths = kind === '4,7' ? (seventh === 11 ? 'maj7' : '7') : kind === '3,7' ? 'm7' : 'm7b5';
    return { pc: mod12(tonicPc + step), numeral, triad: SUFFIX[kind]!, seventh: sevenths, triadSteps: [0, third, fifth] };
  });
}

const TONICS = Array.from({ length: 12 }, (_, pc) => pc);
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

describe('numeralInKey', () => {
  test('numerals in a key, or null when borrowed', () => {
    expect(numeralInKey('G', 'major', 'Em7')).toBe('vi');
    expect(numeralInKey('G', 'major', 'D7')).toBe('V');
    expect(numeralInKey('G', 'major', 'Bb')).toBeNull();
    expect(numeralInKey('G', 'major', 'Cm')).toBeNull();
    expect(numeralInKey('E', 'minor', 'C')).toBe('VI');
  });

  test('every diatonic triad and common seventh gets its degree numeral, in all 12 tonics, both modes, both spellings', () => {
    for (const mode of ['major', 'minor'] as const) {
      for (const tonicPc of TONICS) {
        for (const names of [SHARP_NAMES, FLAT_NAMES]) {
          const tonic = names[tonicPc]!;
          for (const d of degrees(tonicPc, mode)) {
            for (const [name, suffix] of [['triad', d.triad], ['seventh', d.seventh]] as const) {
              for (const rootNames of [SHARP_NAMES, FLAT_NAMES]) {
                const symbol = `${rootNames[d.pc]!}${suffix}`;
                expect(numeralInKey(tonic, mode, symbol), `${symbol} in ${tonic} ${mode} (${name})`).toBe(d.numeral);
              }
            }
          }
        }
      }
    }
  });

  test('a whole grid of roots x qualities: diatonic, sus on a degree, or the minor-key V and vii°, else null', () => {
    for (const mode of ['major', 'minor'] as const) {
      for (const tonicPc of TONICS) {
        for (const names of [SHARP_NAMES, FLAT_NAMES]) {
          const tonic = names[tonicPc]!;
          const key = new Set(KEY_STEPS[mode].map((s) => mod12(tonicPc + s)));
          const keyPlusRaised = new Set([...key, mod12(tonicPc + 11)]);
          const degs = degrees(tonicPc, mode);
          for (const rootPc of TONICS) {
            for (const q of QUALITIES) {
              const tones = CHORD_STEPS[q.id].map((s) => mod12(rootPc + s));
              const holds = (steps: number[]) => steps.every((s) => tones.includes(mod12(rootPc + s)));
              const deg = degs.find((d) => d.pc === rootPc);
              let expected: string | null = null;
              if (deg && tones.every((t) => key.has(t)) && holds(deg.triadSteps)) expected = deg.numeral;
              else if (deg && (q.id === 'sus2' || q.id === 'sus4') && tones.every((t) => key.has(t))) expected = `${deg.numeral.replace('°', '')}${q.id}`;
              else if (mode === 'minor' && tones.every((t) => keyPlusRaised.has(t))) {
                if (rootPc === mod12(tonicPc + 7) && holds([0, 4, 7])) expected = 'V';
                else if (rootPc === mod12(tonicPc + 11) && holds([0, 3, 6])) expected = 'vii°';
              }
              const symbol = `${(names === SHARP_NAMES ? FLAT_NAMES : SHARP_NAMES)[rootPc]!}${q.suffix}`;
              expect(numeralInKey(tonic, mode, symbol), `${symbol} in ${tonic} ${mode}`).toBe(expected);
            }
          }
        }
      }
    }
  });

  test('sus chords whose tones are all in the key take the degree numeral and the sus', () => {
    expect(numeralInKey('C', 'major', 'Dsus4')).toBe('iisus4');
    expect(numeralInKey('C', 'major', 'Csus2')).toBe('Isus2');
    expect(numeralInKey('C', 'major', 'Gsus4')).toBe('Vsus4');
    expect(numeralInKey('A', 'minor', 'Esus4')).toBe('vsus4');
    expect(numeralInKey('A', 'minor', 'Dsus2')).toBe('ivsus2');
    expect(numeralInKey('A', 'minor', 'Bsus2')).toBeNull(); // C# is outside A minor
    expect(numeralInKey('C', 'major', 'Fsus4')).toBeNull(); // Bb
  });

  test('minor keys: the major V and the diminished leading-tone chord are diatonic, Em stays v', () => {
    expect(numeralInKey('A', 'minor', 'E')).toBe('V');
    expect(numeralInKey('A', 'minor', 'E7')).toBe('V');
    expect(numeralInKey('A', 'minor', 'G#dim')).toBe('vii°');
    expect(numeralInKey('A', 'minor', 'G#dim7')).toBe('vii°');
    expect(numeralInKey('A', 'minor', 'Em')).toBe('v');
    expect(numeralInKey('A', 'minor', 'Em7')).toBe('v');
    expect(numeralInKey('C', 'minor', 'G')).toBe('V');
    expect(numeralInKey('C', 'minor', 'G7')).toBe('V');
    expect(numeralInKey('C', 'minor', 'Bdim')).toBe('vii°');
    expect(numeralInKey('C', 'minor', 'Bdim7')).toBe('vii°');
    // Not the harmonic-minor chords: the half-diminished, the augmented III and i(maj7) stay borrowed.
    expect(numeralInKey('A', 'minor', 'G#m7b5')).toBeNull();
    expect(numeralInKey('A', 'minor', 'Caug')).toBeNull();
    expect(numeralInKey('A', 'minor', 'AmMaj7')).toBeNull();
    // A major key has no raised-seventh rule.
    expect(numeralInKey('C', 'major', 'G#dim')).toBeNull();
  });

  test('secondary dominants and other chords outside the key are null', () => {
    expect(numeralInKey('C', 'major', 'C7')).toBeNull();
    expect(numeralInKey('C', 'major', 'A7')).toBeNull();
    expect(numeralInKey('C', 'major', 'E7')).toBeNull();
  });

  test('enharmonic tonics give identical numerals for the new forms too', () => {
    for (const [a, b] of [['G#', 'Ab'], ['F#', 'Gb'], ['C#', 'Db'], ['D#', 'Eb'], ['A#', 'Bb']] as const) {
      for (const mode of ['major', 'minor'] as const) {
        for (const rootPc of TONICS) {
          for (const q of ['sus2', 'sus4', 'maj', '7', 'dim', 'dim7']) {
            const suffix = QUALITIES.find((x) => x.id === q)!.suffix;
            const symbol = `${SHARP_NAMES[rootPc]!}${suffix}`;
            expect(numeralInKey(a, mode, symbol), `${symbol} in ${a}/${b} ${mode}`).toBe(numeralInKey(b, mode, symbol));
          }
        }
      }
    }
  });

  test('borrowed chords are null: bVII, iv, bIII, bVI in major; the major IV in minor', () => {
    expect(numeralInKey('C', 'major', 'Bb')).toBeNull();
    expect(numeralInKey('C', 'major', 'Fm')).toBeNull();
    expect(numeralInKey('C', 'major', 'Eb')).toBeNull();
    expect(numeralInKey('C', 'major', 'Ab')).toBeNull();
    expect(numeralInKey('A', 'minor', 'D')).toBeNull();
    // Diatonic in the other mode, so a numeral there.
    expect(numeralInKey('C', 'minor', 'Bb')).toBe('VII');
    expect(numeralInKey('C', 'minor', 'Eb')).toBe('III');
  });

  test('a dominant seventh off the dominant, or any chord with a note outside the key, is borrowed', () => {
    expect(numeralInKey('C', 'major', 'C7')).toBeNull();
    expect(numeralInKey('C', 'major', 'G7')).toBe('V');
    expect(numeralInKey('C', 'major', 'Cm7')).toBeNull();
    expect(numeralInKey('C', 'major', 'Dm')).toBe('ii');
  });

  test('an unreadable chord is null, never a numeral', () => {
    expect(numeralInKey('C', 'major', 'Xyz')).toBeNull();
    expect(numeralInKey('C', 'major', '')).toBeNull();
  });

  test('an inversion has the numeral of its chord', () => {
    expect(numeralInKey('C', 'major', 'C/E')).toBe('I');
    expect(numeralInKey('G', 'major', 'Em7/D')).toBe('vi');
  });
});
