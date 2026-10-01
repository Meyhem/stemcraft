import { STEM_ORDER } from '../engine/types';
import { resolveColor } from '../ui/resolveColor';
import { parseHex, type Rgb } from './paint';

/**
 * The stem hues as RGB, STEM_ORDER-indexed. A canvas cannot read var(--ds-*), so
 * they are resolved from the tokens (U-02). Null, with the reason logged, when a
 * token is not #RRGGBB: N-08, no bar rather than a wrong colour.
 */
export function resolveStemColors(owner: string): Rgb[] | null {
  const colors: Rgb[] = [];
  for (const name of STEM_ORDER) {
    const resolved = resolveColor(`var(--ds-${name})`);
    const rgb = parseHex(resolved);
    if (!rgb) {
      console.error(`${owner}: --ds-${name} resolved to "${resolved}", expected #RRGGBB`);
      return null;
    }
    colors.push(rgb);
  }
  return colors;
}
