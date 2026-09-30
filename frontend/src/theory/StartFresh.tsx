// The one control the quizzes keep from their history: forget it and start over. It asks first.
import { Button } from '../ui';
import styles from './Theory.module.css';

export function StartFresh({ onReset }: { onReset: () => void }) {
  const reset = () => {
    if (window.confirm('Forget what you have practised so far? Questions start from scratch.')) onReset();
  };
  return (
    <div className={styles.row}>
      <Button variant="ghost" onClick={reset}>
        Start fresh…
      </Button>
    </div>
  );
}
