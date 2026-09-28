// Thrown by request() below. Carries the HTTP status alongside the message so
// callers can distinguish "expected" statuses (e.g. a 404 meaning "not
// computed yet") from real failures without parsing the message string.
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
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
