// End of a round (D-19): score, the three weakest items and
// "Practise these", which starts a round of only those. Enter starts the next
// round, unless Enter is what is pressing one of the summary's own buttons (that
// button acts instead); a focused button elsewhere, such as a topic chip, does not
// take Enter away from the next round.
import { useEffect, useRef } from 'react';

import { Button, Panel } from '../ui';
import styles from './Theory.module.css';
import { quizKey, roundStats, weakestOfRound, type Result } from './useQuizRound';

export function RoundSummary({ results, onRestart }: { results: readonly Result[]; onRestart: (only?: string[]) => void }) {
  const stats = roundStats(results);
  const weak = weakestOfRound(results);
  const allRight = weak.every((r) => r.correct);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (quizKey(e) !== 'Enter') return;
      const control = e.target instanceof Element ? e.target.closest('button, a, [role="button"]') : null;
      if (control && panel.current?.contains(control)) return;
      onRestart();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onRestart]);
  return (
    <div ref={panel} style={{ display: 'contents' }}>
      <Panel className={styles.stack}>
        <h2 className={styles.big}>
          {stats.correct} / {stats.answered} first try
        </h2>
        <p>
          {allRight ? 'Slowest this round' : 'Weakest this round'}: <b>{weak.map((r) => r.text).join(' · ')}</b>
        </p>
        <div className={styles.row}>
          <Button variant="primary" onClick={() => onRestart()}>
            Next round
          </Button>
          <Button onClick={() => onRestart(weak.map((r) => r.item))}>Practise these</Button>
        </div>
      </Panel>
    </div>
  );
}
