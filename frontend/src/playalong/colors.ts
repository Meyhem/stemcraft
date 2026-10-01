// Canvas colours for Play along. A canvas cannot read var(--ds-*), so every
// token is resolved once from :root (resolveColor), keeping tokens.css the
// single authority (U-02).
import { resolveColor } from '../ui/resolveColor';

export interface PlayAlongColors {
  note: string;
  /** Guitar shapes and strokes: guitar lives in the other stem (U-01, D-20). */
  other: string;
  hot: string;
  approach: string;
  next: string;
  string: string;
  fret: string;
  nut: string;
  label: string;
  board: string;
  onNote: string;
  raised: string;
  ground: string;
  text: string;
  textDim: string;
}

export function playAlongColors(): PlayAlongColors {
  return {
    note: resolveColor('var(--ds-bass)'),
    other: resolveColor('var(--ds-other)'),
    hot: resolveColor('var(--ds-accent)'),
    approach: resolveColor('var(--ds-warn)'),
    next: resolveColor('var(--ds-text-2)'),
    string: resolveColor('var(--ds-text-3)'),
    fret: resolveColor('var(--ds-border-strong)'),
    nut: resolveColor('var(--ds-text)'),
    label: resolveColor('var(--ds-text-3)'),
    board: resolveColor('var(--ds-surface)'),
    onNote: resolveColor('var(--ds-ground)'),
    raised: resolveColor('var(--ds-raised)'),
    ground: resolveColor('var(--ds-ground)'),
    text: resolveColor('var(--ds-text)'),
    textDim: resolveColor('var(--ds-text-3)'),
  };
}
