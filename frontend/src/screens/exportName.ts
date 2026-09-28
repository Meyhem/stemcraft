// The proposed file name, as a pure function. The server slugifies whatever it
// receives (stemcraft_lib.export.export_name), so this is a courtesy rather than
// a validator -- but it is the name the user sees in the field before they queue,
// and "tightrope-no-bass-82" says more at a glance than "export".
import { STEM_ORDER, type StemName } from '../engine/types';

export interface NameRecipe {
  tempo: number;
  pitchSemitones: number;
}

/** Matches stemcraft_lib.ids.slugify closely enough for a proposal: NFKD, drop
 * non-ASCII, collapse everything outside [a-z0-9] to a single hyphen. */
function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function proposeExportName(
  title: string,
  stems: readonly StemName[],
  recipe: NameRecipe,
): string {
  const picked = STEM_ORDER.filter((name) => stems.includes(name));
  const parts = [slugify(title) || 'export'];

  if (picked.length === 1) {
    parts.push(`${picked[0]}-only`);
  } else if (picked.length === STEM_ORDER.length - 1) {
    const missing = STEM_ORDER.find((name) => !picked.includes(name));
    if (missing) parts.push(`no-${missing}`);
  } else if (picked.length < STEM_ORDER.length) {
    parts.push(...picked);
  }

  if (recipe.tempo !== 1) parts.push(String(Math.round(recipe.tempo * 100)));
  if (recipe.pitchSemitones !== 0) {
    // "plus3st" rather than "+3st": the server's slug alphabet has no "+", and a
    // bare "-3st" would be indistinguishable from the hyphen joining the parts.
    const sign = recipe.pitchSemitones > 0 ? 'plus' : '';
    parts.push(`${sign}${Math.abs(recipe.pitchSemitones)}st`);
  }

  return parts.join('-');
}
