// The shared selection lives in the query string (D-19): root, scale, key mode,
// chord quality, slash bass, a typed chord and Note finder's notes. Every tool
// reads and writes the same parameters, so picking A minor in Scale finder and
// opening Chords in a key shows A minor, and back/forward and bookmarks work.
// theory.json never stores it.
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { isScaleId, pcOf, QUALITIES, scaleDef, type KeyMode, type QualityId, type ScaleId } from '../music/spell';

export interface Selection {
  /** ASCII note name: "A", "Bb", "F#". */
  root: string;
  scale: ScaleId;
  /** Key mode for the key tools; defaults to the scale's own. */
  mode: KeyMode;
  quality: QualityId;
  bass: string | null;
  /** A typed chord symbol that overrides root + quality in Chord finder. */
  chord: string | null;
  /** Note finder's pitch classes. */
  notes: number[];
}

export const DEFAULT_SELECTION: Selection = {
  root: 'C',
  scale: 'major',
  mode: 'major',
  quality: 'maj',
  bass: null,
  chord: null,
  notes: [],
};

const isNote = (s: string | null): s is string => s !== null && /^[A-G](#|b)?$/.test(s) && pcOf(s) !== null;

/** A hand-edited URL with a value no tool knows reads as the default for that value. */
export function parseSelection(params: URLSearchParams): Selection {
  const scaleParam = params.get('scale');
  const scale = scaleParam && isScaleId(scaleParam) ? scaleParam : DEFAULT_SELECTION.scale;
  const modeParam = params.get('mode');
  const q = params.get('q');
  const root = params.get('root');
  const bass = params.get('bass');
  const notes = (params.get('notes') ?? '')
    .split(',')
    .filter((n) => /^\d{1,2}$/.test(n))
    .map(Number)
    .filter((n) => n < 12);
  return {
    root: isNote(root) ? root : DEFAULT_SELECTION.root,
    scale,
    mode: modeParam === 'major' || modeParam === 'minor' ? modeParam : scaleDef(scale).mode,
    quality: QUALITIES.some((x) => x.id === q) ? (q as QualityId) : DEFAULT_SELECTION.quality,
    bass: isNote(bass) ? bass : null,
    chord: params.get('chord') || null,
    notes: [...new Set(notes)],
  };
}

/** Only values that differ from the defaults are written, so URLs stay short. */
export function selectionParams(sel: Selection): URLSearchParams {
  const p = new URLSearchParams();
  if (sel.root !== DEFAULT_SELECTION.root) p.set('root', sel.root);
  if (sel.scale !== DEFAULT_SELECTION.scale) p.set('scale', sel.scale);
  if (sel.mode !== scaleDef(sel.scale).mode) p.set('mode', sel.mode);
  if (sel.quality !== DEFAULT_SELECTION.quality) p.set('q', sel.quality);
  if (sel.bass) p.set('bass', sel.bass);
  if (sel.chord) p.set('chord', sel.chord);
  if (sel.notes.length) p.set('notes', sel.notes.join(','));
  return p;
}

/**
 * The selection after a tool's change. A new root (another pitch, not a respelling) replaces the chord built on the
 * old one: a typed chord and a slash bass the change does not set itself are dropped, or they would go on overriding
 * the newer root in every chord tool.
 */
export function patchSelection(current: Selection, patch: Partial<Selection>): Selection {
  const next = { ...current, ...patch };
  if (patch.root !== undefined && pcOf(patch.root) !== pcOf(current.root)) {
    if (patch.chord === undefined) next.chord = null;
    if (patch.bass === undefined) next.bass = null;
  }
  return next;
}

export function useSelection(): [Selection, (patch: Partial<Selection>) => void] {
  const [params, setParams] = useSearchParams();
  const selection = useMemo(() => parseSelection(params), [params]);
  const update = useCallback(
    (patch: Partial<Selection>) => setParams(selectionParams(patchSelection(parseSelection(params), patch))),
    [params, setParams],
  );
  return [selection, update];
}
