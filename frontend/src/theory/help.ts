// One plain-language line per scale for the Scale finder's help box (D-19):
// what it sounds like and where a player meets it. Chord lists and "same notes
// as" are computed (spell.ts), not written here.
import type { ScaleId } from '../music/spell';

export const SCALE_HELP: Record<ScaleId, string> = {
  major: 'The do-re-mi scale. Bright and settled; most pop and folk melodies live here.',
  minor: 'The natural minor. Darker and sadder than major; the default for rock and pop in a minor key.',
  'major-pentatonic': 'Major without its two half steps, so nothing clashes. Country, soul and happy riffs.',
  'minor-pentatonic': 'Five notes, no half steps, so it is hard to hit a wrong note. The go-to for rock and blues fills and solos.',
  blues: 'Minor pentatonic plus the ♭5 "blue note". Use the ♭5 as a passing note, not a place to rest.',
  dorian: 'Minor with a raised 6th: minor but not sad. Funk, jazz and a lot of classic rock jams.',
  phrygian: 'Minor with a ♭2 that gives a Spanish or metal edge.',
  lydian: 'Major with a ♯4: floating and dreamy. Film scores and some prog.',
  mixolydian: 'Major with a ♭7: bluesy and rocking. Fits dominant 7th chords and a lot of classic rock.',
  locrian: 'The unstable one, built on a diminished chord. Mostly heard over m7♭5 chords.',
  'harmonic-minor': 'Minor with a raised 7th, which makes a strong V chord. Classical and neoclassical metal.',
  'melodic-minor': 'Minor with a raised 6th and 7th. The jazz minor; a smooth line up to the root.',
  'whole-tone': 'Six notes, all a whole step apart. Dreamy and unresolved; fits augmented chords.',
  diminished: 'Whole step, half step, repeating: eight notes. Fits diminished 7th chords.',
};
