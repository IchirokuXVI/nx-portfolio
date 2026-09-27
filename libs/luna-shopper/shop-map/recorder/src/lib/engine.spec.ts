import { computeTrack, createTrackEngine, forEachRowMerged } from './engine';
import { availableModes } from './modes';
import { emptyWalk, scriptedWalk } from './testing';
import type { StreamName } from './walk-file';

/** Walk 8 s north, pivot 90 degrees right over 1 s, pause, walk 6 s east. */
const lWalk = scriptedWalk(
  18_000,
  (t) => (t >= 1500 && t < 9500) || (t >= 11_000 && t < 17_000),
  (t) => (t >= 9500 && t < 10_500 ? -Math.PI / 2 : 0)
);

describe('computeTrack', () => {
  it('is a fresh live engine fed every row merged by t', () => {
    for (const mode of availableModes(lWalk)) {
      const engine = createTrackEngine(mode, lWalk);
      forEachRowMerged(lWalk.streams, engine.push);
      expect(engine.track()).toEqual(computeTrack(lWalk, mode));
    }
  });

  it('is deterministic', () => {
    expect(computeTrack(lWalk, 'pdr:own:gyro:snap')).toEqual(
      computeTrack(lWalk, 'pdr:own:gyro:snap')
    );
  });

  it.each(['pdr:own:gyro:snap', 'pdr:own:game:snap'])(
    '%s draws a square L, aligned so the first leg is +y',
    (mode) => {
      const track = computeTrack(lWalk, mode);
      expect(track.turns).toBe(1);
      expect(track.segments).toHaveLength(2);
      const corner = track.points[track.segments[0].toIndex];
      const end = track.points[track.points.length - 1];
      expect(corner.x).toBeCloseTo(0, 9);
      expect(corner.y).toBeGreaterThan(8);
      expect(end.y).toBeCloseTo(corner.y, 9);
      // A right turn: the second leg goes to +x.
      expect(end.x).toBeGreaterThan(corner.x + 5);
    }
  );

  it('a mode without snap uses the raw heading and has one segment', () => {
    const track = computeTrack(lWalk, 'pdr:own:gyro');
    expect(track.turns).toBe(0);
    expect(track.segments).toEqual([
      expect.objectContaining({
        fromIndex: 0,
        toIndex: track.points.length - 1,
      }),
    ]);
  });

  it('starts at the origin at t 0 and counts one point per step', () => {
    const track = computeTrack(lWalk, 'pdr:own:gyro:snap');
    expect(track.points[0]).toEqual({ t: 0, x: 0, y: 0 });
    expect(track.steps).toBe(track.points.length - 1);
  });

  it('leaves a track unrotated when align is false', () => {
    const track = computeTrack(lWalk, 'pdr:own:gyro:snap', { align: false });
    expect(track.rotation).toBe(0);
  });

  it('leaves a track that never goes 3 m unrotated', () => {
    const short = scriptedWalk(
      3000,
      (t) => t >= 1500,
      () => 0
    );
    const track = computeTrack(short, 'pdr:own:gyro');
    expect(track.rotation).toBe(0);
  });

  it('answers the start point alone for a mode the file cannot compute', () => {
    const track = computeTrack(lWalk, 'pdr:hw:absolute:snap');
    expect(track.points).toEqual([{ t: 0, x: 0, y: 0 }]);
    expect(track.steps).toBe(0);
  });

  it('weinberg uses each step swing, fixed the settings or the option', () => {
    const fixed = computeTrack(lWalk, 'pdr:own:gyro', { align: false });
    expect(fixed.distanceMetres).toBeCloseTo(fixed.steps * 0.7, 9);
    const longer = computeTrack(lWalk, 'pdr:own:gyro', { stepMetres: 1 });
    expect(longer.distanceMetres).toBeCloseTo(longer.steps, 9);
    const w = computeTrack(lWalk, 'pdr:own:gyro', { stepModel: 'weinberg' });
    const perStep = w.distanceMetres / w.steps;
    expect(perStep).toBeGreaterThan(0.5);
    expect(perStep).toBeLessThan(0.8);
    const k = computeTrack(lWalk, 'pdr:own:gyro', {
      stepModel: 'weinberg',
      weinbergK: 0.96,
    });
    expect(k.distanceMetres).toBeCloseTo(2 * w.distanceMetres, 9);
  });
});

describe('hw steps', () => {
  const steps = [2000, 2555, 3110, 3665, 4220, 4775, 5330, 5885];
  const walk = scriptedWalk(
    6000,
    (t) => t >= 1500,
    () => 0
  );
  walk.streams.steps = steps;

  it('advance one step at each event', () => {
    const track = computeTrack(walk, 'pdr:hw:gyro');
    expect(track.steps).toBe(8);
    expect(track.points.map((p) => p.t)).toEqual([0, ...steps]);
  });

  it('are ignored before the heading has a sample', () => {
    const late = scriptedWalk(
      6000,
      (t) => t >= 1500,
      () => 0
    );
    late.streams.game = late.streams.game?.filter((r) => r[0] >= 3000);
    late.streams.steps = steps;
    expect(computeTrack(late, 'pdr:hw:game').steps).toBe(6);
  });

  it('take the fixed length under weinberg when no motion row is in the window', () => {
    const noMotion = emptyWalk({
      steps,
      game: walk.streams.game,
    });
    const track = computeTrack(noMotion, 'pdr:hw:game', {
      stepModel: 'weinberg',
    });
    expect(track.distanceMetres).toBeCloseTo(8 * 0.7, 9);
  });

  it('take the swing of s since the previous hw step under weinberg', () => {
    const track = computeTrack(walk, 'pdr:hw:gyro', {
      stepModel: 'weinberg',
      align: false,
    });
    const first = track.points[1].y;
    const second = track.points[2].y - track.points[1].y;
    // The first window holds the whole standing start, the second one step.
    expect(first).toBeGreaterThan(0.4);
    expect(second).toBeGreaterThan(0.4);
    expect(second).toBeLessThan(0.8);
  });
});

describe('vio and gps', () => {
  it('vio draws the pose as (x, -z) from its first row', () => {
    const walk = emptyWalk({
      pose: [
        [100, 1, 1.2, 1, 0, 0, 0, 1],
        [200, 1, 1.2, -3, 0, 0, 0, 1],
        [300, 3, 1.2, -3, 0, 0, 0, 1],
      ],
    });
    const track = computeTrack(walk, 'vio', { align: false });
    expect(track.points).toEqual([
      { t: 100, x: 0, y: 0 },
      { t: 200, x: 0, y: 4 },
      { t: 300, x: 2, y: 4 },
    ]);
    expect(track.steps).toBe(0);
    expect(track.bearing).toBeUndefined();
  });

  it('gps projects around the first fix and knows its bearing', () => {
    const walk = emptyWalk({
      location: [
        [1000, 40, -3, 10],
        [2000, 40, -3 + 5 / (111320 * Math.cos((40 * Math.PI) / 180)), 10],
      ],
    });
    const track = computeTrack(walk, 'gps');
    // Walked 5 m east: aligned onto +y by a rotation of 90 degrees.
    expect(track.points[1].x).toBeCloseTo(0, 6);
    expect(track.points[1].y).toBeCloseTo(5, 6);
    expect(track.bearing).toBeCloseTo(90, 6);
  });
});

describe('forEachRowMerged', () => {
  it('orders by t, then by the stream order of section 2', () => {
    const seen: [StreamName, number][] = [];
    forEachRowMerged(
      {
        pose: [[10, 0, 0, 0, 0, 0, 0, 1]],
        steps: [10, 5],
        motion: [
          [10, 0, 0, 0, 0, 0, 0],
          [20, 0, 0, 0, 0, 0, 0],
        ],
        game: [[10, 0, 0, 0, 1]],
      },
      (s, row) => seen.push([s, typeof row === 'number' ? row : row[0]])
    );
    // steps are out of order on purpose: the merge keeps file order within a
    // stream and never sorts (the reader sorts).
    expect(seen).toEqual([
      ['motion', 10],
      ['game', 10],
      ['steps', 10],
      ['steps', 5],
      ['pose', 10],
      ['motion', 20],
    ]);
  });
});
