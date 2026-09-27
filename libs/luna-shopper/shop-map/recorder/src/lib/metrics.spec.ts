import { positionAt, trackMetrics } from './metrics';
import { emptyWalk } from './testing';
import type { Track } from './track-types';

const track: Track = {
  mode: 'pdr:own:gyro:snap',
  points: [
    { t: 0, x: 0, y: 0 },
    { t: 1000, x: 0, y: 3 },
    { t: 2000, x: 4, y: 3 },
    { t: 3000, x: 4, y: 0 },
    { t: 4000, x: 0.5, y: 0 },
  ],
  steps: 4,
  turns: 3,
  distanceMetres: 13.5,
  rotation: 0,
  segments: [],
};

describe('positionAt', () => {
  it.each([
    [-5, 0],
    [0, 0],
    [999, 0],
    [1000, 1],
    [2500, 2],
    [9000, 4],
  ])('at t %i answers point %i', (t, index) => {
    expect(positionAt(track, t)).toBe(track.points[index]);
  });
});

describe('trackMetrics', () => {
  it('reports steps, turns, distance, end to start and checkpoint errors', () => {
    const walk = emptyWalk();
    walk.marks = [
      { t: 0, kind: 'checkpoint', label: 'door' },
      { t: 1500, kind: 'checkpoint', label: 'fish' },
      { t: 2100, kind: 'checkpoint', label: 'door' },
      { t: 4000, kind: 'checkpoint', label: 'door' },
      { t: 4000, kind: 'note', label: 'door' },
    ];
    expect(trackMetrics(walk, track)).toEqual({
      steps: 4,
      turns: 3,
      distanceMetres: 13.5,
      endToStartMetres: 0.5,
      // door at (0,0), (4,3) and (0.5,0): the largest pairwise distance is 5.
      checkpoints: [{ label: 'door', count: 3, errorMetres: 5 }],
    });
  });
});
