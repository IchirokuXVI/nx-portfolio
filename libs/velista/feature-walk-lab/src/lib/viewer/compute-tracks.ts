import type {
  ModeId,
  Track,
  TrackOptions,
  WalkFile,
} from '@portfolio/luna-shopper/shop-map/recorder';

/** One mode's answer: the track, or why there is none. */
export interface ComputedTrack {
  mode: ModeId;
  track: Track | null;
  error?: string;
  /** How long it took, which the viewer shows beside the metrics. */
  ms: number;
}

export type ComputeFn = (
  walk: WalkFile,
  mode: ModeId,
  options?: TrackOptions
) => Track;

/**
 * Every mode's track, **one mode per macrotask** (recorder plan 0002, section 7.3).
 *
 * A twenty minute walk is over a hundred thousand motion rows and fourteen modes read
 * them, so computing all of them in one go froze the page for seconds. Yielding to
 * the event loop between modes lets the viewer draw each track as it lands and keeps
 * a tap answered within one mode's time.
 *
 * `cancelled` is asked before each mode, so changing the step length halfway through
 * abandons the old run instead of finishing it. A mode that throws answers its error
 * and the others go on.
 */
export async function computeTracksInTurns(
  walk: WalkFile,
  modes: readonly ModeId[],
  options: TrackOptions,
  each: (result: ComputedTrack) => void,
  cancelled: () => boolean,
  compute: ComputeFn,
  now: () => number = () => Date.now()
): Promise<void> {
  for (const mode of modes) {
    await nextTurn();
    if (cancelled()) {
      return;
    }

    const started = now();
    try {
      const track = compute(walk, mode, options);
      each({ mode, track, ms: now() - started });
    } catch (error) {
      each({
        mode,
        track: null,
        error: error instanceof Error ? error.message : String(error),
        ms: now() - started,
      });
    }
  }
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
