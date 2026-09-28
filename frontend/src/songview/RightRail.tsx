// UI spec §5, "Right rail": 320 px, setup tier throughout (40 px targets) --
// this panel is touched with both hands free, never with an instrument in
// hand, so it does not earn the Transport/mixer's 56 px performance tier.
// Key candidates are always plural and always carry confidence (R-05): key
// detection is probabilistic, and showing one answer as fact is the failure
// this rule exists to prevent. The scale sheet it links to is the opposite --
// pure arithmetic from a chosen key to its notes, no model, no failure mode.
import { useState } from 'react';
import { Link } from 'react-router-dom';

import type { KeyCandidate, Loop } from '../api/client';
import { noteName, pitchClassOf, type Mode } from '../music/theory';
import styles from './RightRail.module.css';

export interface RightRailProps {
  songId: string;
  candidates: KeyCandidate[];
  savedLoops: Loop[];
  activeLoop: Loop | null;
  countInBars: number;
  onRecallLoop(loop: Loop): void;
  onSaveActiveLoop(name: string): void;
  onDeleteLoop(name: string): void;
  onCountInChange(bars: number): void;
}

const COUNT_IN_OPTIONS = [0, 1, 2];

export function RightRail({
  songId,
  candidates,
  savedLoops,
  activeLoop,
  countInBars,
  onRecallLoop,
  onSaveActiveLoop,
  onDeleteLoop,
  onCountInChange,
}: RightRailProps) {
  const [loopName, setLoopName] = useState('');

  const handleSave = () => {
    if (!activeLoop || loopName.trim() === '') return;
    onSaveActiveLoop(loopName.trim());
    setLoopName('');
  };

  return (
    <aside className={styles.rail}>
      <section className={styles.section}>
        <h2 className={styles.heading}>Key candidates</h2>
        {candidates.length === 0 && <p className={styles.note}>No key candidates yet.</p>}
        <ul className={styles.candidates}>
          {candidates.map((candidate) => {
            const pc = pitchClassOf(candidate.tonic);
            const label = noteName(pc, pc, candidate.mode as Mode);
            return (
              <li key={`${candidate.tonic}-${candidate.mode}`} className={styles.candidate}>
                <span>
                  {label} {candidate.mode}
                </span>
                <b>{Math.round(candidate.confidence * 100)}%</b>
              </li>
            );
          })}
        </ul>
        <Link className={styles.link} to={`/songs/${songId}/scale`}>
          Scale &amp; fretboard &rarr;
        </Link>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Saved loops</h2>
        {savedLoops.length === 0 && <p className={styles.note}>No saved loops yet.</p>}
        <ul className={styles.loops}>
          {savedLoops.map((loop) => (
            <li key={loop.name} className={styles.loopRow}>
              <button type="button" onClick={() => onRecallLoop(loop)}>
                {loop.name}{' '}
                <span className={styles.loopBars}>
                  {loop.start_bar + 1}&ndash;{loop.end_bar + 1}
                </span>
              </button>
              <button
                type="button"
                className={styles.delete}
                aria-label={`Delete loop, bars ${loop.start_bar + 1}–${loop.end_bar + 1}`}
                onClick={() => onDeleteLoop(loop.name)}
              >
                &times;
              </button>
            </li>
          ))}
        </ul>

        <div className={styles.saveRow}>
          <label className={styles.nameField}>
            Loop name
            <input
              type="text"
              value={loopName}
              onChange={(e) => setLoopName(e.target.value)}
              placeholder={activeLoop ? 'Name this loop' : 'Set A/B to enable'}
            />
          </label>
          <button
            type="button"
            disabled={!activeLoop || loopName.trim() === ''}
            onClick={handleSave}
          >
            Save loop
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Count-in</h2>
        <div className={styles.seg}>
          {COUNT_IN_OPTIONS.map((bars) => (
            <button
              key={bars}
              type="button"
              aria-pressed={countInBars === bars}
              onClick={() => onCountInChange(bars)}
            >
              {bars} {bars === 1 ? 'bar' : 'bars'}
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}
