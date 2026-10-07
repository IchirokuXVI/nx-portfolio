import { TestBed } from '@angular/core/testing';
import type {
  Line,
  ListPermission,
  MyZone,
  Page,
  ShoppingListSummary,
} from '@portfolio/velista/models';
import { BrowserFacade, StorageKeys } from '@portfolio/velista/platform';
import { SessionStore } from '../auth/session-store';
import { LINE_SERVICE, type LineServiceI } from '../lines/line-service';
import { LIST_SERVICE, type ListServiceI } from '../lists/list-service';
import { ZONE_SERVICE, type ZoneServiceI } from '../zones/zone-service';
import { CatalogAddStore } from './catalog-add-store';

const MILK = { itemId: 'milk', name: 'Leche', detail: '1 L' };
const BREAD = { itemId: 'bread', name: 'Pan', detail: null };

function zone(id: string, name: string, status = 'APPROVED'): MyZone {
  return { id, name, myStatus: status } as unknown as MyZone;
}

function list(
  id: string,
  zoneId: string,
  permissions: readonly ListPermission[] = ['READ', 'WRITE', 'DECIDE'],
  wantedCount = 0
): ShoppingListSummary {
  return {
    id,
    zoneId,
    name: id,
    wantedCount,
    myPermissions: permissions,
  } as unknown as ShoppingListSummary;
}

function line(id: string, listId: string, overrides: Partial<Line> = {}): Line {
  return {
    id,
    listId,
    content: 'Leche',
    quantity: 1,
    approvalStatus: 'APPROVED',
    ...overrides,
  } as unknown as Line;
}

interface World {
  readonly zones: readonly MyZone[];
  readonly lists: Readonly<Record<string, readonly ShoppingListSummary[]>>;
  readonly guest?: boolean;
  readonly lastList?: string;
}

/**
 * The store over a small world: groups, their lists, and a line service that keeps
 * the lines it is asked to write, so an undo can be read back as the server would
 * hold it.
 */
function setup(world: World) {
  const calls: string[] = [];
  const storage = new Map<string, string>();
  if (world.lastList !== undefined) {
    storage.set(StorageKeys.lastList, world.lastList);
  }

  const held = new Map<string, Line>();
  /** What the next add merges into, by list. Null makes a new line. */
  const mergeInto = new Map<string, Line>();
  let failNext = false;
  let pendingNext = false;
  let nextId = 0;

  const fail = () => {
    if (failNext) {
      failNext = false;
      throw new Error('refused');
    }
  };

  const zones: Partial<ZoneServiceI> = {
    listMyZones: async (): Promise<Page<MyZone>> => {
      calls.push('zones');
      return { items: world.zones, nextCursor: null };
    },
  };
  const lists: Partial<ListServiceI> = {
    listLists: async (zoneId): Promise<Page<ShoppingListSummary>> => {
      calls.push(`lists:${zoneId}`);
      return { items: world.lists[zoneId] ?? [], nextCursor: null };
    },
  };
  const lines: Partial<LineServiceI> = {
    addLineResult: async (listId, content, quantity, itemIds) => {
      calls.push(`add:${listId}:${content}:${quantity}:${itemIds?.join(',')}`);
      fail();
      const existing = mergeInto.get(listId);
      if (existing !== undefined) {
        const raised = { ...existing, quantity: existing.quantity + 1 };
        held.set(raised.id, raised);
        return { line: raised, merged: true };
      }
      const made = line(`line-${++nextId}`, listId, {
        approvalStatus: pendingNext ? 'PENDING' : 'APPROVED',
      });
      pendingNext = false;
      held.set(made.id, made);
      return { line: made, merged: false };
    },
    addQuantity: async (lineId, delta) => {
      calls.push(`quantity:${lineId}:${delta}`);
      fail();
      const current = held.get(lineId) as Line;
      const moved = { ...current, quantity: current.quantity + delta };
      held.set(lineId, moved);
      return moved;
    },
    deleteLine: async (lineId) => {
      calls.push(`delete:${lineId}`);
      fail();
      held.delete(lineId);
      return lineId;
    },
  };

  TestBed.configureTestingModule({
    providers: [
      CatalogAddStore,
      { provide: ZONE_SERVICE, useValue: zones },
      { provide: LIST_SERVICE, useValue: lists },
      { provide: LINE_SERVICE, useValue: lines },
      {
        provide: SessionStore,
        useValue: { isGuest: () => world.guest === true },
      },
      {
        provide: BrowserFacade,
        useValue: {
          readStorage: (key: string) => storage.get(key) ?? null,
          writeStorage: (key: string, value: string) => {
            storage.set(key, value);
          },
        },
      },
    ],
  });

  return {
    store: TestBed.inject(CatalogAddStore),
    calls,
    storage,
    held,
    mergeInto,
    failNext: () => {
      failNext = true;
    },
    pendingNext: () => {
      pendingNext = true;
    },
  };
}

const HOME: World = {
  zones: [zone('home', 'Home'), zone('parents', "Parents' house")],
  lists: {
    home: [list('weekly', 'home', undefined, 14), list('barbecue', 'home')],
    parents: [list('mum', 'parents'), list('dad', 'parents', ['READ'])],
  },
};

describe('CatalogAddStore', () => {
  describe('the list the plus adds to', () => {
    it('reads every group and keeps the lists the person can write to', async () => {
      const { store, calls } = setup(HOME);

      await store.ensure();

      expect(calls).toEqual(['zones', 'lists:home', 'lists:parents']);
      expect(store.lists().map((held) => held.listId)).toEqual([
        'weekly',
        'barbecue',
        'mum',
      ]);
      expect(store.lists()[0]).toMatchObject({
        zoneName: 'Home',
        wanted: 14,
        zoneId: 'home',
      });
    });

    it('opens on the last used list', async () => {
      const { store } = setup({ ...HOME, lastList: 'parents/mum' });

      await store.ensure();

      expect(store.target()?.listId).toBe('mum');
    });

    it('takes the first writable list when the last used one is read only or gone', async () => {
      const readOnly = setup({ ...HOME, lastList: 'parents/dad' });
      await readOnly.store.ensure();
      expect(readOnly.store.target()?.listId).toBe('weekly');

      TestBed.resetTestingModule();
      const gone = setup({ ...HOME, lastList: 'home/deleted' });
      await gone.store.ensure();
      expect(gone.store.target()?.listId).toBe('weekly');
    });

    it('has no list for a guest, and asks for none', async () => {
      const { store, calls } = setup({ ...HOME, guest: true });

      await store.ensure();

      expect(calls).toEqual([]);
      expect(store.ready()).toBe(true);
      expect(store.target()).toBeNull();
    });

    it('has no list for a person who can only read', async () => {
      const { store } = setup({
        zones: [zone('parents', "Parents' house")],
        lists: { parents: [list('dad', 'parents', ['READ'])] },
      });

      await store.ensure();

      expect(store.target()).toBeNull();
    });

    it('skips a group the person has only asked to join', async () => {
      const { store, calls } = setup({
        zones: [zone('home', 'Home'), zone('asked', 'Asked', 'PENDING')],
        lists: { home: [list('weekly', 'home')] },
      });

      await store.ensure();

      expect(calls).toEqual(['zones', 'lists:home']);
    });

    it('reads the lists once for the visit', async () => {
      const { store, calls } = setup(HOME);

      await Promise.all([store.ensure(), store.ensure()]);
      await store.ensure();

      expect(calls.filter((call) => call === 'zones')).toHaveLength(1);
    });

    it('writes a choice as the last used list', async () => {
      const { store, storage } = setup(HOME);
      await store.ensure();

      store.choose('mum');

      expect(store.target()?.listId).toBe('mum');
      expect(storage.get(StorageKeys.lastList)).toBe('parents/mum');
    });

    it('ignores a choice of a list it does not offer', async () => {
      const { store, storage } = setup(HOME);
      await store.ensure();

      store.choose('dad');

      expect(store.target()?.listId).toBe('weekly');
      expect(storage.has(StorageKeys.lastList)).toBe(false);
    });
  });

  describe('adding', () => {
    it('adds one of the product, named as the reader reads it', async () => {
      const { store, calls } = setup(HOME);
      await store.ensure();

      await store.add(MILK);

      expect(calls).toContain('add:weekly:Leche:1:milk');
      expect(store.additionOf('milk')).toMatchObject({
        lineId: 'line-1',
        quantity: 1,
        before: 0,
        created: true,
        detail: '1 L',
      });
      expect(store.count()).toBe(1);
    });

    it('draws the count before the answer', async () => {
      const { store } = setup(HOME);
      await store.ensure();

      const adding = store.add(MILK);

      expect(store.additionOf('milk')?.quantity).toBe(1);
      await adding;
    });

    it('records what a merged line held before', async () => {
      const { store, mergeInto } = setup(HOME);
      await store.ensure();
      mergeInto.set('weekly', line('old', 'weekly', { quantity: 2 }));

      await store.add(MILK);

      expect(store.additionOf('milk')).toMatchObject({
        lineId: 'old',
        quantity: 3,
        before: 2,
        created: false,
      });
    });

    it('records a line that waits for approval', async () => {
      const { store, pendingNext } = setup(HOME);
      await store.ensure();
      pendingNext();

      await store.add(MILK);

      expect(store.additionOf('milk')?.pending).toBe(true);
    });

    it('raises the same line on a second press, rather than adding again', async () => {
      const { store, calls } = setup(HOME);
      await store.ensure();

      await store.add(MILK);
      await store.add(MILK);

      expect(calls.filter((call) => call.startsWith('add:'))).toHaveLength(1);
      expect(calls).toContain('quantity:line-1:1');
      expect(store.additionOf('milk')?.quantity).toBe(2);
      expect(store.count()).toBe(1);
    });

    it('keeps two quick presses as two writes, in order', async () => {
      const { store, calls } = setup(HOME);
      await store.ensure();

      await Promise.all([store.add(MILK), store.add(MILK)]);

      expect(calls.slice(-2)).toEqual([
        'add:weekly:Leche:1:milk',
        'quantity:line-1:1',
      ]);
      expect(store.additionOf('milk')?.quantity).toBe(2);
    });

    it('puts the count back and counts the failure when the add is refused', async () => {
      const { store, failNext } = setup(HOME);
      await store.ensure();
      failNext();

      await store.add(MILK);

      expect(store.additionOf('milk')).toBeNull();
      expect(store.count()).toBe(0);
      expect(store.failures()).toBe(1);
    });

    it('puts the quantity back when a step is refused', async () => {
      const { store, failNext } = setup(HOME);
      await store.ensure();
      await store.add(MILK);
      failNext();

      await store.step('weekly', 'milk', 1);

      expect(store.additionOf('milk')?.quantity).toBe(1);
      expect(store.failures()).toBe(1);
    });

    it('adds nothing with no list to add to', async () => {
      const { store, calls } = setup({ ...HOME, guest: true });
      await store.ensure();

      await store.add(MILK);

      expect(calls).toEqual([]);
      expect(store.count()).toBe(0);
    });

    it('counts a product once for each list it was added to', async () => {
      const { store } = setup(HOME);
      await store.ensure();

      await store.add(MILK);
      store.choose('barbecue');
      await store.add(MILK);

      expect(store.count()).toBe(2);
      expect(store.additionOf('milk')?.listId).toBe('barbecue');
    });
  });

  describe('taking back', () => {
    it('deletes a line the visit made, for somebody who manages the list', async () => {
      const { store, calls, held } = setup({
        zones: [zone('home', 'Home')],
        lists: {
          home: [list('weekly', 'home', ['READ', 'WRITE', 'DECIDE', 'MANAGE'])],
        },
      });
      await store.ensure();
      await store.add(MILK);

      await store.step('weekly', 'milk', -1);

      expect(calls).toContain('delete:line-1');
      expect(held.size).toBe(0);
      expect(store.count()).toBe(0);
    });

    it('puts a merged line back to the quantity it had, and no lower', async () => {
      const { store, calls, held, mergeInto } = setup(HOME);
      await store.ensure();
      mergeInto.set('weekly', line('old', 'weekly', { quantity: 2 }));
      await store.add(MILK);
      await store.step('weekly', 'milk', 1);
      expect(held.get('old')?.quantity).toBe(4);

      await store.takeBack('weekly', 'milk');

      expect(calls).toContain('quantity:old:-2');
      expect(calls.some((call) => call.startsWith('delete:'))).toBe(false);
      expect(held.get('old')?.quantity).toBe(2);
      expect(store.additionOf('milk')).toBeNull();
    });

    it('takes back with the minus at the floor of a merged line, not below it', async () => {
      const { store, held, mergeInto } = setup(HOME);
      await store.ensure();
      mergeInto.set('weekly', line('old', 'weekly', { quantity: 2 }));
      await store.add(MILK);

      await store.step('weekly', 'milk', -1);

      expect(held.get('old')?.quantity).toBe(2);
      expect(store.additionOf('milk')).toBeNull();
    });

    it('lowers by one above the floor', async () => {
      const { store, calls } = setup(HOME);
      await store.ensure();
      await store.add(MILK);
      await store.add(MILK);

      await store.step('weekly', 'milk', -1);

      expect(calls).toContain('quantity:line-1:-1');
      expect(store.additionOf('milk')?.quantity).toBe(1);
    });

    it('lowers an approved line it made to nothing when it cannot delete it', async () => {
      // `HOME` gives READ, WRITE and DECIDE. Only MANAGE deletes an approved line.
      const { store, calls, held } = setup(HOME);
      await store.ensure();
      await store.add(MILK);

      await store.takeBack('weekly', 'milk');

      expect(calls).toContain('quantity:line-1:-1');
      expect(held.get('line-1')?.quantity).toBe(0);
    });

    it('takes back everything on one list and leaves the other', async () => {
      const { store } = setup(HOME);
      await store.ensure();
      await store.add(MILK);
      await store.add(BREAD);
      store.choose('barbecue');
      await store.add(MILK);

      await store.takeAllBack('weekly');

      expect(store.visit().map((held) => held.listId)).toEqual(['barbecue']);
    });

    it('keeps the entry, where it was, when the undo is refused', async () => {
      const { store, failNext } = setup(HOME);
      await store.ensure();
      await store.add(MILK);
      await store.add(BREAD);
      failNext();

      await store.takeBack('weekly', 'milk');

      expect(store.visit().map((held) => held.itemId)).toEqual([
        'milk',
        'bread',
      ]);
      expect(store.failures()).toBe(1);
    });
  });

  describe('the record of the visit', () => {
    it('survives every page under the catalog, a product page included', async () => {
      const { store } = setup(HOME);
      await store.ensure();
      await store.add(MILK);

      store.visited('/en/catalog/products/milk');
      store.visited('/en/catalog/categories');
      store.visited('/en/catalog/products/milk/sheet/add-list');
      store.visited('/en/catalog?chain=mercadona');

      expect(store.count()).toBe(1);
      expect(store.target()?.listId).toBe('weekly');
    });

    it('joins what a product page adds to what the catalog added', async () => {
      const { store } = setup(HOME);
      await store.ensure();
      await store.add(MILK);

      store.visited('/en/catalog/products/milk');
      await store.add(BREAD);
      store.visited('/en/catalog');

      expect(store.visit().map((held) => held.itemId)).toEqual([
        'milk',
        'bread',
      ]);
    });

    it('is erased when a navigation ends outside the catalog', async () => {
      const { store, held } = setup(HOME);
      await store.ensure();
      await store.add(MILK);

      store.visited('/en/home');

      expect(store.count()).toBe(0);
      expect(store.target()).toBeNull();
      expect(store.ready()).toBe(false);
      // The line stays on its list. Only the record goes.
      expect(held.size).toBe(1);
    });

    it('reads the lists again on the next visit', async () => {
      const { store, calls } = setup(HOME);
      await store.ensure();
      store.visited('/en/home');

      await store.ensure();

      expect(calls.filter((call) => call === 'zones')).toHaveLength(2);
      expect(store.target()?.listId).toBe('weekly');
    });

    it('drops an answer that arrives after the visit ended', async () => {
      const { store } = setup(HOME);
      await store.ensure();

      const adding = store.add(MILK);
      store.visited('/en/home');
      await adding;

      expect(store.count()).toBe(0);
      expect(store.failures()).toBe(0);
    });
  });
});
