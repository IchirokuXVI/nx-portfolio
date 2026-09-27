import type {
  Track,
  WalkFile,
} from '@portfolio/luna-shopper/shop-map/recorder';
import { computeTracksInTurns, type ComputedTrack } from './compute-tracks';

const walk = { id: 'w' } as unknown as WalkFile;

const track = (mode: string): Track => ({
  mode,
  points: [{ t: 0, x: 0, y: 0 }],
  steps: 0,
  turns: 0,
  distanceMetres: 0,
  rotation: 0,
  segments: [],
});

describe('computeTracksInTurns', () => {
  it('answers every mode, and a mode that throws answers its error', async () => {
    const results: ComputedTrack[] = [];

    await computeTracksInTurns(
      walk,
      ['a', 'b', 'c'],
      {},
      (result) => results.push(result),
      () => false,
      (_walk, mode) => {
        if (mode === 'b') {
          throw new Error('no motion');
        }
        return track(mode);
      }
    );

    expect(results.map((r) => r.mode)).toEqual(['a', 'b', 'c']);
    expect(results[1].track).toBeNull();
    expect(results[1].error).toBe('no motion');
    expect(results[2].track?.mode).toBe('c');
  });

  it('gives the event loop a turn before each mode, and stops when cancelled', async () => {
    const order: string[] = [];
    let stop = false;

    const run = computeTracksInTurns(
      walk,
      ['a', 'b', 'c'],
      {},
      (result) => {
        order.push(result.mode);
        stop = true;
      },
      () => stop,
      (_walk, mode) => track(mode)
    );
    order.push('sync');
    await run;

    expect(order).toEqual(['sync', 'a']);
  });

  it('passes the step options through to every mode', async () => {
    const seen: unknown[] = [];

    await computeTracksInTurns(
      walk,
      ['a'],
      { stepModel: 'weinberg', weinbergK: 0.5 },
      () => undefined,
      () => false,
      (_walk, mode, options) => {
        seen.push(options);
        return track(mode);
      }
    );

    expect(seen).toEqual([{ stepModel: 'weinberg', weinbergK: 0.5 }]);
  });
});
