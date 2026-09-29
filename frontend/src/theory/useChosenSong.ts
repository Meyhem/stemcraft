// The song the "from a song" card points at (D-19): theory.json's song_id,
// looked up in the library and read through the existing analysis endpoint.
// Read only; nothing here writes to the song. A missing or unanalysed song is
// its own state with its own message, never a silent switch to another song.
import type { KeyCandidate } from '../api/client';
import { useAnalysis, useSongs } from '../api/queries';
import { analysisChordSymbol, namer, pcOf, rootName, scaleNotes, type KeyMode } from '../music/spell';
import { useTheoryDoc } from './TheoryDoc';

export type ChosenSong =
  | { state: 'none' }
  | { state: 'missing'; songId: string }
  | { state: 'unanalysed'; title: string }
  | { state: 'loading'; title: string }
  | { state: 'error'; title: string; message: string }
  | {
      state: 'ready';
      title: string;
      candidates: KeyCandidate[];
      /** The chord chart as symbols, runs of the same chord merged, N/X dropped. */
      sequence: string[];
      /** Each chord once, in order of first appearance. */
      distinct: string[];
    };

/** A key candidate's root spelled for its mode: "A#" minor -> "Bb". */
export function candidateRoot(c: KeyCandidate): { root: string; mode: KeyMode } {
  return { root: rootName(pcOf(c.tonic)!, c.mode), mode: c.mode };
}

export function useChosenSong(): ChosenSong {
  const { doc } = useTheoryDoc();
  const songs = useSongs();
  const songId = doc?.song_id ?? null;
  const entry = songs.data?.find((e) => e.song?.id === songId);
  const analysed = Boolean(entry?.files?.has_analysis);
  const analysis = useAnalysis(analysed ? songId ?? undefined : undefined);

  if (!songId) return { state: 'none' };
  if (songs.isPending) return { state: 'loading', title: '' };
  if (songs.error) return { state: 'error', title: '', message: songs.error.message };
  if (!entry?.song) return { state: 'missing', songId };
  const title = entry.song.title;
  if (!analysed) return { state: 'unanalysed', title };
  if (analysis.error) return { state: 'error', title, message: analysis.error.message };
  if (!analysis.data) return { state: 'loading', title };

  const candidates = analysis.data.key_candidates;
  const top = candidates[0] ? candidateRoot(candidates[0]) : { root: 'C', mode: 'major' as const };
  const name = namer(scaleNotes(top.root, top.mode === 'minor' ? 'minor' : 'major').map((n) => n.name));
  const sequence: string[] = [];
  for (const seg of analysis.data.chords) {
    const symbol = analysisChordSymbol(seg.chord, name);
    if (symbol && symbol !== sequence[sequence.length - 1]) sequence.push(symbol);
  }
  return { state: 'ready', title, candidates, sequence, distinct: [...new Set(sequence)] };
}
