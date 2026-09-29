// Quiz questions and the weak-spot weighting (D-19). Pure: every random choice
// goes through an injected Rng, so a seeded test sees the same round every
// time. Stats are derived from the answer history on every call and never
// stored, the same rule as song state.
import { Interval, Note } from 'tonal';

import type { QuizAnswer } from '../api/client';
import { mod12 } from './chordTones';
import { positionAt, rowMidi, type Cell } from './positions';
import { chordInfo, keyChords, keySignature, pcOf, pretty, relativeKey, rootName } from './spell';
import { neckFrets, type Instrument } from './tuning';

export type Rng = () => number;

/** Small, fast, seedable. Tests pass a seed; the app seeds from Date.now(). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type QuizKind = 'fretboard' | 'theory';
export type FretboardMode = 'name-note' | 'find-note' | 'find-interval' | 'spell-chord';
export type TheoryTopic = 'keys' | 'chords' | 'intervals';

/** One first-try answer, as theory.json stores it. */
export type Answer = QuizAnswer;

export const WINDOW = 5;
const SLOW_MS = 6000;

/** 0.6 · wrong rate + 0.4 · slowness (average time over 6 s counts as fully slow) of these answers. */
function score(answers: readonly Answer[]): number {
  const wrong = answers.filter((a) => !a.correct).length / answers.length;
  const avgMs = answers.reduce((s, a) => s + a.ms, 0) / answers.length;
  return 0.6 * wrong + 0.4 * Math.min(Math.max(avgMs / SLOW_MS, 0), 1);
}

/** 0 (strong) … 1 (weak) from the last 5 answers; never asked = 1. */
export function weakness(history: readonly Answer[], quiz: QuizKind, mode: string, item: string): number {
  const last = history.filter((a) => a.quiz === quiz && a.mode === mode && a.item === item).slice(-WINDOW);
  return last.length === 0 ? 1 : score(last);
}

/** Picks an item, weak ones more often, never `previous` twice in a row. */
export function pickItem(items: readonly string[], weight: (item: string) => number, rng: Rng, previous?: string): string {
  if (items.length === 0) throw new Error('No items to pick from');
  const others = items.filter((i) => i !== previous);
  const pool = others.length > 0 ? others : [...items];
  const weights = pool.map((i) => 0.15 + weight(i));
  let r = rng() * weights.reduce((s, w) => s + w, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]!;
    if (r < 0) return pool[i]!;
  }
  return pool[pool.length - 1]!;
}

/** "Practise these": keep only the listed items, unless that would leave none. */
export function restrict(items: readonly string[], only?: readonly string[]): string[] {
  if (!only?.length) return [...items];
  const kept = items.filter((i) => only.includes(i));
  return kept.length ? kept : [...items];
}

export function shuffle<T>(xs: readonly T[], rng: Rng): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ---------------------------------------------------------------- fretboard

export interface FretboardFocus {
  /** Rows to ask about; empty = every string. */
  strings: number[];
  frets: [number, number];
  accidentals: boolean;
}

/** A focus that leaves no question to ask. Callers show `message` as it is (N-08); never swap in another focus. */
export class QuizFocusError extends Error {
  constructor() {
    super('No notes to ask about: the chosen strings, frets and accidentals leave nothing on this neck. Widen the fret range or allow accidentals.');
    this.name = 'QuizFocusError';
  }
}

export const cellKey = (c: Cell) => `s${c.string}f${c.fret}`;

export function parseCellKey(key: string): Cell | null {
  const m = /^s(\d+)f(\d+)$/.exec(key);
  return m ? { string: Number(m[1]), fret: Number(m[2]) } : null;
}

const NATURAL = new Set([0, 2, 4, 5, 7, 9, 11]);

/** The focus's fret range clipped to the neck the tools draw (0–15 bass, 0–17 guitar). Empty when lo > hi. */
export function focusFrets(inst: Instrument, focus: FretboardFocus): [number, number] {
  return [Math.max(0, Math.ceil(focus.frets[0])), Math.min(neckFrets(inst), Math.floor(focus.frets[1]))];
}

/**
 * The cells the focus allows: chosen strings × fret range, naturals only unless
 * accidentals. Strings this instrument does not have and frets past the neck
 * are not cells, so a focus saved for another instrument cannot yield one.
 */
export function focusCells(inst: Instrument, focus: FretboardFocus): Cell[] {
  const count = rowMidi(inst).length;
  const wanted = focus.strings.length ? focus.strings : Array.from({ length: count }, (_, i) => i);
  const rows = [...new Set(wanted)].filter((s) => Number.isInteger(s) && s >= 0 && s < count);
  const [lo, hi] = focusFrets(inst, focus);
  const out: Cell[] = [];
  for (const string of rows) {
    for (let fret = lo; fret <= hi; fret++) {
      const p = positionAt(inst, { string, fret });
      if (focus.accidentals || NATURAL.has(p.pc)) out.push({ string, fret });
    }
  }
  return out;
}

export const INTERVALS = [
  { name: '3m', label: 'minor 3rd' },
  { name: '3M', label: 'major 3rd' },
  { name: '4P', label: '4th' },
  { name: '5P', label: '5th' },
  { name: '7m', label: '♭7' },
  { name: '8P', label: 'octave' },
] as const;

export type FretboardQuestion =
  | { mode: 'name-note'; item: string; cell: Cell; answerPc: number; prompt: string }
  | { mode: 'find-note'; item: string; pc: number; targets: Cell[]; prompt: string }
  | { mode: 'find-interval'; item: string; cell: Cell; answerPc: number; prompt: string }
  | { mode: 'spell-chord'; item: string; symbol: string; window: [number, number]; targets: Cell[]; prompt: string };

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** A name for a pitch class a player would use without a key: naturals, then sharps (F♯, C♯, G♯) or flats (B♭, E♭). */
export function plainName(pc: number): string {
  return ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'][mod12(pc)]!;
}

export function fretboardQuestion(
  mode: FretboardMode,
  inst: Instrument,
  focus: FretboardFocus,
  history: readonly Answer[],
  rng: Rng,
  previous?: string,
  only?: readonly string[],
): FretboardQuestion {
  const cells = focusCells(inst, focus);
  if (mode !== 'spell-chord' && cells.length === 0) throw new QuizFocusError();
  const weight = (item: string) => weakness(history, 'fretboard', mode, item);
  if (mode === 'find-note') {
    const pcs = [...new Set(cells.map((c) => positionAt(inst, c).pc))].map((pc) => `n${pc}`);
    const item = pickItem(restrict(pcs, only), weight, rng, previous);
    const pc = Number(item.slice(1));
    const targets = cells.filter((c) => positionAt(inst, c).pc === pc);
    return { mode, item, pc, targets, prompt: `Find every ${pretty(plainName(pc))}` };
  }
  if (mode === 'spell-chord') {
    // The window is 4 frets wide (fewer if the range is) and spans every string; chord tones outside the focus's accidentals still count.
    const [flo, fhi] = focusFrets(inst, focus);
    if (flo > fhi) throw new QuizFocusError();
    const width = Math.min(4, fhi - flo + 1);
    const lo = flo + Math.floor(rng() * (fhi - flo - width + 2));
    const window: [number, number] = [lo, lo + width - 1];
    const rows = rowMidi(inst).map((_, i) => i);
    const inWindow = rows.flatMap((string) => Array.from({ length: width }, (_, i) => ({ string, fret: lo + i })));
    const targetsOf = (symbol: string): Cell[] => {
      const info = chordInfo(symbol);
      if (!info.ok) throw new Error(`Quiz chord ${symbol} is not readable: ${info.reason}`);
      const tones = new Set(info.chord.notes.map((n) => n.pc));
      return inWindow.filter((c) => tones.has(positionAt(inst, c).pc));
    };
    // A chord with no tone in the window would be an unanswerable question.
    const symbols = LETTERS.flatMap((l) => [l, `${l}m`]).filter((symbol) => targetsOf(symbol).length > 0);
    if (symbols.length === 0) throw new QuizFocusError();
    const item = pickItem(restrict(symbols, only), weight, rng, previous);
    const prompt = `Tap the notes of ${pretty(item)} in ${window[0] === window[1] ? `fret ${window[0]}` : `frets ${window[0]}–${window[1]}`}`;
    return { mode, item, symbol: item, window, targets: targetsOf(item), prompt };
  }
  const item = pickItem(restrict(cells.map(cellKey), only), weight, rng, previous);
  const cell = parseCellKey(item)!;
  const pc = positionAt(inst, cell).pc;
  if (mode === 'name-note') return { mode, item, cell, answerPc: pc, prompt: 'Name this note' };
  const interval = INTERVALS[Math.floor(rng() * INTERVALS.length)]!;
  const answerPc = mod12(pc + Interval.get(interval.name).semitones!);
  return { mode, item, cell, answerPc, prompt: `Tap the ${interval.label} above this note` };
}

// ---------------------------------------------------------------- theory

export interface TheoryQuestion {
  topic: TheoryTopic;
  item: string;
  prompt: string;
  options: string[];
  answer: number;
}

const MAJOR_KEYS = Array.from({ length: 12 }, (_, pc) => rootName(pc, 'major'));
const QUALITY = ['', 'm', '7', 'maj7', 'm7'];
const TOPIC_OF: Record<string, TheoryTopic> = { v: 'keys', rel: 'keys', sig: 'keys', notes: 'chords', name: 'chords', ivl: 'intervals' };

/** Every fact the theory quiz can ask about, as stable item keys. */
export function theoryItems(topics: readonly TheoryTopic[]): string[] {
  const items: string[] = [];
  for (const key of MAJOR_KEYS) items.push(`v:${key}`, `rel:${key}`, `sig:${key}`);
  for (const key of MAJOR_KEYS) for (const q of QUALITY) items.push(`notes:${key}${q}`, `name:${key}${q}`);
  for (const from of LETTERS) for (const iv of INTERVAL_NAMES) items.push(`ivl:${from}:${iv}`);
  return items.filter((i) => topics.includes(TOPIC_OF[i.split(':')[0]!]!));
}

const INTERVAL_NAMES = ['2m', '2M', '3m', '3M', '4P', '5d', '5P', '6m', '6M', '7m', '7M'];
const CHORD_NAMES = new Set(MAJOR_KEYS.flatMap((key) => QUALITY.map((q) => `${key}${q}`)));

/** Items are keys the history is stored under; one that is not on the list is a bug, not a question to improvise. */
function unknownItem(item: string): never {
  throw new Error(`Unknown quiz item "${item}"`);
}

const IVL_LABEL: Record<string, string> = {
  '2m': 'minor 2nd', '2M': 'major 2nd', '3m': 'minor 3rd', '3M': 'major 3rd', '4P': 'perfect 4th', '5d': 'tritone',
  '5P': 'perfect 5th', '6m': 'minor 6th', '6M': 'major 6th', '7m': 'minor 7th', '7M': 'major 7th',
};

function sigText(key: string): string {
  const { accidentals, sharps } = keySignature(key, 'major');
  if (accidentals.length === 0) return 'no sharps or flats';
  const n = accidentals.length;
  return `${n} ${sharps ? (n === 1 ? 'sharp' : 'sharps') : n === 1 ? 'flat' : 'flats'}`;
}

function notesText(symbol: string): string {
  const info = chordInfo(symbol);
  if (!info.ok) throw new Error(`Quiz chord ${symbol} is not readable: ${info.reason}`);
  return info.chord.notes.map((n) => pretty(n.name)).join(' ');
}

/** What a chord option sounds like, so "F♯" and "G♭" count as the same option. */
function chordSound(symbol: string): string {
  const info = chordInfo(symbol);
  if (!info.ok) throw new Error(`Quiz chord ${symbol} is not readable: ${info.reason}`);
  return `${pcOf(info.chord.root)}:${info.chord.notes.map((n) => n.pc).sort((x, y) => x - y).join(',')}`;
}

/** The right answer plus three wrong ones that differ from it and from each other (by `same`, default the text). */
function ask(
  topic: TheoryTopic, item: string, prompt: string, right: string, wrong: string[], rng: Rng,
  same: (option: string) => string = (o) => o,
): TheoryQuestion {
  const seen = new Set([same(right)]);
  const distinct = wrong.filter((w) => !seen.has(same(w)) && seen.add(same(w))).slice(0, 3);
  const options = shuffle([right, ...distinct], rng);
  if (options.length !== 4) throw new Error(`Quiz item ${item} has only ${options.length} distinct options`);
  return { topic, item, prompt, options, answer: options.indexOf(right) };
}

export function theoryQuestion(item: string, rng: Rng): TheoryQuestion {
  const parts = item.split(':');
  const [kind, a = '', b = ''] = parts;
  if ((kind === 'v' || kind === 'rel' || kind === 'sig') && parts.length === 2 && MAJOR_KEYS.includes(a)) {
    const idx = MAJOR_KEYS.indexOf(a);
    const near = [1, 11, 2, 10, 5].map((d) => MAJOR_KEYS[(idx + d) % 12]!);
    if (kind === 'v') {
      const fifth = (k: string) => pretty(keyChords(k, 'major', 'triads')[4]!.symbol);
      const own = keyChords(a, 'major', 'triads').map((c) => pretty(c.symbol));
      return ask('keys', item, `What's the V chord in ${pretty(a)} major?`, fifth(a), [own[3]!, own[1]!, own[5]!, ...near.map(fifth)], rng, chordSound);
    }
    if (kind === 'rel') {
      const rel = (k: string) => `${pretty(relativeKey(k, 'major').root)} minor`;
      return ask('keys', item, `Relative minor of ${pretty(a)} major?`, rel(a), near.map(rel), rng);
    }
    return ask('keys', item, `Key signature of ${pretty(a)} major?`, sigText(a), near.map(sigText), rng);
  }
  if ((kind === 'notes' || kind === 'name') && parts.length === 2 && CHORD_NAMES.has(a)) {
    const info = chordInfo(a);
    if (!info.ok) throw new Error(`Quiz chord ${a} is not readable: ${info.reason}`);
    const root = info.chord.root;
    const others = QUALITY.map((q) => `${root}${q}`).filter((s) => s !== a);
    if (kind === 'notes') {
      return ask('chords', item, `Notes of ${pretty(a)}?`, notesText(a), others.map(notesText), rng);
    }
    return ask('chords', item, `Which chord is ${notesText(a)}?`, pretty(a), others.map(pretty), rng);
  }
  if (kind !== 'ivl' || parts.length !== 3 || !LETTERS.includes(a) || !INTERVAL_NAMES.includes(b)) return unknownItem(item);
  const to = Note.transpose(a, b);
  const keys = Object.keys(IVL_LABEL);
  const idx = keys.indexOf(b);
  const dist = (k: string) => Math.abs(keys.indexOf(k) - idx);
  const near = keys.filter((k) => k !== b).sort((x, y) => dist(x) - dist(y) || keys.indexOf(x) - keys.indexOf(y));
  return ask('intervals', item, `${pretty(a)} up to ${pretty(to)} is a…`, IVL_LABEL[b]!, near.map((k) => IVL_LABEL[k]!), rng);
}

export function nextTheoryQuestion(
  topics: readonly TheoryTopic[],
  history: readonly Answer[],
  rng: Rng,
  previous?: string,
  only?: readonly string[],
): TheoryQuestion {
  const items = restrict(theoryItems(topics), only);
  if (items.length === 0) throw new Error(`No quiz items for topics [${topics.join(', ')}]`);
  const item = pickItem(items, (i) => weakness(history, 'theory', TOPIC_OF[i.split(':')[0]!]!, i), rng, previous);
  return theoryQuestion(item, rng);
}

// ---------------------------------------------------------------- stats

export interface CellStat extends Cell {
  weakness: number;
}

/** Per-cell weakness from name-note, find-note and find-interval answers. Cells never asked are absent. */
export function heatmap(history: readonly Answer[]): CellStat[] {
  const byCell = new Map<string, Answer[]>();
  for (const a of history) {
    if (a.quiz !== 'fretboard' || !parseCellKey(a.item)) continue;
    const answers = byCell.get(a.item);
    if (answers) answers.push(a);
    else byCell.set(a.item, [a]);
  }
  return [...byCell.entries()].map(([key, answers]) => ({ ...parseCellKey(key)!, weakness: score(answers.slice(-WINDOW)) }));
}

/** The `n` weakest theory facts that have been asked at least once; equally weak facts keep the order they were first asked in. */
export function weakestFacts(history: readonly Answer[], n: number): { item: string; weakness: number }[] {
  const facts = new Map<string, { mode: string; item: string }>();
  for (const a of history) if (a.quiz === 'theory') facts.set(JSON.stringify([a.mode, a.item]), { mode: a.mode, item: a.item });
  return [...facts.values()]
    .map(({ mode, item }) => ({ item, weakness: weakness(history, 'theory', mode, item) }))
    .sort((a, b) => b.weakness - a.weakness)
    .slice(0, Math.max(0, n));
}

/** Pitch-class of a tapped cell, for checking answers. */
export function pcAt(inst: Instrument, cell: Cell): number {
  return positionAt(inst, cell).pc;
}
