// The Theory tab's tools, in rail order (D-19). The rail, the routes and the
// "last tool" redirect all read this list; a tool exists in the UI exactly when
// it is registered here.
import type { ComponentType } from 'react';

import type { TheoryTool } from '../api/client';
import { ChordFinder } from './tools/ChordFinder';
import { ChordsInKey } from './tools/ChordsInKey';
import { NoteFinder } from './tools/NoteFinder';
import { ScaleFinder } from './tools/ScaleFinder';

export type ToolGroup = 'Find' | 'Shapes' | 'Harmony' | 'Practice';

export interface ToolDef {
  slug: TheoryTool;
  label: string;
  group: ToolGroup;
  Component: ComponentType;
}

export const GROUPS: readonly ToolGroup[] = ['Find', 'Shapes', 'Harmony', 'Practice'];

export const TOOLS: readonly ToolDef[] = [
  { slug: 'scale-finder', label: 'Scale finder', group: 'Find', Component: ScaleFinder },
  { slug: 'chord-finder', label: 'Chord finder', group: 'Find', Component: ChordFinder },
  { slug: 'note-finder', label: 'Note finder', group: 'Find', Component: NoteFinder },
  { slug: 'chords-in-key', label: 'Chords in a key', group: 'Harmony', Component: ChordsInKey },
];

export function toolBySlug(slug: string | undefined): ToolDef | undefined {
  return TOOLS.find((t) => t.slug === slug);
}
