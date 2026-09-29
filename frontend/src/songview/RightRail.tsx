// UI spec §5, "Right rail": 320 px, setup tier throughout (40 px targets) --
// this panel is touched with both hands free, never with an instrument in
// hand, so it does not earn the Transport/mixer's 56 px performance tier.
// Key candidates are always plural and always carry confidence (R-05): key
// detection is probabilistic, and showing one answer as fact is the failure
// this rule exists to prevent. The scale sheet it links to is the opposite --
// pure arithmetic from a chosen key to its notes, no model, no failure mode.
import { useState } from 'react';

import type { KeyCandidate, Loop } from '../api/client';
import { noteName, pitchClassOf, type Mode } from '../music/theory';
import { Button, Segmented, TextLink } from '../ui';
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
        <TextLink className={styles.link} to={`/songs/${songId}/scale`}>
          Scale &amp; fretboard &rarr;
        </TextLink>
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
              <Button
                className={styles.delete}
                aria-label={`Delete loop ${loop.name}, bars ${loop.start_bar + 1}–${loop.end_bar + 1}`}
                onClick={() => onDeleteLoop(loop.name)}
              >
                &times;
              </Button>
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
          <Button disabled={!activeLoop || loopName.trim() === ''} onClick={handleSave}>
            Save loop
          </Button>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Count-in</h2>
        <Segmented
          label="Count-in"
          value={String(countInBars)}
          options={COUNT_IN_OPTIONS.map((bars) => ({
            value: String(bars),
            label: `${bars} ${bars === 1 ? 'bar' : 'bars'}`,
          }))}
          onChange={(value) => onCountInChange(Number(value))}
        />
        {/* The count-in is played out of the bars *before* the start point, so
            there has to be room for it: starting from the top of a song plays
            none. Said here rather than left to be discovered mid-practice. */}
        <p className={styles.note}>
          A count-in is played from the bars before your start point, so starting at the top
          of a song plays none.
        </p>
      </section>
    </aside>
  );
}
