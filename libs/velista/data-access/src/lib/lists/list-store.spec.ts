import { TestBed } from '@angular/core/testing';
import type { Page, ShoppingListSummary } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { Mutations } from '../mutations';
import { REALTIME_CLIENT } from '../realtime/realtime-client';
import { RealtimeMemory } from '../realtime/realtime-memory';
import { LIST_SERVICE, type ListServiceI } from './list-service';
import { ListStore } from './list-store';

const ZONE = 'zone-1';

function list(
  id: string,
  overrides: Partial<ShoppingListSummary> = {}
): ShoppingListSummary {
  return {
    id,
    zoneId: ZONE,
    name: 'Weekly shop',
    createdByUserId: 'u1',
    lineCount: 12,
    wantedCount: 7,
    autoApproveLines: false,
    myPermissions: ['READ', 'WRITE', 'DECIDE'],
    ...overrides,
  };
}

/** A service that counts its calls, so a refetch is observable. */
function service(seed: readonly ShoppingListSummary[]) {
  let current = seed;
  const calls: string[] = [];

  const impl: ListServiceI = {
    listLists: async (zoneId): Promise<Page<ShoppingListSummary>> => {
      calls.push(zoneId);
      return { items: current, nextCursor: null };
    },
    createList: async (zoneId, name) => list('list-new', { zoneId, name }),
  };

  return {
    ...impl,
    calls,
    /** Change what the server would answer next, to prove a refetch actually reran. */
    setServed: (next: readonly ShoppingListSummary[]) => {
      current = next;
    },
  };
}

async function build(seed: readonly ShoppingListSummary[] = []) {
  TestBed.resetTestingModule();

  const lists = service(seed);
  const realtime = new RealtimeMemory();

  await TestBed.configureTestingModule({
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      Mutations,
      ListStore,
      { provide: LIST_SERVICE, useValue: lists },
      { provide: REALTIME_CLIENT, useValue: realtime },
    ],
  }).compileComponents();

  return { store: TestBed.inject(ListStore), lists, realtime };
}

describe('ListStore', () => {
  it('loads a zone and reports its state', async () => {
    const { store } = await build([list('list-1')]);

    expect(store.stateOf(ZONE)).toBe('idle');
    await store.load(ZONE);

    expect(store.stateOf(ZONE)).toBe('loaded');
    expect(store.listsIn(ZONE).map((row) => row.id)).toEqual(['list-1']);
  });

  it('keeps its cache per zone', async () => {
    const { store } = await build([list('list-1')]);
    await store.load(ZONE);

    expect(store.listsIn('zone-other')).toEqual([]);
    expect(store.stateOf('zone-other')).toBe('idle');
  });

  it('reports a failure without throwing at the caller', async () => {
    const { store, lists } = await build();
    jest
      .spyOn(lists, 'listLists')
      .mockRejectedValue(new Error('gateway is down'));

    await store.load(ZONE);

    expect(store.stateOf(ZONE)).toBe('failed');
    expect(store.errorOf(ZONE)).toBeInstanceOf(Error);
  });

  it('shows a created list before any reload confirms it', async () => {
    const { store } = await build();
    await store.load(ZONE);

    const outcome = await store.createList(ZONE, 'Cleaning');

    expect(outcome.state).toBe('created');
    expect(store.listsIn(ZONE).map((row) => row.name)).toContain('Cleaning');
  });

  describe('realtime', () => {
    it('adds a list somebody else created in a zone it holds', async () => {
      const { store, realtime } = await build([list('list-1')]);
      await store.load(ZONE);

      realtime.emit('list.created', {
        id: 'list-2',
        zoneId: ZONE,
        name: 'Cleaning',
        createdByUserId: 'u2',
        counts: { lineCount: 0, wantedCount: 0 },
      });

      expect(store.listsIn(ZONE).map((row) => row.id)).toEqual([
        'list-2',
        'list-1',
      ]);
    });

    it('ignores a list in a zone it has never loaded', async () => {
      // Inventing a partial cache from an event would make the next `load` look like
      // a refresh of data that was never there.
      const { store, realtime } = await build();

      realtime.emit('list.created', {
        id: 'list-2',
        zoneId: 'zone-elsewhere',
        name: 'Cleaning',
        createdByUserId: 'u2',
        counts: { lineCount: 0, wantedCount: 0 },
      });

      expect(store.listsIn('zone-elsewhere')).toEqual([]);
    });

    it('renames in place without losing the counts', async () => {
      const { store, realtime } = await build([list('list-1')]);
      await store.load(ZONE);

      realtime.emit('list.updated', {
        id: 'list-1',
        zoneId: ZONE,
        name: 'Big shop',
        createdByUserId: 'u1',
      });

      expect(store.listsIn(ZONE)[0]).toMatchObject({
        name: 'Big shop',
        lineCount: 12,
        wantedCount: 7,
      });
    });

    it('drops a deleted list', async () => {
      const { store, realtime } = await build([list('list-1'), list('list-2')]);
      await store.load(ZONE);

      realtime.emit('list.deleted', { id: 'list-1', listId: 'list-1' });

      expect(store.listsIn(ZONE).map((row) => row.id)).toEqual(['list-2']);
    });

    describe('list.myAccessChanged (plan 0030, section 8)', () => {
      it('rewrites the set in place, with no refetch', async () => {
        // Rule G2 for this screen: the page redraws from the new set, so a control the
        // caller may no longer press is gone before they press it. A refetch here would
        // blink the lines of a page somebody is looking at.
        const { store, lists, realtime } = await build([list('list-1')]);
        await store.load(ZONE);
        expect(lists.calls).toHaveLength(1);

        realtime.emit('list.myAccessChanged', {
          listId: 'list-1',
          zoneId: ZONE,
          permissions: ['READ'],
        });

        expect(store.listsIn(ZONE)[0].myPermissions).toEqual(['READ']);
        expect(lists.calls).toHaveLength(1);
      });

      it('takes the list away when the set is empty', async () => {
        // The existing `gone: 'unshared'` path: the page reaches it from the list no
        // longer being in the zone's answer, and the event is the answer.
        const { store, realtime } = await build([
          list('list-1'),
          list('list-2'),
        ]);
        await store.load(ZONE);

        realtime.emit('list.myAccessChanged', {
          listId: 'list-1',
          zoneId: ZONE,
          permissions: [],
        });

        expect(store.listsIn(ZONE).map((row) => row.id)).toEqual(['list-2']);
      });

      it('fetches the zone when the set grew from nothing', async () => {
        // The case the room event could never deliver: somebody with no access was
        // never in the list room. The event carries a permission set and not a list, so
        // there is no name or counts to draw a row from.
        const { store, lists, realtime } = await build([list('list-1')]);
        await store.load(ZONE);
        lists.setServed([list('list-1'), list('list-9', { name: 'Shared' })]);

        realtime.emit('list.myAccessChanged', {
          listId: 'list-9',
          zoneId: ZONE,
          permissions: ['READ', 'WRITE'],
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(lists.calls).toHaveLength(2);
        expect(store.listsIn(ZONE).map((row) => row.id)).toEqual([
          'list-1',
          'list-9',
        ]);
      });

      it('ignores a grant in a zone it has never loaded', async () => {
        // Nothing of that zone is on screen, so there is nothing to make appear, and
        // the next `load` will fetch it anyway.
        const { store, lists, realtime } = await build([list('list-1')]);
        await store.load(ZONE);

        realtime.emit('list.myAccessChanged', {
          listId: 'list-elsewhere',
          zoneId: 'zone-elsewhere',
          permissions: ['READ'],
        });
        await Promise.resolve();

        expect(lists.calls).toHaveLength(1);
      });

      it('drops a payload with no zone id rather than acting on half of it', async () => {
        const { store, lists, realtime } = await build([list('list-1')]);
        await store.load(ZONE);

        realtime.emit('list.myAccessChanged', {
          listId: 'list-1',
          permissions: [],
        });

        expect(store.listsIn(ZONE)).toHaveLength(1);
        expect(lists.calls).toHaveLength(1);
      });
    });

    it('refetches on accessChanged, because the event cannot say which way', async () => {
      // It carries only a `listId`, and its meaning is "your access may have changed,
      // including to none". Dropping the list would flicker it off screen for somebody
      // whose access only widened; keeping it would leave one they can no longer open
      // (section 5.2).
      const { store, lists, realtime } = await build([list('list-1')]);
      await store.load(ZONE);
      expect(lists.calls).toHaveLength(1);

      lists.setServed([list('list-1'), list('list-9', { name: 'Shared' })]);
      realtime.emit('list.accessChanged', { listId: 'list-1' });
      await Promise.resolve();
      await Promise.resolve();

      expect(lists.calls).toHaveLength(2);
      expect(store.listsIn(ZONE).map((row) => row.id)).toEqual([
        'list-1',
        'list-9',
      ]);
    });
  });
});
