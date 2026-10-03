// The Practice sound panel (D-22): the click and the reference parts, each with
// a level and (for the parts you play against) a mute. Chords and drums are
// Phase B, shown disabled so the layout does not move when they arrive.
import type { PracticeInstrument, PracticeLevels } from '../api/client';
import styles from './Practice.module.css';

type LevelKey = 'click' | 'ref' | 'backing';
type MuteKey = 'ref_muted' | 'backing_muted';

function Channel({
  label,
  hue,
  level,
  muted,
  onLevel,
  onMute,
}: {
  label: string;
  hue: string;
  level: number;
  muted?: boolean;
  onLevel(v: number): void;
  onMute?: () => void;
}) {
  return (
    <div className={styles.channel}>
      <span className={styles.channelName} style={{ color: hue }}>
        {label}
      </span>
      {onMute && (
        <button type="button" className={styles.mute} aria-pressed={muted} aria-label={`Mute ${label}`} onClick={onMute}>
          M
        </button>
      )}
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={level}
        aria-label={`${label} level`}
        onChange={(e) => onLevel(Number(e.target.value))}
      />
    </div>
  );
}

function Later({ label, hue }: { label: string; hue: string }) {
  return (
    <div className={`${styles.channel} ${styles.later}`}>
      <span className={styles.channelName} style={{ color: hue }}>
        {label}
      </span>
      <span className={styles.chip}>Phase B</span>
    </div>
  );
}

export function SoundPanel({
  instrument,
  levels,
  onChange,
}: {
  instrument: PracticeInstrument;
  levels: PracticeLevels;
  onChange(next: PracticeLevels): void;
}) {
  const level = (key: LevelKey) => (v: number) => onChange({ ...levels, [key]: v });
  const mute = (key: MuteKey) => () => onChange({ ...levels, [key]: !levels[key] });
  return (
    <div className={styles.sound}>
      <span className={styles.cap}>Sound</span>
      <Channel label="Click" hue="var(--ds-text)" level={levels.click} onLevel={level('click')} />
      {instrument === 'bass' ? (
        <>
          <Channel label="Ref. bass" hue="var(--ds-bass)" level={levels.ref} muted={levels.ref_muted} onLevel={level('ref')} onMute={mute('ref_muted')} />
          <Later label="Chords" hue="var(--ds-other)" />
        </>
      ) : (
        <>
          <Channel label="Ref. guitar" hue="var(--ds-other)" level={levels.ref} muted={levels.ref_muted} onLevel={level('ref')} onMute={mute('ref_muted')} />
          <Channel label="Backing bass" hue="var(--ds-bass)" level={levels.backing} muted={levels.backing_muted} onLevel={level('backing')} onMute={mute('backing_muted')} />
        </>
      )}
      <Later label="Drums" hue="var(--ds-drums)" />
    </div>
  );
}
