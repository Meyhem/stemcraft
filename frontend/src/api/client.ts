// Thrown by request() below. Carries the HTTP status alongside the message so
// callers can distinguish "expected" statuses (e.g. a 404 meaning "not
// computed yet") from real failures without parsing the message string.
export class ApiError extends Error {
  status: number;
  /** The response body as the server sent it (FastAPI's is JSON with a `detail`; a proxy's may be empty). */
  body: string;

  constructor(status: number, message: string, body = '') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

// Same-origin by construction (D-15): relative paths only, so dev goes through
// the Vite proxy and prod hits the static mount. No base URL, no CORS.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    // N-08: carry the server's real message to the UI, never a generic one.
    const detail = await response.text();
    throw new ApiError(
      response.status,
      `${init?.method ?? 'GET'} ${path} → ${response.status}: ${detail}`,
      detail,
    );
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

async function upload<T>(path: string, form: FormData): Promise<T> {
  // No content-type header here: the browser sets multipart/form-data with
  // its own boundary, which is why this can't go through request() above.
  const response = await fetch(path, { method: 'POST', body: form });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`POST ${path} → ${response.status}: ${detail}`);
  }
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  upload: <T>(path: string, form: FormData) => upload<T>(path, form),
  del: (path: string) => request<void>(path, { method: 'DELETE' }),
};

export interface DepCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface Health {
  deps: DepCheck[];
  device: string | null;
  fallback_reason: string | null;
  sample_rate: number;
}

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

// D-17: mirrors stemcraft_lib/job_steps.py. Seeded at enqueue, advanced only by the worker.
export type StepState = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'cancelled';

export interface JobStep {
  id: string;
  label: string;
  weight: number;
  state: StepState;
  progress: number;
  detail: string | null;
  started_at: number | null;
  finished_at: number | null;
}

export interface StepDecl {
  id: string;
  label: string;
  weight: number;
}

/** A declared step drawn before its job exists (the Import modal's later groups). */
export function pendingStep(decl: StepDecl): JobStep {
  return { ...decl, state: 'pending', progress: 0, detail: null, started_at: null, finished_at: null };
}

export interface Job {
  id: number;
  song_id: string | null;
  kind: string;
  payload: Record<string, unknown>;
  state: JobState;
  cancel_requested: boolean;
  progress: number;
  device: string | null;
  lease_until: number | null;
  created_at: number | null;
  started_at: number | null;
  finished_at: number | null;
  error: string | null;
  result: Record<string, unknown> | null;
  steps: JobStep[];
}

// Mirrors stemcraft_lib.jobs.JobStats / KindDuration (GET /api/jobs/stats).
export interface KindDuration {
  kind: string;
  device: string | null;
  count: number;
  avg_seconds: number;
}

export interface JobStats {
  passed: number;
  failed: number;
  durations: KindDuration[];
}

// Mirrors packages/stemcraft_lib/src/stemcraft_lib/song.py (Song, StemMix,
// Playback, Loop, Source) — the API's song.json, serialized as-is.
export interface StemMix {
  gain_db: number;
  muted: boolean;
}

export interface Playback {
  tempo: number;
  pitch_semitones: number;
}

export interface Loop {
  name: string;
  start_bar: number;
  end_bar: number;
}

export interface Source {
  kind: 'upload' | 'url';
  value: string;
}

// v3 (D-18). Mirrors PlayAlong in stemcraft_lib/song.py.
export type PatternNotes =
  | 'root'
  | 'root_fifth'
  | 'root_fifth_octave'
  | 'octave_pump'
  | 'triad_chord'
  | 'triad_diatonic'
  | 'seventh';
export type PatternRhythm = 'whole' | 'half' | 'quarter' | 'eighth';
export type PatternApproach = 'none' | 'chromatic' | 'scale' | 'fifth';

export interface PlayAlongKey {
  tonic: string;
  mode: 'major' | 'minor';
}

export interface PlayAlongPattern {
  notes: PatternNotes;
  rhythm: PatternRhythm;
  approach: PatternApproach;
}

export interface PlayAlong {
  /** null = the analysis's top key candidate. */
  key: PlayAlongKey | null;
  pattern: PlayAlongPattern;
}

/** The server's defaults, for fixtures and for code that builds a Song by hand. */
export const DEFAULT_PLAY_ALONG: PlayAlong = {
  key: null,
  pattern: { notes: 'triad_chord', rhythm: 'quarter', approach: 'none' },
};

export interface Song {
  schema_version: number;
  id: string;
  title: string;
  artist: string;
  source: Source;
  created_at: string;
  last_played_at: string | null;
  mix: Record<string, StemMix>;
  playback: Playback;
  loops: Loop[];
  // v2 (Phase 6): the loop currently being practised, the metronome toggle and
  // the count-in length. See stemcraft_lib/song.py.
  active_loop: Loop | null;
  metronome: boolean;
  count_in_bars: number;
  // v3 (D-18): the Play along recipe.
  play_along: PlayAlong;
}

// Same-origin relative paths, like every other path in this module (D-15).
export function songMedia(songId: string) {
  return {
    stem: (name: string) => `/api/songs/${songId}/stems/${name}.opus`,
    peaks: `/api/songs/${songId}/peaks`,
    audio: `/api/songs/${songId}/audio.wav`,
  };
}

// Mirrors stemcraft_lib.export.list_exports and the three export routes in
// stemcraft_api routes/songs.py.
export interface ExportEntry {
  name: string;
  file: string;
  bytes: number;
  modified_at: number;
}

export interface QueuedExport {
  job_id: number;
  name: string;
  file: string;
}

export interface ExportRequest {
  stems: string[];
  // Tempo and pitch only (D7-03): stem gains are the mix and apply either way.
  apply_recipe?: boolean;
  name?: string;
}

export function exportUrl(songId: string, name: string): string {
  return `/api/songs/${songId}/exports/${name}.mp3`;
}

export type SongState = 'imported' | 'separated' | 'analyzed';

// Mirrors Task 9's GET /api/songs entry shape (see stemcraft_api routes/songs.py:_entry):
// a song that fails to parse is still listed, with `unreadable` set and everything else null.
export interface SongEntry {
  dir: string;
  song: Song | null;
  state: SongState | null;
  unreadable: string | null;
  files: {
    has_audio: boolean;
    has_peaks: boolean;
    has_stems: boolean;
    has_analysis: boolean;
  } | null;
}

// Mirrors POST /api/songs/upload and /api/songs/from-url (stemcraft_api
// routes/songs.py): both create the Song and enqueue its import job.
export interface CreatedSong {
  song: Song;
  job_id: number;
}

// Mirrors packages/stemcraft_lib/src/stemcraft_lib/analysis.py.
export interface KeyCandidate {
  tonic: string;
  mode: 'major' | 'minor';
  confidence: number;
}

export interface BeatGrid {
  bpm: number;
  beats: number[];
  downbeats: number[];
}

export interface ChordSegment {
  bar: number;
  start_sample: number;
  end_sample: number;
  chord: string;
}

export interface Analysis {
  schema_version: number;
  key_candidates: KeyCandidate[];
  beat_grid: BeatGrid;
  chords: ChordSegment[];
}

// Mirrors packages/stemcraft_lib/src/stemcraft_lib/album.py. Q-04: an album is
// a standalone document, not a Song — these types share nothing with Song.
export interface AlbumTrack {
  title: string;
}

export interface Album {
  schema_version: number;
  id: string;
  title: string;
  artist: string;
  source_value: string;
  created_at: string;
  total_samples: number;
  // Invariant 4: sample indices at 48 kHz, never float seconds.
  split_points: number[];
  tracks: AlbumTrack[];
}

export type AlbumState = 'uploaded' | 'ready' | 'split';

export interface AlbumFiles {
  has_audio: boolean;
  has_peaks: boolean;
  has_proposals: boolean;
  has_tracks: boolean;
  has_zip: boolean;
}

export interface AlbumEntry {
  dir: string;
  album: Album | null;
  state: AlbumState | null;
  files: AlbumFiles | null;
  unreadable: string | null;
}

// Worker-owned, served separately from album.json (D8-04) so that applying a
// proposal is an explicit action and re-detecting cannot overwrite a drag.
export interface Proposals {
  total_samples: number;
  split_points: number[];
  noise_db: number;
  min_silence_seconds: number;
}

// Mirrors stemcraft_worker.peaks.compute_peaks: min/max pairs per channel at a
// fixed bucket rate. Internal and unversioned by design (tech spec §6) -- this
// worker and this frontend are the only consumers.
export interface PeaksDoc {
  version: number;
  sample_rate: number;
  length: number;
  channels: number;
  buckets_per_second: number;
  peaks: number[][];
}

export interface CreatedAlbum {
  album: Album;
  job_id: number;
}

export interface QueuedSplit {
  job_id: number;
  tracks: number;
}

export interface AlbumTrackFile {
  name: string;
  file: string;
  bytes: number;
}

// Same-origin relative paths, like every other path in this module (D-15).
export function albumMedia(albumId: string) {
  return {
    peaks: `/api/albums/${albumId}/peaks`,
    audio: `/api/albums/${albumId}/audio.wav`,
  };
}

export function albumZipUrl(albumId: string): string {
  return `/api/albums/${albumId}/album.zip`;
}

export function albumTrackUrl(albumId: string, filename: string): string {
  return `/api/albums/${albumId}/tracks/${filename}`;
}

// Mirrors packages/stemcraft_lib/src/stemcraft_lib/theory.py (D-19). The API is
// theory.json's only writer; the browser GETs it and PUTs the whole document.
export type TheoryTool =
  | 'scale-finder' | 'chord-finder' | 'note-finder' | 'name-that-chord'
  | 'scale-positions' | 'triads' | 'arpeggios'
  | 'chords-in-key' | 'circle-of-fifths' | 'progressions' | 'scales-over-chord'
  | 'fretboard-quiz' | 'theory-quiz';

export interface TheoryInstrument {
  kind: 'bass' | 'guitar';
  strings: number;
  /** Scientific pitch, low string first: ["E1", "A1", "D2", "G2"]. */
  tuning: string[];
  left_handed: boolean;
}

export interface FretboardQuizSettings {
  mode: 'name-note' | 'find-note' | 'find-interval' | 'spell-chord';
  /** Rows (0 = highest string); empty = every string. */
  strings: number[];
  frets: [number, number];
  accidentals: boolean;
}

export interface TheoryQuizSettings {
  topics: ('keys' | 'chords' | 'intervals')[];
}

export interface QuizAnswer {
  quiz: 'fretboard' | 'theory';
  mode: string;
  item: string;
  correct: boolean;
  ms: number;
  at: string;
}

export interface TheoryDoc {
  version: 1;
  instrument: TheoryInstrument;
  last_tool: TheoryTool;
  song_id: string | null;
  quiz: {
    settings: { fretboard: FretboardQuizSettings; theory: TheoryQuizSettings };
    history: QuizAnswer[];
  };
}

/** The server's defaults, for "Reset to defaults" after an unreadable theory.json. */
export const DEFAULT_THEORY: TheoryDoc = {
  version: 1,
  instrument: { kind: 'bass', strings: 4, tuning: ['E1', 'A1', 'D2', 'G2'], left_handed: false },
  last_tool: 'scale-finder',
  song_id: null,
  quiz: {
    settings: {
      fretboard: { mode: 'find-note', strings: [], frets: [0, 12], accidentals: false },
      theory: { topics: ['keys', 'chords', 'intervals'] },
    },
    history: [],
  },
};
