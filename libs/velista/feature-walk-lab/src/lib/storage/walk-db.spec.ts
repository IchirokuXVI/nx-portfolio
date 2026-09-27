import { TestBed } from '@angular/core/testing';
import { WalkBuilder, type WalkHeader } from '../capture/walk-builder';
import { WalkDb } from './walk-db';

const header = (id: string, startedAt: string): WalkHeader => ({
  format: 'shop-walk',
  version: 1,
  id,
  name: `Walk ${id}`,
  startedAt,
  source: { platform: 'web', app: 'velista-walk-lab', appVersion: 'test' },
  settings: { stepMetres: 0.7, cellMetres: 0.5 },
});

describe('WalkDb', () => {
  let db: WalkDb;

  beforeEach(() => {
    // jsdom has no IndexedDB, which is exactly the case the fallback exists for.
    TestBed.configureTestingModule({ providers: [WalkDb] });
    db = TestBed.inject(WalkDb);
  });

  it('keeps walks in memory and says so when IndexedDB is missing', async () => {
    const builder = new WalkBuilder(header('a', '2026-09-28T10:00:00Z'));
    builder.push('motion', [0, 0, 0, 9.8, 0, 0, 0]);

    expect(await db.save(builder.toWalk())).toBe(true);
    expect(db.memoryOnly()).toBe(true);
    expect(db.error()).toContain('IndexedDB');
    expect((await db.get('a'))?.streams.motion).toHaveLength(1);
  });

  it('lists newest first, and a recording is listed as partial from its start', async () => {
    const older = new WalkBuilder(header('old', '2026-09-27T10:00:00Z'));
    await db.save(older.toWalk());
    await db.begin(header('new', '2026-09-28T10:00:00Z'));

    const list = await db.list();
    expect(list.map((row) => row.id)).toEqual(['new', 'old']);
    expect(list[0].partial).toBe(true);
    expect(list[1].partial).toBe(false);
  });

  it('recovers a walk whose recording never finished from its chunks', async () => {
    const h = header('r', '2026-09-28T10:00:00Z');
    const builder = new WalkBuilder(h);
    await db.begin(h);

    builder.push('motion', [0, 0, 0, 9.8, 0, 0, 0]);
    builder.setDuration(10_000);
    await db.append(builder.drainChunk(), h);
    builder.push('motion', [10, 0, 0, 9.8, 0, 0, 0]);
    builder.mark({ t: 10, kind: 'checkout' });
    builder.setDuration(20_000);
    await db.append(builder.drainChunk(), h);

    const recovered = await db.get('r');
    expect(recovered?.streams.motion).toHaveLength(2);
    expect(recovered?.marks).toEqual([{ t: 10, kind: 'checkout' }]);
    expect(recovered?.durationMs).toBe(20_000);
    expect((await db.list())[0].partial).toBe(false);
  });

  it('deletes a walk and everything recorded for it', async () => {
    await db.save(
      new WalkBuilder(header('d', '2026-09-28T10:00:00Z')).toWalk()
    );
    await db.delete('d');

    expect(await db.get('d')).toBeNull();
    expect(await db.list()).toEqual([]);
  });
});
