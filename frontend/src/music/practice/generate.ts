// One entry point for the Practice screen (D-22): settings in, a loop or a
// reason it cannot be played (with fixes) out.
import type { InstrumentSettings, PracticeInstrument } from '../../api/client';
import { arpeggioLine } from './arpeggio';
import { drillLine } from './drill';
import { bassGroove, guitarGroove } from './groove';
import { scaleLine } from './scale';
import type { GenerateResult } from './types';

export function generate(instrument: PracticeInstrument, settings: InstrumentSettings): GenerateResult {
  switch (settings.exercise) {
    case 'groove':
      return instrument === 'bass' ? bassGroove(settings) : guitarGroove(settings);
    case 'scale':
      return scaleLine(settings, instrument);
    case 'arpeggio':
      return arpeggioLine(settings, instrument);
    case 'drill':
      return drillLine(settings, instrument);
  }
}

/** Whether Regenerate (a new seed) changes anything: only bass approaches and drill permutations are random. */
export function regenerable(instrument: PracticeInstrument, settings: InstrumentSettings): boolean {
  if (settings.exercise === 'groove') return instrument === 'bass' && settings.groove.approach !== 'none';
  return settings.exercise === 'drill' && settings.drill.drill === 'permutations';
}
