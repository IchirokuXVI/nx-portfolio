import { TestBed } from '@angular/core/testing';
import type {
  MapArea,
  WalkEvent,
} from '@portfolio/luna-shopper/shop-map/model';
import { GatewayError } from '../errors';
import { MEMORY_SHOWN_WALK_ID, ShopWalkMemory } from './shop-walk-memory';
import { SHOP_WALK_SERVICE } from './shop-walk-service';
import { WALK_SAVE_EVERY_MS, WalkEntrySaver } from './walk-entry-saver';

const WALK = MEMORY_SHOWN_WALK_ID;

function counter(id: string, x = 12): MapArea {
  return {
    id,
    kind: 'counter',
    x,
    y: 1,
    w: 2.8,
    h: 1.4,
    colour: { mode: 'default' },
    origin: 'drawn',
  };
}

const put = (id: string, x?: number): WalkEvent => ({
  type: 'area-put',
  area: counter(id, x),
});

async function harness() {
  const memory = new ShopWalkMemory();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      WalkEntrySaver,
      { provide: SHOP_WALK_SERVICE, useValue: memory },
    ],
  });
  const read = await memory.walk(WALK);
  if (read.kind !== 'walk') {
    throw new Error('the memory walk is missing');
  }
  const lastSeq = read.detail.walk.lastSeq;
  const logTo = read.detail.timeline.reduce(
    (end, entry) => Math.max(end, entry.logTo),
    0
  );
  const saver = TestBed.inject(WalkEntrySaver);
  saver.begin({ walkId: WALK, baseSeq: lastSeq, logTo, kind: 'edited' });
  return { memory, saver, lastSeq, logTo };
}

function offline(): GatewayError {
  return new GatewayError({
    code: 'internal',
    status: 0,
    correlationId: 'spec',
  });
}

/** Velista `0123`, target 5: edits reach the walk as appended `edited` entries. */
describe('WalkEntrySaver', () => {
  afterEach(() => jest.useRealTimers());

  it('collects edits into one edited entry at the log’s end, on the base as read', async () => {
    const { memory, saver, lastSeq, logTo } = await harness();

    saver.add([put('a-1')]);
    saver.add([{ type: 'area-removed', id: 'a-eggs' }]);
    expect(saver.status()).toBe('unsent');
    expect(saver.unsent()).toBe(true);

    expect(await saver.save()).toBe('saved');

    expect(memory.appended).toHaveLength(1);
    expect(memory.appended[0]).toMatchObject({
      baseSeq: lastSeq,
      kind: 'edited',
      logFrom: logTo,
      logTo,
      events: [put('a-1'), { type: 'area-removed', id: 'a-eggs' }],
    });
    expect(saver.status()).toBe('saved');
    expect(saver.unsent()).toBe(false);
    expect(saver.baseSeq()).toBe(lastSeq + 1);
  });

  it('builds the next entry on the answered entry.seq, with a new id', async () => {
    const { memory, saver, lastSeq } = await harness();

    saver.add([put('a-1')]);
    await saver.save();
    saver.add([put('a-1', 13)]);
    await saver.save();

    expect(memory.appended.map((entry) => entry.baseSeq)).toEqual([
      lastSeq,
      lastSeq + 1,
    ]);
    expect(memory.appended[0].id).not.toBe(memory.appended[1].id);
  });

  it('sends one entry per base when a save is asked for while another is out', async () => {
    const { memory, saver, lastSeq } = await harness();

    // The timer's save and Done's save, at once, over the same edit.
    saver.add([put('a-1')]);
    const [first, second] = await Promise.all([saver.save(), saver.save()]);
    expect([first, second]).toEqual(['saved', 'nothing']);
    expect(memory.appended.map((entry) => entry.baseSeq)).toEqual([lastSeq]);

    // An edit made while a save is out goes after it, on the answered seq.
    saver.add([put('a-1', 13)]);
    const out = saver.save();
    saver.add([put('a-1', 14)]);
    const again = saver.save();
    await Promise.all([out, again]);
    expect(memory.appended.map((entry) => entry.baseSeq)).toEqual([
      lastSeq,
      lastSeq + 1,
      lastSeq + 2,
    ]);
    expect(new Set(memory.appended.map((entry) => entry.id)).size).toBe(3);
  });

  it('sends nothing when nothing changed', async () => {
    const { memory, saver } = await harness();

    expect(await saver.save()).toBe('nothing');
    expect(memory.appended).toHaveLength(0);
  });

  it('retries a failed save with the same id and content, and edits meanwhile go in a later entry', async () => {
    const { memory, saver, lastSeq } = await harness();
    const append = jest.spyOn(memory, 'append');
    append.mockRejectedValueOnce(offline());

    saver.add([put('a-1')]);
    expect(await saver.save()).toBe('failed');
    expect(saver.status()).toBe('failed');
    expect(saver.unsent()).toBe(true);
    expect(saver.nextTryAt()).not.toBeNull();

    saver.add([put('a-2', 16)]);
    expect(await saver.save()).toBe('saved');

    const sent = append.mock.calls.map(([, entry]) => entry);
    expect(sent).toHaveLength(3);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[2]).toMatchObject({
      baseSeq: lastSeq + 1,
      events: [put('a-2', 16)],
    });
  });

  it('drops what is unsent when another phone saved first', async () => {
    const { memory, saver } = await harness();
    memory.appendElsewhere(WALK);

    saver.add([put('a-1')]);
    expect(await saver.save()).toBe('changed');

    expect(saver.status()).toBe('changed');
    expect(saver.unsent()).toBe(false);
  });

  it('drops an entry the server refuses, and does not send it again', async () => {
    const { memory, saver } = await harness();
    jest.spyOn(memory, 'append').mockRejectedValueOnce(
      new GatewayError({
        code: 'shop_map_invalid',
        status: 422,
        correlationId: 'spec',
        details: { problems: [] },
      })
    );

    saver.add([put('a-1')]);
    expect(await saver.save()).toBe('refused');
    expect(saver.unsent()).toBe(false);
  });

  it('saves every 20 s while there are changes', async () => {
    jest.useFakeTimers();
    const { memory, saver } = await harness();

    saver.add([put('a-1')]);
    jest.advanceTimersByTime(WALK_SAVE_EVERY_MS - 1);
    expect(memory.appended).toHaveLength(0);
    jest.advanceTimersByTime(1);
    for (let tick = 0; tick < 6; tick++) {
      await Promise.resolve();
    }

    expect(memory.appended).toHaveLength(1);
  });

  it('sends with keepalive when the page is hidden', async () => {
    const { memory, saver } = await harness();
    const visibility = jest
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('hidden');

    saver.add([put('a-1')]);
    document.dispatchEvent(new Event('visibilitychange'));
    await saver.save();

    expect(memory.appendOptions[0]).toEqual({ keepalive: true });
    visibility.mockRestore();
  });

  it('opens its first entry with one kind and the later ones with another', async () => {
    const { memory, saver, lastSeq, logTo } = await harness();
    saver.begin({
      walkId: WALK,
      baseSeq: lastSeq,
      logTo,
      kind: 'resumed',
      thenKind: 'continued',
    });

    saver.add([{ type: 'path', points: [[logTo + 1000, 1, 1]] }], logTo + 1000);
    await saver.save();
    saver.add([{ type: 'path', points: [[logTo + 2000, 1, 2]] }], logTo + 2000);
    saver.push({ kind: 'stopped', reason: 'button' });
    await saver.save();

    expect(
      memory.appended.map((entry) => [entry.kind, entry.logFrom, entry.logTo])
    ).toEqual([
      ['resumed', logTo, logTo + 1000],
      ['continued', logTo + 1000, logTo + 2000],
      ['stopped', logTo + 2000, logTo + 2000],
    ]);
    expect(memory.appended[2].reason).toBe('button');
  });

  // Velista 0126: a new session in the same page opens as `resumed`.
  it('opens the next entry with the kind asked for, then goes back to thenKind', async () => {
    const { memory, saver, lastSeq, logTo } = await harness();
    saver.begin({
      walkId: WALK,
      baseSeq: lastSeq,
      logTo,
      kind: 'started',
      thenKind: 'continued',
    });

    saver.add([{ type: 'path', points: [[logTo + 1000, 1, 1]] }], logTo + 1000);
    saver.push({ kind: 'confirmed' });
    saver.openNext('resumed');
    saver.add([{ type: 'path', points: [[logTo + 2000, 1, 2]] }], logTo + 2000);
    expect(saver.logEnd()).toBe(logTo + 2000);
    saver.openNext('continued');
    saver.add([{ type: 'path', points: [[logTo + 3000, 1, 3]] }], logTo + 3000);
    await saver.save();

    expect(memory.appended.map((entry) => entry.kind)).toEqual([
      'started',
      'confirmed',
      'resumed',
      'continued',
    ]);
  });
});
