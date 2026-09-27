import { trackToWalk } from './draft';
import { emptyWalk } from './testing';
import type { Track } from './track-types';

/** Four steps north, a turn, three steps east, a turn, one step south. */
function snapTrack(): Track {
  const p = (t: number, x: number, y: number) => ({ t, x, y });
  return {
    mode: 'pdr:own:gyro:snap',
    points: [
      p(0, 0, 0),
      p(1000, 0, 0.7),
      p(1500, 0, 1.4),
      p(2000, 0, 2.1),
      p(2500, 0, 2.8),
      p(4000, 0.7, 2.8),
      p(4500, 1.4, 2.8),
      p(5000, 2.1, 2.8),
      p(7000, 2.1, 2.1),
    ],
    steps: 8,
    turns: 2,
    distanceMetres: 5.6,
    rotation: 0,
    segments: [
      { fromIndex: 0, toIndex: 4, confidence: 0.9 },
      { fromIndex: 4, toIndex: 7, confidence: 0.8 },
      { fromIndex: 7, toIndex: 8, confidence: 0.7 },
    ],
  };
}

describe('trackToWalk', () => {
  it('turns a snap track into chained straight grid segments', () => {
    const walk = emptyWalk();
    walk.durationMs = 7000;
    walk.marks = [
      { t: 0, kind: 'entrance' },
      { t: 2600, kind: 'checkpoint', label: 'corner' },
      { t: 4600, kind: 'note', label: 'bread' },
      { t: 7000, kind: 'checkout' },
    ];
    const w = trackToWalk(walk, snapTrack());
    expect(w.segments).toEqual([
      {
        from: { x: 0, y: 0 },
        to: { x: 0, y: 6 },
        heading: 'n',
        steps: 4,
        confidence: 0.9,
      },
      {
        from: { x: 0, y: 6 },
        to: { x: 4, y: 6 },
        heading: 'e',
        steps: 3,
        confidence: 0.8,
      },
      {
        from: { x: 4, y: 6 },
        to: { x: 4, y: 4 },
        heading: 's',
        steps: 1,
        confidence: 0.7,
      },
    ]);
    expect(w.marks).toEqual([
      { kind: 'entrance', at: { x: 0, y: 0 } },
      { kind: 'checkpoint', at: { x: 0, y: 6 }, label: 'corner' },
      { kind: 'checkout', at: { x: 4, y: 4 } },
    ]);
    expect(w.notes).toEqual([{ text: 'bread', at: { x: 3, y: 6 } }]);
    expect(w.scans).toEqual([]);
    expect(w.finishedAt - w.startedAt).toBe(7000);
    expect(w.startedAt).toBe(Date.parse('2026-09-28T10:00:00+02:00'));
  });
});
