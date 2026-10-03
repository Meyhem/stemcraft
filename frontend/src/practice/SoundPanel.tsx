// The Practice sound panel (D-22): the click and the reference parts, each with
// a level and (for the parts you play against) a mute. Chords (bass mode) and
// drums come with a sound or groove picker (Phase B).
import type { DrumGroove, PracticeBacking, PracticeInstrument, PracticeLevels } from '../api/client';
import { Segmented } from '../ui';
import styles from './Practice.module.css';

type LevelKey = 'click' | 'ref' | 'backing' | 'chords' | 'drums';
type MuteKey = 'ref_muted' | 'backing_muted' | 'chords_muted' | 'drums_muted';

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

export function SoundPanel({
  instrument,
  levels,
  backing,
  hasHarmony,
  onChange,
  onBacking,
}: {
  instrument: PracticeInstrument;
  levels: PracticeLevels;
  backing: PracticeBacking;
  hasHarmony: boolean;
  onChange(next: PracticeLevels): void;
  onBacking(next: PracticeBacking): void;
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
          <div className={styles.channelWide}>
            <Channel label="Chords" hue="var(--ds-other)" level={levels.chords} muted={levels.chords_muted} onLevel={level('chords')} onMute={mute('chords_muted')} />
            <Segmented
              label="Chord sound"
              value={backing.chord_sound}
              onChange={(chord_sound) => onBacking({ ...backing, chord_sound })}
              options={[
                { value: 'pad', label: 'Pad' },
                { value: 'keys', label: 'Keys' },
              ]}
            />
            {!hasHarmony && <span className={styles.dim}>Drills have no chords.</span>}
          </div>
        </>
      ) : (
        <>
          <Channel label="Ref. guitar" hue="var(--ds-other)" level={levels.ref} muted={levels.ref_muted} onLevel={level('ref')} onMute={mute('ref_muted')} />
          <Channel label="Backing bass" hue="var(--ds-bass)" level={levels.backing} muted={levels.backing_muted} onLevel={level('backing')} onMute={mute('backing_muted')} />
        </>
      )}
      <div className={styles.channelWide}>
        <Channel label="Drums" hue="var(--ds-drums)" level={levels.drums} muted={levels.drums_muted} onLevel={level('drums')} onMute={mute('drums_muted')} />
        <select className={styles.select} aria-label="Drum groove" value={backing.drum_groove} onChange={(e) => onBacking({ ...backing, drum_groove: e.target.value as DrumGroove })}>
          <option value="rock">Rock</option>
          <option value="shuffle">Shuffle</option>
          <option value="half_time">Half-time</option>
          <option value="funk">Funk</option>
          <option value="four_floor">Four on the floor</option>
        </select>
      </div>
    </div>
  );
}
