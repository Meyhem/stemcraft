// The Stems content of the song screen (UI spec §6, screen 3): one time axis -- ruler,
// chord row, four stem lanes. The header, the transport and the view switch are
// SongScreen's; the engine and the recipe are the session's (D-18). This file owns
// only how the time axis is drawn: zoom, follow, pan and drag-to-zoom.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from 'react';

import {
  DEFAULT_PX_PER_BAR,
  LANE_HEAD_PX,
  sampleAtX,
  timeScale,
  zoomBounds,
  type Zoom,
} from '../music/timeScale';
import { clamp, DRAG_THRESHOLD_PX, scrollLeftAfterZoom, wheelZoom, ZOOM_STEP } from '../music/zoom';
import { useSongSession } from '../session/SongSession';
import { ChordStrip } from '../songview/ChordStrip';
import { StemLane } from '../songview/StemLane';
import { Timeline } from '../songview/Timeline';
import { ViewTools } from '../songview/ViewTools';
import { ZoomTools } from '../songview/ZoomTools';
import styles from './SongView.module.css';

export function SongView() {
  const {
    chords,
    grid,
    song,
    engine,
    soloed,
    playing,
    loopArmed,
    seekNonce,
    getPosition,
    onScrub: handleScrub,
    onMuteToggle: handleMuteToggle,
    onSoloToggle: handleSoloToggle,
    onGainChange: handleGainChange,
  } = useSongSession();

  // View state, not recipe: how the time axis is drawn never reaches song.json.
  const [zoom, setZoom] = useState<Zoom>(DEFAULT_PX_PER_BAR);
  const [follow, setFollow] = useState(true);
  // The time axis scroll container, as state so Timeline's follow painter is
  // handed the element once it exists, and its visible content width (minus
  // the sticky head column), which is what Fit fits the song into.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  // releaseFollow is registered on a non-passive wheel listener that must not
  // be re-attached every render, so it reads `playing` through a ref.
  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
  });

  const loopStartBar = song?.active_loop?.start_bar ?? null;
  const loopEndBar = song?.active_loop?.end_bar ?? null;


  // ---- time axis view -----------------------------------------------------

  // Re-measured on resize only -- a handful of renders, never one per frame.
  // jsdom has no ResizeObserver; there the width stays 0 and Fit renders at 1x.
  useEffect(() => {
    if (!scroller) return;
    const measure = () => setViewportWidth(Math.max(0, scroller.clientWidth - LANE_HEAD_PX));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scroller]);

  const durationSamples = engine?.durationSamples ?? 0;
  const scale = useMemo(
    () => timeScale({ durationSamples, grid, zoom, viewportWidth }),
    [durationSamples, grid, zoom, viewportWidth],
  );

  const handleFollowToggle = useCallback(() => setFollow((on) => !on), []);

  // ---- zoom and pan ----------------------------------------------------
  //
  // The same gestures as the Album splitter: the wheel zooms at the pointer, Shift+wheel
  // and the scrollbar pan, a drag across the chords or lanes zooms to that range, and
  // the buttons step. A zoom that asks for a specific view (at the pointer, onto a
  // range) parks its scrollLeft here; the layout effect below applies it after the
  // axis has re-rendered at the new width. The buttons park nothing, so Timeline's own
  // re-centre-on-the-playhead behaviour stands for them.
  const bounds = useMemo(
    () => zoomBounds({ durationSamples, grid, viewportWidth }),
    [durationSamples, grid, viewportWidth],
  );
  const pendingScroll = useRef<number | null>(null);
  // Runs after Timeline's layout effect (a parent's run after its children's), so an
  // anchored zoom overrides the playhead re-centre in the same frame.
  useLayoutEffect(() => {
    if (pendingScroll.current === null || !scroller) return;
    scroller.scrollLeft = pendingScroll.current;
    pendingScroll.current = null;
  }, [scale.pxPerSample, scroller]);

  /** Set a px-per-bar zoom, clamped; landing on the fit width means Fit. */
  const applyZoom = useCallback(
    (pxPerBar: number, scrollLeft: number | null) => {
      const next = clamp(pxPerBar, bounds.min, bounds.max);
      pendingScroll.current = scrollLeft;
      setZoom(viewportWidth > 0 && next <= bounds.min ? 'fit' : next);
    },
    [bounds, viewportWidth],
  );
  const handleZoomIn = useCallback(() => applyZoom(scale.pxPerBar * ZOOM_STEP, null), [applyZoom, scale.pxPerBar]);
  const handleZoomOut = useCallback(() => applyZoom(scale.pxPerBar / ZOOM_STEP, null), [applyZoom, scale.pxPerBar]);
  const handleZoomFit = useCallback(() => {
    pendingScroll.current = 0;
    setZoom('fit');
  }, []);

  const zoomLabel = useMemo(() => {
    if (zoom === 'fit') return 'Whole song';
    if (viewportWidth <= 0) return `${Math.round(scale.pxPerBar)} px/bar`;
    if (grid) {
      const bars = viewportWidth / scale.pxPerBar;
      return `${bars < 10 ? bars.toFixed(1) : Math.round(bars)} bars in view`;
    }
    const seconds = Math.round(viewportWidth / scale.pxPerSample / 48_000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} in view`;
  }, [zoom, viewportWidth, grid, scale]);

  // Scrolling the axis by hand while playing means "let me look elsewhere":
  // follow would snap the view straight back, so it switches off -- visibly,
  // the toggle unlights. Only gestures that are unambiguously the user's count
  // (a horizontal wheel/trackpad swipe, a press on the scrollbar itself), never
  // the scroll events follow's own paging fires.
  const releaseFollow = useCallback(() => {
    if (playingRef.current) setFollow(false);
  }, []);
  const handleAxisWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (event.deltaX !== 0 || event.shiftKey) releaseFollow();
    },
    [releaseFollow],
  );
  // Content-space x of a pointer over the axis: 0 is the song's first sample.
  const contentXOf = useCallback(
    (clientX: number) => {
      if (!scroller) return 0;
      return clientX - scroller.getBoundingClientRect().left - LANE_HEAD_PX + scroller.scrollLeft;
    },
    [scroller],
  );

  // Non-passive, so the wheel can zoom instead of scrolling the page. Over the sticky
  // heads (gain sliders, M/S) the wheel is left alone.
  const zoomRef = useRef({ scale, applyZoom, releaseFollow });
  zoomRef.current = { scale, applyZoom, releaseFollow };
  useEffect(() => {
    if (!scroller) return;
    // The DOM WheelEvent, not React's (which the `WheelEvent` import in this file is).
    const onWheel = (event: globalThis.WheelEvent) => {
      const rect = scroller.getBoundingClientRect();
      const anchorX = event.clientX - rect.left - LANE_HEAD_PX;
      if (anchorX < 0) return;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return; // native sideways pan
      event.preventDefault();
      const current = zoomRef.current;
      current.releaseFollow();
      if (event.shiftKey) {
        scroller.scrollLeft += event.deltaY;
        return;
      }
      const from = current.scale.pxPerBar;
      const to = wheelZoom(from, event.deltaY);
      current.applyZoom(to, scrollLeftAfterZoom(scroller.scrollLeft, anchorX, from, to));
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  }, [scroller]);

  // Drag across the chord row or the lanes: select a range, then zoom to fit it. The
  // ruler keeps its click-to-seek, the heads keep their controls, and a press that does
  // not travel DRAG_THRESHOLD_PX does nothing -- a lane has no click action to confuse
  // it with.
  const press = useRef<{ startX: number; selecting: boolean } | null>(null);
  const [selection, setSelection] = useState<{ from: number; to: number } | null>(null);

  const handleAxisPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      // Only the scrollbar targets the scroller itself: the canvas fills it.
      if (event.target === event.currentTarget) {
        releaseFollow();
        return;
      }
      if (event.button !== 0 || !scroller) return;
      const target = event.target as Element;
      if (target.closest('[data-testid="ruler-row"], button, input, select, textarea, label, a')) return;
      if (event.clientX - scroller.getBoundingClientRect().left < LANE_HEAD_PX) return;
      press.current = { startX: contentXOf(event.clientX), selecting: false };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    },
    [releaseFollow, scroller, contentXOf],
  );
  const handleAxisPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const current = press.current;
      if (!current) return;
      const x = contentXOf(event.clientX);
      if (!current.selecting && Math.abs(x - current.startX) < DRAG_THRESHOLD_PX) return;
      current.selecting = true;
      setSelection({ from: current.startX, to: x });
    },
    [contentXOf],
  );
  const handleAxisPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const current = press.current;
      press.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setSelection(null);
      if (!current?.selecting || viewportWidth <= 0) return;
      const x = contentXOf(event.clientX);
      const low = sampleAtX(scale, Math.min(current.startX, x), durationSamples);
      const high = sampleAtX(scale, Math.max(current.startX, x), durationSamples);
      const samples = Math.max(1, high - low);
      // px per bar that fits the range into the view, then centre the range: if it was
      // clamped at the max zoom it no longer fills the view.
      const barSamples = scale.pxPerBar / scale.pxPerSample;
      const target = clamp((viewportWidth / samples) * barSamples, bounds.min, bounds.max);
      const centre = ((low + high) / 2) * (target / barSamples);
      releaseFollow();
      applyZoom(target, Math.max(0, Math.round(centre - viewportWidth / 2)));
    },
    [contentXOf, viewportWidth, scale, durationSamples, bounds, releaseFollow, applyZoom],
  );
  const handleAxisPointerCancel = useCallback(() => {
    press.current = null;
    setSelection(null);
  }, []);

  // ---- render -------------------------------------------------------------

  const timelineLoop = useMemo(
    () =>
      loopStartBar !== null && loopEndBar !== null
        ? { startBar: loopStartBar, endBar: loopEndBar }
        : null,
    [loopStartBar, loopEndBar],
  );

  // Loading, errors and the no-stems case are SongScreen's to say.
  if (!engine || !song) return null;

  return (
    <>
      <ViewTools>
        <ZoomTools
          zoomLabel={zoomLabel}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomFit={handleZoomFit}
          follow={follow}
          onFollowToggle={handleFollowToggle}
        />
      </ViewTools>

      {/* One time axis: ruler, chords and the four lanes are rows of a
          single horizontally scrolling canvas, so a chord, its bar line
          and the waveform under it always move together. */}
      <div
        ref={setScroller}
        data-testid="time-axis-scroller"
        className={styles.scroller}
        onWheel={handleAxisWheel}
        onPointerDown={handleAxisPointerDown}
        onPointerMove={handleAxisPointerMove}
        onPointerUp={handleAxisPointerUp}
        onPointerCancel={handleAxisPointerCancel}
      >
        <div
          data-testid="time-axis"
          className={styles.axis}
          style={{ width: `${LANE_HEAD_PX + scale.contentWidth}px` }}
        >
          {selection && (
            <div
              className={styles.selection}
              data-testid="zoom-selection"
              style={{
                left: `${LANE_HEAD_PX + Math.min(selection.from, selection.to)}px`,
                width: `${Math.abs(selection.to - selection.from)}px`,
              }}
            />
          )}
          <Timeline
            grid={grid}
            durationSamples={engine.durationSamples}
            scale={scale}
            loop={timelineLoop}
            loopArmed={loopArmed}
            getPosition={getPosition}
            playing={playing}
            seekNonce={seekNonce}
            onScrub={handleScrub}
            scroller={scroller}
            follow={follow}
          />

          <ChordStrip
            chords={chords}
            scale={scale}
            compact={zoom === 'fit'}
            getPosition={getPosition}
            playing={playing}
            seekNonce={seekNonce}
          />

          <div className={styles.lanes}>
            {engine.stemSummaries.map((summary) => (
              <StemLane
                key={summary.name}
                summary={summary}
                scroller={scroller}
                width={scale.contentWidth}
                muted={song.mix[summary.name]?.muted ?? false}
                soloed={soloed.has(summary.name)}
                gainDb={song.mix[summary.name]?.gain_db ?? 0}
                anySoloed={soloed.size > 0}
                onMuteToggle={() => handleMuteToggle(summary.name)}
                onSoloToggle={() => handleSoloToggle(summary.name)}
                onGainChange={(db) => handleGainChange(summary.name, db)}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
