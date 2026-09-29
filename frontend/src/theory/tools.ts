// The Theory tab's tools, in rail order (D-19). The rail, the routes and the
// "last tool" redirect all read this list; a tool exists in the UI exactly when
// it is registered here.
import type { ComponentType } from 'react';

import type { TheoryTool } from '../api/client';
import { Arpeggios } from './tools/Arpeggios';
import { ChordFinder } from './tools/ChordFinder';
import { ChordsInKey } from './tools/ChordsInKey';
import { CircleOfFifthsTool } from './tools/CircleOfFifthsTool';
import { NameThatChord } from './tools/NameThatChord';
import { NoteFinder } from './tools/NoteFinder';
import { ScaleFinder } from './tools/ScaleFinder';
import { ScalePositions } from './tools/ScalePositions';
import { ScalesOverChord } from './tools/ScalesOverChord';
import { Triads } from './tools/Triads';

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
  { slug: 'name-that-chord', label: 'Name that chord', group: 'Find', Component: NameThatChord },
  { slug: 'scale-positions', label: 'Scale positions', group: 'Shapes', Component: ScalePositions },
  { slug: 'triads', label: 'Triads & inversions', group: 'Shapes', Component: Triads },
  { slug: 'arpeggios', label: 'Arpeggios', group: 'Shapes', Component: Arpeggios },
  { slug: 'chords-in-key', label: 'Chords in a key', group: 'Harmony', Component: ChordsInKey },
  { slug: 'circle-of-fifths', label: 'Circle of fifths', group: 'Harmony', Component: CircleOfFifthsTool },
  { slug: 'scales-over-chord', label: 'Scales over a chord', group: 'Harmony', Component: ScalesOverChord },
];

export function toolBySlug(slug: string | undefined): ToolDef | undefined {
  return TOOLS.find((t) => t.slug === slug);
}
