// Guess the note's playback (D-23): one engine for the visit, as Practice does
// (D-22), so the Theory tab gets no second audio path or clock. The first play
// creates it with the question's stems (inside the click that asked for sound, so
// the browser lets the context start); each later question swaps its stems in.
// An engine that cannot start is the error, as it is (N-08).
import { useCallback, useEffect, useRef, useState } from 'react';

import type { StemChannels } from '../engine/loopCursor';
import { sampleIndex, type SampleIndex } from '../engine/types';

export interface GuessEngine {
  replaceStems(stems: readonly StemChannels[]): void;
  seek(position: SampleIndex): void;
  play(): Promise<void>;
  pause(): void;
  onEnded(cb: () => void): () => void;
  dispose(): Promise<void>;
}

// Imported on first use: the engine's SoundTouch node extends AudioWorkletNode at import time, which jsdom lacks.
export const guessEngine = {
  async create(stems: readonly StemChannels[]): Promise<GuessEngine> {
    const { EngineController } = await import('../engine/EngineController');
    return EngineController.createFromStems(stems, { stretch: false }); // a note is never retimed: no stretcher's latency or startup dropout
  },
};

export function useGuessSound() {
  const engine = useRef<GuessEngine | null>(null);
  const creating = useRef<Promise<GuessEngine> | null>(null);
  const gone = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (e: GuessEngine) => {
    e.seek(sampleIndex(0));
    setPlaying(true);
    await e.play();
  };

  const play = useCallback(async (stems: readonly StemChannels[]) => {
    try {
      // The play that creates the engine hands it these stems; one that arrives while it is being created swaps them in.
      const fresh = creating.current === null;
      creating.current ??= guessEngine.create(stems).then((e) => {
        e.onEnded(() => setPlaying(false));
        if (gone.current) void e.dispose();
        else engine.current = e;
        return e;
      });
      const e = await creating.current;
      if (gone.current) return;
      if (!fresh) e.replaceStems(stems);
      await start(e);
      setError(null);
    } catch (err) {
      creating.current = null;
      setPlaying(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const replay = useCallback(async () => {
    const e = engine.current;
    if (!e) return;
    e.pause();
    await start(e);
  }, []);

  useEffect(() => {
    gone.current = false; // StrictMode's simulated unmount runs the cleanup below once, then mounts again
    return () => {
      gone.current = true;
      void engine.current?.dispose();
      engine.current = null;
      creating.current = null;
    };
  }, []);

  return { play, replay, playing, error };
}
