import { createWalkRecorder, headingOf } from './recorder';

/** Pushes a flat phone walking and turning through a recorder. */
function run(
  until: number,
  walking: (t: number) => boolean,
  yawRate: (t: number) => number,
  onEach?: (t: number, rec: ReturnType<typeof createWalkRecorder>) => void,
  start: { x: number; y: number; heading: 'n' | 's' | 'e' | 'w' } = {
    x: 3,
    y: 2,
    heading: 'e',
  }
) {
  const steps: { x: number; y: number }[] = [];
  const turns: string[] = [];
  const rec = createWalkRecorder({
    start,
    onStep: (p) => steps.push(p),
    onTurn: (h) => turns.push(h),
  });
  for (let t = 0; t <= until; t += 10) {
    onEach?.(t, rec);
    const z = 9.81 + (walking(t) ? 2.5 * Math.sin((2 * Math.PI * t) / 555) : 0);
    rec.push({ t, accel: { x: 0, y: 0, z }, yawRate: yawRate(t) });
  }
  return { rec, steps, turns };
}

describe('createWalkRecorder', () => {
  it('walks straight along the start heading on the grid', () => {
    const { rec, steps } = run(
      7000,
      (t) => t >= 1500,
      () => 0
    );
    const walk = rec.finish();
    expect(walk.segments).toHaveLength(1);
    const s = walk.segments[0];
    expect(s.from).toEqual({ x: 3, y: 2 });
    expect(s.heading).toBe('e');
    expect(s.to).toEqual({
      x: 3 + Math.round((s.steps * 0.7) / 0.5),
      y: 2,
    });
    expect(steps).toHaveLength(s.steps);
    expect(rec.position()).toEqual({ ...s.to, heading: 'e' });
  });

  it('snaps a left pivot of 80 degrees to north, and closes a segment', () => {
    const { rec, turns } = run(
      14_000,
      (t) => (t >= 1500 && t < 6000) || (t >= 8000 && t < 13_000),
      // 80 degrees left over one second.
      (t) => (t >= 6000 && t < 7000 ? (80 * Math.PI) / 180 : 0)
    );
    const walk = rec.finish();
    expect(turns).toEqual(['n']);
    expect(walk.segments.map((s) => s.heading)).toEqual(['e', 'n']);
    expect(walk.segments[1].from).toEqual(walk.segments[0].to);
    expect(walk.segments[1].to.x).toBe(walk.segments[0].to.x);
    for (const s of walk.segments) {
      expect(s.confidence).toBeGreaterThan(0.8);
      expect(s.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('records marks, scans and notes at the current cell', () => {
    const { rec } = run(
      7000,
      (t) => t >= 1500,
      () => 0,
      (t, r) => {
        if (t === 0) r.mark('entrance');
        if (t === 5000) r.scan('8480000123457');
        if (t === 6000) r.note('bread');
        if (t === 7000) r.mark('checkout', 'till 2');
      }
    );
    const walk = rec.finish();
    expect(walk.marks[0]).toEqual({ kind: 'entrance', at: { x: 3, y: 2 } });
    expect(walk.marks[1].label).toBe('till 2');
    expect(walk.scans[0].ean).toBe('8480000123457');
    expect(walk.scans[0].heading).toBe('e');
    expect(walk.scans[0].at.x).toBeGreaterThan(3);
    expect(walk.notes[0].text).toBe('bread');
    expect(walk.startedAt).toBe(0);
    expect(walk.finishedAt).toBe(7000);
  });
});

describe('headingOf', () => {
  it.each([
    [0, 'n'],
    [Math.PI / 2, 'e'],
    [Math.PI, 's'],
    [-Math.PI / 2, 'w'],
    [(5 * Math.PI) / 2, 'e'],
  ])('%f is %s', (r, h) => {
    expect(headingOf(r)).toBe(h);
  });
});
