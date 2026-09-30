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

  describe('deleteLastMark', () => {
    it('removes a mark not yet drained, leaving no trace', () => {
      const builder = new WalkBuilder(header);
      builder.mark({ t: 1, kind: 'entrance' });
      builder.drainChunk();
      builder.mark({ t: 2, kind: 'checkpoint', label: 'wrong' });

      expect(builder.deleteLastMark(3)).toEqual({
        t: 2,
        kind: 'checkpoint',
        label: 'wrong',
      });
      expect(builder.liveMarks).toEqual([{ t: 1, kind: 'entrance' }]);
      expect(builder.events).toEqual([]);
      expect(builder.drainChunk().marks).toEqual([]);
      expect(builder.toWalk().marks).toEqual([{ t: 1, kind: 'entrance' }]);
    });

    it('cancels a mark already drained with a mark-deleted event', () => {
      const builder = new WalkBuilder(header);
      builder.mark({ t: 1, kind: 'entrance' });
      builder.mark({ t: 2.5, kind: 'checkpoint', label: 'wrong' });
      const first = builder.drainChunk();

      expect(builder.deleteLastMark(4)?.t).toBe(2.5);
      expect(builder.liveMarks).toEqual([{ t: 1, kind: 'entrance' }]);
      const second = builder.drainChunk();
      expect(second.marks).toEqual([]);
      expect(second.events).toEqual([
        { t: 4, kind: 'mark-deleted', detail: '2.5' },
      ]);

      // The next deletion takes the mark before it, also drained.
      expect(builder.deleteLastMark(5)?.t).toBe(1);
      expect(builder.liveMarks).toEqual([]);
      expect(builder.deleteLastMark(6)).toBeNull();

      // The file keeps both marks and both events, and so do the chunks.
      const walk = builder.toWalk();
      expect(walk.marks).toHaveLength(2);
      expect(walk.events.map((e) => e.detail)).toEqual(['2.5', '1']);
      expect(
        assembleWalk(header, [first, second, builder.drainChunk()])
      ).toEqual(walk);
    });

    it('takes back drained and undrained marks in order, newest first', () => {
      const builder = new WalkBuilder(header);
      builder.mark({ t: 1, kind: 'entrance' });
      builder.drainChunk();
      builder.mark({ t: 2, kind: 'note', label: 'x' });

      expect(builder.deleteLastMark(3)?.t).toBe(2);
      expect(builder.deleteLastMark(4)?.t).toBe(1);
      expect(builder.toWalk().marks).toEqual([{ t: 1, kind: 'entrance' }]);
      expect(builder.toWalk().events).toEqual([
        { t: 4, kind: 'mark-deleted', detail: '1' },
      ]);
    });
  });
});
