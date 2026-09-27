import { assembleWalk, WalkBuilder, type WalkHeader } from './walk-builder';

const header: WalkHeader = {
  format: 'shop-walk',
  version: 1,
  id: 'w1',
  name: 'Test',
  startedAt: '2026-09-28T10:00:00.000+02:00',
  source: {
    platform: 'web',
    app: 'velista-walk-lab',
    appVersion: 'test',
  },
  holding: 'flat',
  settings: { stepMetres: 0.7, cellMetres: 0.5 },
};

describe('WalkBuilder', () => {
  it('writes the walk file of section 2', () => {
    const builder = new WalkBuilder(header);
    builder.push('motion', [0, 0, 0, 9.8, 0, 0, 0]);
    builder.push('motion', [10, 0, 0, 9.8, 0, 0, 0]);
    builder.push('game', [5, 0, 0, 0, 1]);
    builder.push('steps', 7);
    builder.mark({ t: 3, kind: 'entrance' });
    builder.event({ t: 4, kind: 'sensor-missing', detail: 'pose' });
    builder.offerOrigin({ lat: 40, lon: -3, accuracyMetres: 12 });
    builder.offerOrigin({ lat: 41, lon: -4, accuracyMetres: 5 });
    builder.setDuration(1234.4);

    const walk = builder.toWalk();

    expect(walk.format).toBe('shop-walk');
    expect(walk.version).toBe(1);
    expect(walk.durationMs).toBe(1234);
    expect(walk.origin).toEqual({ lat: 40, lon: -3, accuracyMetres: 12 });
    expect(walk.streams.motion).toHaveLength(2);
    expect(walk.streams.game).toEqual([[5, 0, 0, 0, 1]]);
    expect(walk.streams.steps).toEqual([7]);
    expect(walk.marks).toEqual([{ t: 3, kind: 'entrance' }]);
    expect(walk.events).toEqual([
      { t: 4, kind: 'sensor-missing', detail: 'pose' },
    ]);
    expect(builder.count('motion')).toBe(2);
    expect(builder.count('pose')).toBe(0);
  });

  it('hands out each row in exactly one chunk, and chunks reassemble the walk', () => {
    const builder = new WalkBuilder(header);
    builder.push('motion', [0, 1, 2, 3, 4, 5, 6]);
    builder.mark({ t: 0, kind: 'entrance' });
    const first = builder.drainChunk();

    builder.push('motion', [10, 1, 2, 3, 4, 5, 6]);
    builder.push('location', [11, 40, -3, 8]);
    builder.offerOrigin({ lat: 40, lon: -3, accuracyMetres: 8 });
    builder.event({ t: 12, kind: 'hidden' });
    builder.setDuration(20);
    const second = builder.drainChunk();
    const third = builder.drainChunk();

    expect(first.seq).toBe(0);
    expect(first.streams.motion).toHaveLength(1);
    expect(first.marks).toHaveLength(1);
    expect(second.streams.motion).toEqual([[10, 1, 2, 3, 4, 5, 6]]);
    expect(second.marks).toEqual([]);
    expect(second.events).toEqual([{ t: 12, kind: 'hidden' }]);
    expect(third.streams).toEqual({});

    const assembled = assembleWalk(header, [second, third, first]);
    expect(assembled).toEqual(builder.toWalk());
  });
});
