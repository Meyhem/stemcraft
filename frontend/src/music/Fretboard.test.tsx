import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { Fretboard } from './Fretboard';
import { BASS_TUNING, pitchClassOf, scaleSemitones } from './theory';

function scaleSet(tonic: string, mode: 'major' | 'minor') {
  const tonicPc = pitchClassOf(tonic);
  return new Set(scaleSemitones(mode, false).map((s) => (tonicPc + s) % 12));
}

test('renders an svg with role img labelled by the key', () => {
  render(<Fretboard tuning={BASS_TUNING} tonic="G" mode="minor" scaleNotes={scaleSet('G', 'minor')} />);
  expect(screen.getByRole('img', { name: /G minor fretboard/i })).toBeInTheDocument();
});

test('marks the open low-E string as a scale note in G minor (E is not in G minor)', () => {
  // Sanity check on the fixture itself: G natural minor is G,A,Bb,C,D,Eb,F --
  // no E -- so the open low string (E) should NOT get a note marker.
  const { container } = render(
    <Fretboard tuning={BASS_TUNING} tonic="G" mode="minor" scaleNotes={scaleSet('G', 'minor')} />,
  );
  const labels = Array.from(container.querySelectorAll('text')).map((el) => el.textContent);
  expect(labels).not.toContain('E');
  expect(labels).toContain('G');
});
