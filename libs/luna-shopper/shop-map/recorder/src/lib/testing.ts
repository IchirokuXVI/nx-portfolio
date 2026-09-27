/**
 * Helpers shared by the specs. Not exported from the library.
 */
import type { WalkFile } from './walk-file';

export function emptyWalk(streams: WalkFile['streams'] = {}): WalkFile {
  return {
    format: 'shop-walk',
    version: 1,
    id: '00000000-0000-4000-8000-000000000000',
    startedAt: '2026-09-28T10:00:00+02:00',
    durationMs: 0,
    source: { platform: 'web', app: 'spec', appVersion: '0' },
    settings: { stepMetres: 0.7, cellMetres: 0.5 },
    streams,
    marks: [],
    events: [],
  };
}

/**
 * A walk scripted directly in samples: a flat phone at 100 Hz, bouncing at
 * 1.8 Hz while `walking(t)`, turning at `yawRate(t)` (rad/s, left positive),
 * with game rotation quaternions at 50 Hz that follow the same yaw.
 */
export function scriptedWalk(
  durationMs: number,
  walking: (t: number) => boolean,
  yawRate: (t: number) => number
): WalkFile {
  const motion: number[][] = [];
  const game: number[][] = [];
  let yaw = 0;
  for (let t = 0; t <= durationMs; t += 10) {
    const w = yawRate(t);
    const az =
      9.81 + (walking(t) ? 2.5 * Math.sin((2 * Math.PI * t) / 555) : 0);
    motion.push([t, 0, 0, az, 0, 0, w]);
    if (t % 20 === 0) {
      game.push([t, 0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2)]);
    }
    yaw += w * 0.01;
  }
  const walk = emptyWalk({ motion, game });
  walk.durationMs = durationMs;
  return walk;
}
