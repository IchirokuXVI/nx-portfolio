import { TestBed } from '@angular/core/testing';
import type {
  HeldLine,
  ItemLists,
  Line,
  ListPermission,
  MyZone,
  Page,
  ShoppingListSummary,
  VisitProduct,
} from '@portfolio/velista/models';
import { BrowserFacade, StorageKeys } from '@portfolio/velista/platform';
import { SessionStore } from '../auth/session-store';
import { LINE_SERVICE, type LineServiceI } from '../lines/line-service';
import { LIST_SERVICE, type ListServiceI } from '../lists/list-service';
import { ZONE_SERVICE, type ZoneServiceI } from '../zones/zone-service';
import { CatalogAddStore } from './catalog-add-store';

const MILK = { itemId: 'milk', name: 'Leche', detail: '1 L' };
const BREAD = { itemId: 'bread', name: 'Pan', detail: null };

/** The product a stepper moves, as the row that holds the stepper names it. */
function on(listId: string, product: typeof MILK | typeof BREAD): VisitProduct {
  return { listId, itemId: product.itemId, detail: product.detail };
}

function zone(id: string, name: string, status = 'APPROVED'): MyZone {
  return { id, name, myStatus: status } as unknown as MyZone;
}

function list(
  id: string,
  zoneId: string,
  permissions: readonly ListPermission[] = ['READ', 'WRITE', 'DECIDE'],
  options: { wantedCount?: number; autoApproveLines?: boolean } = {}
): ShoppingListSummary {
  return {
    id,
    zoneId,
    name: id,
    wantedCount: options.wantedCount ?? 0,
    autoApproveLines: options.autoApproveLines === true,
    myPermissions: permissions,
  } as unknown as ShoppingListSummary;
}

/** A line that holds the milk under the milk's own name, unless a spec says otherwise. */
function line(id: string, listId: string, overrides: Partial<Line> = {}): Line {
  return {
    id,
    listId,
    content: 'Leche',
    quantity: 1,
    itemIds: ['milk'],
    productGroupId: null,
    groupItemIds: [],
    position: 1,
    approvalStatus: 'APPROVED',
    boughtCount: 0,
    lastSettlementOutcome: null,
    claimed: false,
    claimedByUserId: null,
    createdByUserId: 'user-me',
    approvedByUserId: 'user-me',
    version: 1,
    ...overrides,
  };
}

interface World {
  readonly zones: readonly MyZone[];
  readonly lists: Readonly<Record<string, readonly ShoppingListSummary[]>>;
  /** The lines the lists hold before the visit starts. */
  readonly lines?: readonly Line[];
  readonly guest?: boolean;
  readonly lastList?: string;
  /** How many lines one page of a list answers. A hundred, as the store asks. */
  readonly linePageSize?: number;
}

/** After every promise that is already on its way has answered. */
function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The store over a small world: groups, their lists, and a line service that keeps
 * the lines it is asked to write, so an undo can be read back as the server would
 * hold it.
 *
 * The fake merges an add the way the server does: onto the line of the same list
 * that says the same name and is still wanted. A line at zero is stocked, and an
 * add makes a new line beside it. Its writes can be held open, so a spec can look
 * at what the store draws while an answer is still on its way. Its reads of lines
 * can be held open too: such a read answers what the server held when it was
 * sent, however late the answer comes.
 */
function setup(world: World) {
  const calls: string[] = [];
  const storage = new Map<string, string>();
  if (world.lastList !== undefined) {
    storage.set(StorageKeys.lastList, world.lastList);
  }

  const server = new Map<string, Line>(
    (world.lines ?? []).map((held) => [held.id, held])
  );
  let failNext = false;
  let failNextRead = false;
  let failNextLists = false;
  let pendingNext = false;
  let nextId = 0;
  let holding = false;
  const gates: (() => void)[] = [];
  let holdingReads = false;
  const readGates: (() => void)[] = [];

  /** Every write passes here first: it waits while writes are held, then may be refused. */
  const written = async (): Promise<void> => {
    if (holding) {
      await new Promise<void>((resolve) => gates.push(resolve));
    }
    if (failNext) {
      failNext = false;
      throw new Error('refused');
    }
  };

  const read = (): void => {
    if (failNextRead) {
      failNextRead = false;
      throw new Error('no answer');
    }
  };

  /**
   * A read of lines answers through here. The answer was made when the read was
   * sent, so a write that lands while it waits is not in it.
   */
  const answered = async <T>(answer: T): Promise<T> => {
    if (holdingReads) {
      await new Promise<void>((resolve) => readGates.push(resolve));
    }
    return answer;
  };

  const fold = (value: string) => value.trim().toLocaleLowerCase();
  const linesOf = (listId: string) =>
    [...server.values()].filter((held) => held.listId === listId);

  const zones: Partial<ZoneServiceI> = {
    listMyZones: async (): Promise<Page<MyZone>> => {
      calls.push('zones');
      if (failNextLists) {
        failNextLists = false;
        throw new Error('no answer');
      }
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
    listLines: async (listId, options): Promise<Page<Line>> => {
      const cursor = options?.cursor;
      calls.push(
        cursor === undefined ? `lines:${listId}` : `lines:${listId}@${cursor}`
      );
      read();
      const all = linesOf(listId);
      const start = cursor === undefined ? 0 : Number(cursor);
      const end = start + (world.linePageSize ?? 100);
      return answered({
        items: all.slice(start, end),
        nextCursor: end < all.length ? String(end) : null,
      });
    },
    linesHoldingItem: async (itemId): Promise<ItemLists> => {
      calls.push(`item:${itemId}`);
      read();
      // Every list the person can read, a read only one included, and the lines
      // of each that hold the product. A rejected line is left out.
      const readable = world.zones
        .filter((held) => held.myStatus === 'APPROVED')
        .flatMap((held) =>
          (world.lists[held.id] ?? [])
            .filter((entry) => entry.myPermissions.includes('READ'))
            .map((entry) => ({
              listId: entry.id,
              zoneId: held.id,
              name: entry.name,
              zoneName: held.name,
              autoApproveLines: entry.autoApproveLines,
              permissions: entry.myPermissions,
            }))
        );
      return answered({
        lists: readable,
        lines: readable.flatMap((entry) =>
          linesOf(entry.listId)
            .filter(
              (held) =>
                held.itemIds.includes(itemId) &&
                held.approvalStatus !== 'REJECTED'
            )
            .map(
              (held): HeldLine => ({
                lineId: held.id,
                listId: held.listId,
                name: held.content,
                quantity: held.quantity,
                pending: held.approvalStatus === 'PENDING',
                itemIds: [itemId],
              })
            )
        ),
        hasMore: false,
      });
    },
    addLineResult: async (listId, content, quantity, itemIds) => {
      calls.push(`add:${listId}:${content}:${quantity}:${itemIds?.join(',')}`);
      await written();
      const existing = linesOf(listId).find(
        (held) =>
          held.approvalStatus !== 'REJECTED' &&
          held.quantity > 0 &&
          fold(held.content) === fold(content)
      );
      if (existing !== undefined) {
        const raised = {
          ...existing,
          quantity: existing.quantity + (quantity ?? 1),
        };
        server.set(raised.id, raised);
        return { line: raised, merged: true };
      }
      const made = line(`line-${++nextId}`, listId, {
        content,
        quantity: quantity ?? 1,
        itemIds: [...(itemIds ?? [])],
        approvalStatus: pendingNext ? 'PENDING' : 'APPROVED',
      });
      pendingNext = false;
      server.set(made.id, made);
      return { line: made, merged: false };
    },
    addQuantity: async (lineId, delta) => {
      calls.push(`quantity:${lineId}:${delta}`);
      await written();
      const current = server.get(lineId) as Line;
      const moved = { ...current, quantity: current.quantity + delta };
      server.set(lineId, moved);
      return moved;
    },
    deleteLine: async (lineId) => {
      calls.push(`delete:${lineId}`);
      await written();
      server.delete(lineId);
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

  const store = TestBed.inject(CatalogAddStore);

  return {
    store,
    calls,
    storage,
    /** The lines as the server holds them. */
    server,
    /** The quantity of each line the store draws for one product on one list. */
    drawn: (listId: string, itemId: string): readonly number[] =>
      store
        .held()
        .filter(
          (held) => held.listId === listId && held.itemIds.includes(itemId)
        )
        .map((held) => held.quantity),
    failNext: () => {
      failNext = true;
    },
    failNextRead: () => {
      failNextRead = true;
    },
    failNextLists: () => {
      failNextLists = true;
    },
    pendingNext: () => {
      pendingNext = true;
    },
    /** Leave every write from here on unanswered until {@link releaseNext}. */
    holdWrites: () => {
      holding = true;
    },
    /** Answer the oldest write that waits. */
    releaseNext: () => {
      gates.shift()?.();
    },
    /** Leave every read of lines from here on unanswered until {@link releaseRead}. */
    holdReads: () => {
      holdingReads = true;
    },
    /** Answer the oldest read of lines that waits, with what it saw when it was sent. */
    releaseRead: () => {
      readGates.shift()?.();
    },
  };
}

const HOME: World = {
  zones: [zone('home', 'Home'), zone('parents', "Parents' house")],
  lists: {
    home: [
      list('weekly', 'home', undefined, { wantedCount: 14 }),
      list('barbecue', 'home'),
    ],
    parents: [list('mum', 'parents'), list('dad', 'parents', ['READ'])],
  },
};

/** One list, with what the person may do on it stated by the spec. */
function alone(
  permissions: readonly ListPermission[],
  autoApproveLines = false
): World {
  return {
    zones: [zone('home', 'Home')],
    lists: {
      home: [list('weekly', 'home', permissions, { autoApproveLines })],
    },
  };
}

describe('CatalogAddStore', () => {
  describe('the list the plus adds to', () => {
    it('reads every group and keeps the lists the person can write to', async () => {
      const { store, calls } = setup(HOME);

      await store.ensure();

      expect(calls).toEqual([
        'zones',
        'lists:home',
        'lists:parents',
        'lines:weekly',
      ]);
      expect(store.lists().map((held) => held.listId)).toEqual([
        'weekly',
        'barbecue',
        'mum',
      ]);
      expect(store.lists()[0]).toMatchObject({
        zoneName: 'Home',
        wanted: 14,
        zoneId: 'home',
        permissions: ['READ', 'WRITE', 'DECIDE'],
        autoApproveLines: false,
      });
    });

    it('opens on the last used list', async () => {
      const { store } = setup({ ...HOME, lastList: 'parents/mum' });

      await store.ensure();

      expect(store.target()?.listId).toBe('mum');
    });

    it('takes the first writable list with no last used one', async () => {
      const { store } = setup(HOME);

      await store.ensure();

      expect(store.target()?.listId).toBe('weekly');
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

    it('has no list for a guest, and reads nothing', async () => {
      const { store, calls } = setup({ ...HOME, guest: true });

      await store.ensure();

      expect(calls).toEqual([]);
      expect(store.ready()).toBe(true);
      expect(store.target()).toBeNull();
      expect(store.linesStatus()).toBe('idle');
      expect(store.held()).toEqual([]);
    });

    it('has no list for a person who can only read', async () => {
      const { store, calls } = setup({
        zones: [zone('parents', "Parents' house")],
        lists: { parents: [list('dad', 'parents', ['READ'])] },
      });

      await store.ensure();

      expect(store.target()).toBeNull();
      expect(calls.some((call) => call.startsWith('lines:'))).toBe(false);
    });

    it('skips a group the person has only asked to join', async () => {
      const { store, calls } = setup({
        zones: [zone('home', 'Home'), zone('asked', 'Asked', 'PENDING')],
        lists: { home: [list('weekly', 'home')] },
      });

      await store.ensure();

      expect(calls).toEqual(['zones', 'lists:home', 'lines:weekly']);
    });

    it('reads the lists once for the visit', async () => {
      const { store, calls } = setup(HOME);

      await Promise.all([store.ensure(), store.ensure()]);
      await store.ensure();

      expect(calls.filter((call) => call === 'zones')).toHaveLength(1);
    });

    it('says the read failed, and reads again on a second try', async () => {
      const { store, calls, failNextLists } = setup(HOME);
      failNextLists();

      await store.ensure();

      expect(store.status()).toBe('failed');
      expect(store.ready()).toBe(false);
      expect(store.target()).toBeNull();

      await store.retry();

      expect(store.status()).toBe('ready');
      expect(store.target()?.listId).toBe('weekly');
      expect(calls.filter((call) => call === 'zones')).toHaveLength(2);
    });

    it('writes a choice as the last used list', async () => {
      const { store, storage } = setup(HOME);
      await store.ensure();

      store.choose('mum');

      expect(store.target()?.listId).toBe('mum');
      expect(storage.get(StorageKeys.lastList)).toBe('parents/mum');
    });

    it('ignores a choice of a list it does not offer', async () => {
      const { store, storage, calls } = setup(HOME);
      await store.ensure();

      store.choose('dad');
      await settled();

      expect(store.target()?.listId).toBe('weekly');
      expect(storage.has(StorageKeys.lastList)).toBe(false);
      expect(calls).not.toContain('lines:dad');
    });
  });

  describe('the lines of the chosen list', () => {
    const STOCKED: World = {
      ...HOME,
      lines: [
        line('w-milk', 'weekly', { quantity: 2 }),
        // Free text holds no product, so no row of the catalog can show it.
        line('w-note', 'weekly', { content: 'Something sweet', itemIds: [] }),
        // An add does not raise a rejected line, so no stepper should move it.
        line('w-no', 'weekly', {
          content: 'Pan',
          itemIds: ['bread'],
          approvalStatus: 'REJECTED',
        }),
        line('w-wait', 'weekly', {
          content: 'Pan de molde',
          itemIds: ['bread'],
          approvalStatus: 'PENDING',
        }),
        line('m-milk', 'mum', { quantity: 5 }),
      ],
    };

    it('reads the lines that hold a product, and leaves a rejected one out', async () => {
      const { store } = setup(STOCKED);

      await store.ensure();

      expect(store.linesStatus()).toBe('ready');
      expect(store.held()).toEqual([
        {
          lineId: 'w-milk',
          listId: 'weekly',
          name: 'Leche',
          quantity: 2,
          pending: false,
          itemIds: ['milk'],
        },
        {
          lineId: 'w-wait',
          listId: 'weekly',
          name: 'Pan de molde',
          quantity: 1,
          pending: true,
          itemIds: ['bread'],
        },
      ]);
    });

    it('follows the cursor to the last page', async () => {
      const { store, calls } = setup({ ...STOCKED, linePageSize: 2 });

      await store.ensure();

      expect(calls.filter((call) => call.startsWith('lines:'))).toEqual([
        'lines:weekly',
        'lines:weekly@2',
      ]);
      expect(store.held().map((held) => held.lineId)).toEqual([
        'w-milk',
        'w-wait',
      ]);
    });

    it('reads the lines of another list when it is chosen, and keeps the first', async () => {
      const { store, calls } = setup(STOCKED);
      await store.ensure();

      store.choose('mum');

      expect(store.linesStatus()).toBe('loading');
      await settled();
      expect(store.linesStatus()).toBe('ready');
      expect(calls).toContain('lines:mum');
      expect(store.held().map((held) => held.lineId)).toEqual([
        'w-milk',
        'w-wait',
        'm-milk',
      ]);
    });

    it('does not read a list again when the person comes back to it', async () => {
      const { store, calls } = setup(STOCKED);
      await store.ensure();
      store.choose('mum');
      await settled();

      store.choose('weekly');
      await settled();

      expect(calls.filter((call) => call === 'lines:weekly')).toHaveLength(1);
      expect(store.linesStatus()).toBe('ready');
    });

    it('says the lines were not read, and reads them again on a second try', async () => {
      const { store, calls, failNextRead } = setup(STOCKED);
      failNextRead();

      await store.ensure();

      // The lists were read, so the plus still knows where it adds. Only what
      // the list already holds is unknown.
      expect(store.status()).toBe('ready');
      expect(store.target()?.listId).toBe('weekly');
      expect(store.linesStatus()).toBe('failed');
      expect(store.held()).toEqual([]);

      await store.retry();

      expect(store.linesStatus()).toBe('ready');
      expect(store.held().map((held) => held.lineId)).toEqual([
        'w-milk',
        'w-wait',
      ]);
      expect(calls.filter((call) => call === 'zones')).toHaveLength(1);
      expect(calls.filter((call) => call === 'lines:weekly')).toHaveLength(2);
    });

    it('reads nothing on a second try when nothing failed', async () => {
      const { store, calls } = setup(STOCKED);
      await store.ensure();
      const before = calls.length;

      await store.retry();

      expect(calls).toHaveLength(before);
    });

    it('keeps a line an add made while the read of its list was on its way', async () => {
      const { store, drawn, holdReads, releaseRead } = setup(STOCKED);
      await store.ensure();
      holdReads();
      store.choose('barbecue');

      // The read was sent before the add, so its answer does not know the line.
      await store.add(MILK);
      releaseRead();
      await settled();

      expect(store.linesStatus()).toBe('ready');
      expect(drawn('barbecue', 'milk')).toEqual([1]);
      expect(store.held().map((held) => held.lineId)).toContain('line-1');
      expect(store.count()).toBe(1);
    });

    it('does not put an older quantity back on a line an add raised meanwhile', async () => {
      const { store, server, drawn, holdReads, releaseRead } = setup(STOCKED);
      await store.ensure();
      holdReads();
      store.choose('mum');

      await store.add(MILK);
      expect(server.get('m-milk')?.quantity).toBe(6);
      // The read answers the five the line held when it was sent.
      releaseRead();
      await settled();

      expect(store.linesStatus()).toBe('ready');
      expect(drawn('mum', 'milk')).toEqual([6]);
      expect(
        store.held().filter((held) => held.lineId === 'm-milk')
      ).toHaveLength(1);
    });

    it('reads again the lines of a chosen list whose read failed', async () => {
      const { store, failNextRead } = setup(STOCKED);
      await store.ensure();
      failNextRead();
      store.choose('mum');
      await settled();
      expect(store.linesStatus()).toBe('failed');

      await store.retry();

      expect(store.linesStatus()).toBe('ready');
      expect(store.held().map((held) => held.lineId)).toContain('m-milk');
    });
  });

  describe('adding', () => {
    it('adds one of the product, named as the reader reads it', async () => {
      const { store, calls, drawn } = setup(HOME);
      await store.ensure();

      await store.add(MILK);

      expect(calls).toContain('add:weekly:Leche:1:milk');
      expect(store.visit()).toEqual([
        {
          listId: 'weekly',
          itemId: 'milk',
          lineId: 'line-1',
          name: 'Leche',
          detail: '1 L',
          quantity: 1,
          before: 0,
          created: true,
          pending: false,
        },
      ]);
      expect(store.count()).toBe(1);
      expect(drawn('weekly', 'milk')).toEqual([1]);
    });

    it('draws the quantity before the answer, on a line of its own', async () => {
      const { store, drawn, holdWrites, releaseNext } = setup(HOME);
      await store.ensure();
      holdWrites();

      const adding = store.add(MILK);

      expect(drawn('weekly', 'milk')).toEqual([1]);
      // The record is what the server answered, so it waits for the answer.
      expect(store.count()).toBe(0);

      releaseNext();
      await adding;

      // The line that stood in is gone, and the saved one took its place.
      expect(store.held().map((held) => held.lineId)).toEqual(['line-1']);
      expect(drawn('weekly', 'milk')).toEqual([1]);
    });

    it('draws at once on the line that has the product under its own name', async () => {
      const { store, drawn, holdWrites, releaseNext } = setup({
        ...HOME,
        lines: [line('old', 'weekly', { quantity: 2 })],
      });
      await store.ensure();
      holdWrites();

      const adding = store.add(MILK);

      expect(store.held().map((held) => held.lineId)).toEqual(['old']);
      expect(drawn('weekly', 'milk')).toEqual([3]);

      releaseNext();
      await adding;

      expect(drawn('weekly', 'milk')).toEqual([3]);
    });

    it('records what a merged line held before', async () => {
      const { store } = setup({
        ...HOME,
        lines: [line('old', 'weekly', { quantity: 2 })],
      });
      await store.ensure();

      await store.add(MILK);

      expect(store.visit()).toEqual([
        expect.objectContaining({
          lineId: 'old',
          quantity: 3,
          before: 2,
          created: false,
        }),
      ]);
    });

    it('draws on a line of its own beside a stocked line of that name, and leaves that one at zero', async () => {
      // The server does not raise a line at zero. It makes a line beside it.
      const { store, server, drawn, holdWrites, releaseNext } = setup({
        ...HOME,
        lines: [line('stocked', 'weekly', { quantity: 0 })],
      });
      await store.ensure();
      holdWrites();

      const adding = store.add(MILK);

      expect(store.held().map((held) => [held.lineId, held.quantity])).toEqual([
        ['stocked', 0],
        ['unsaved:weekly/milk', 1],
      ]);

      releaseNext();
      await adding;

      expect(store.held().map((held) => [held.lineId, held.quantity])).toEqual([
        ['stocked', 0],
        ['line-1', 1],
      ]);
      expect(drawn('weekly', 'milk')).toEqual([0, 1]);
      expect(server.get('stocked')?.quantity).toBe(0);
      expect(server.get('line-1')?.quantity).toBe(1);
      expect(store.visit()).toEqual([
        expect.objectContaining({
          lineId: 'line-1',
          quantity: 1,
          before: 0,
          created: true,
        }),
      ]);
    });

    it('raises the line the first add made, and not the stocked one, on a second press', async () => {
      const { store, server, drawn } = setup({
        ...HOME,
        lines: [line('stocked', 'weekly', { quantity: 0 })],
      });
      await store.ensure();

      await store.add(MILK);
      await store.add(MILK);

      expect(drawn('weekly', 'milk')).toEqual([0, 2]);
      expect(server.get('stocked')?.quantity).toBe(0);
      expect(server.get('line-1')?.quantity).toBe(2);
      expect(store.count()).toBe(1);
    });

    it('takes the add off the line it was drawn on when the server answers another line', async () => {
      const { store, server, holdWrites, releaseNext } = setup({
        ...HOME,
        lines: [line('old', 'weekly', { quantity: 2 })],
      });
      await store.ensure();
      // Somebody else brought the line to zero after the catalog read it, so
      // the store still draws two and the server will make a line beside it.
      server.set('old', { ...(server.get('old') as Line), quantity: 0 });
      holdWrites();

      const adding = store.add(MILK);

      expect(store.held().map((held) => [held.lineId, held.quantity])).toEqual([
        ['old', 3],
      ]);

      releaseNext();
      await adding;

      expect(store.held().map((held) => [held.lineId, held.quantity])).toEqual([
        ['old', 2],
        ['line-1', 1],
      ]);
      expect(store.visit()).toEqual([
        expect.objectContaining({
          lineId: 'line-1',
          quantity: 1,
          before: 0,
          created: true,
        }),
      ]);
    });

    it('counts no add twice when two quick presses are answered on another line', async () => {
      const { store, server, holdWrites, releaseNext } = setup({
        ...HOME,
        lines: [line('old', 'weekly', { quantity: 2 })],
      });
      await store.ensure();
      server.set('old', { ...(server.get('old') as Line), quantity: 0 });
      holdWrites();

      const first = store.add(MILK);
      const second = store.add(MILK);

      expect(store.held().map((held) => [held.lineId, held.quantity])).toEqual([
        ['old', 4],
      ]);

      releaseNext();
      await settled();

      // The second press is still drawn on the old line. The new line says only
      // what the server answered, with nothing on its way drawn into it, so the
      // two together never say more than was pressed.
      expect(store.held().map((held) => [held.lineId, held.quantity])).toEqual([
        ['old', 3],
        ['line-1', 1],
      ]);

      releaseNext();
      await Promise.all([first, second]);

      expect(store.held().map((held) => [held.lineId, held.quantity])).toEqual([
        ['old', 2],
        ['line-1', 2],
      ]);
      expect(server.get('line-1')?.quantity).toBe(2);
      expect(store.visit()).toEqual([
        expect.objectContaining({ lineId: 'line-1', quantity: 2, before: 0 }),
      ]);
    });

    it('leaves a line that holds the product under another name alone', async () => {
      const { store, server } = setup({
        ...HOME,
        lines: [line('typed', 'weekly', { content: 'Leche para el café' })],
      });
      await store.ensure();

      await store.add(MILK);

      expect(store.held().map((held) => [held.lineId, held.quantity])).toEqual([
        ['typed', 1],
        ['line-1', 1],
      ]);
      expect(server.get('typed')?.quantity).toBe(1);
      expect(store.visit()[0]).toMatchObject({
        lineId: 'line-1',
        created: true,
      });
    });

    it('records a line that waits for approval', async () => {
      const { store, pendingNext } = setup(HOME);
      await store.ensure();
      pendingNext();

      await store.add(MILK);

      expect(store.visit()[0]?.pending).toBe(true);
      expect(store.held()[0]?.pending).toBe(true);
    });

    it('raises the same line on a second press, and counts it once', async () => {
      const { store, calls, drawn } = setup(HOME);
      await store.ensure();

      await store.add(MILK);
      await store.add(MILK);

      expect(calls.filter((call) => call.startsWith('add:'))).toHaveLength(2);
      expect(drawn('weekly', 'milk')).toEqual([2]);
      expect(store.visit()).toEqual([
        expect.objectContaining({
          lineId: 'line-1',
          quantity: 2,
          before: 0,
          created: true,
        }),
      ]);
      expect(store.count()).toBe(1);
    });

    it('keeps two quick presses as two writes in order, and never draws fewer than were pressed', async () => {
      const { store, calls, server, drawn, holdWrites, releaseNext } =
        setup(HOME);
      await store.ensure();
      holdWrites();

      const first = store.add(MILK);
      const second = store.add(MILK);

      expect(drawn('weekly', 'milk')).toEqual([2]);
      // The second waits for the first, so the server sees them in order.
      expect(calls.filter((call) => call.startsWith('add:'))).toHaveLength(1);

      releaseNext();
      await settled();

      // The first answered "one". One more is still on its way, so the row
      // still says two, and not two, then one, then two.
      expect(server.get('line-1')?.quantity).toBe(1);
      expect(drawn('weekly', 'milk')).toEqual([2]);
      expect(calls.filter((call) => call.startsWith('add:'))).toHaveLength(2);

      releaseNext();
      await Promise.all([first, second]);

      expect(server.get('line-1')?.quantity).toBe(2);
      expect(drawn('weekly', 'milk')).toEqual([2]);
      expect(store.visit()).toEqual([
        expect.objectContaining({ lineId: 'line-1', quantity: 2, before: 0 }),
      ]);
    });

    it('puts the quantity back and counts the failure when the add is refused', async () => {
      const { store, drawn, failNext } = setup(HOME);
      await store.ensure();
      failNext();

      await store.add(MILK);

      expect(drawn('weekly', 'milk')).toEqual([]);
      expect(store.held()).toEqual([]);
      expect(store.count()).toBe(0);
      expect(store.failures()).toBe(1);
    });

    it('puts a line that was there back to what it held when the add is refused', async () => {
      const { store, drawn, failNext } = setup({
        ...HOME,
        lines: [line('old', 'weekly', { quantity: 2 })],
      });
      await store.ensure();
      failNext();

      await store.add(MILK);

      expect(drawn('weekly', 'milk')).toEqual([2]);
      expect(store.count()).toBe(0);
      expect(store.failures()).toBe(1);
    });

    it('keeps the second of two quick presses when the first is refused', async () => {
      const { store, server, drawn, failNext } = setup(HOME);
      await store.ensure();
      failNext();

      await Promise.all([store.add(MILK), store.add(MILK)]);

      expect(server.get('line-1')?.quantity).toBe(1);
      expect(drawn('weekly', 'milk')).toEqual([1]);
      expect(store.failures()).toBe(1);
      expect(store.count()).toBe(1);
    });

    it('keeps the first of two quick presses when the second is refused', async () => {
      const { store, drawn, failNext, holdWrites, releaseNext } = setup(HOME);
      await store.ensure();
      holdWrites();
      const first = store.add(MILK);
      const second = store.add(MILK);
      releaseNext();
      await settled();
      failNext();

      releaseNext();
      await Promise.all([first, second]);

      // The line the second press was drawn on is gone by now. The saved line
      // that took its place is the one that goes back down.
      expect(store.held().map((held) => held.lineId)).toEqual(['line-1']);
      expect(drawn('weekly', 'milk')).toEqual([1]);
      expect(store.failures()).toBe(1);
    });

    it('adds nothing with no list to add to', async () => {
      const { store, calls } = setup({ ...HOME, guest: true });
      await store.ensure();

      await store.add(MILK);

      expect(calls).toEqual([]);
      expect(store.held()).toEqual([]);
      expect(store.count()).toBe(0);
    });

    it('adds to a list that is named, and leaves the chosen one', async () => {
      const { store, calls, drawn } = setup(HOME);
      await store.ensure();

      await store.add(MILK, 'mum');

      expect(calls).toContain('add:mum:Leche:1:milk');
      expect(store.target()?.listId).toBe('weekly');
      expect(drawn('mum', 'milk')).toEqual([1]);
      expect(drawn('weekly', 'milk')).toEqual([]);
    });

    it('counts a product once for each list it was added to', async () => {
      const { store } = setup(HOME);
      await store.ensure();

      await store.add(MILK);
      store.choose('barbecue');
      await settled();
      await store.add(MILK);

      expect(store.count()).toBe(2);
      expect(store.visit().map((entry) => entry.listId)).toEqual([
        'weekly',
        'barbecue',
      ]);
    });
  });

  describe('the stepper of a line', () => {
    const STOCKED: World = {
      ...HOME,
      lines: [line('old', 'weekly', { quantity: 2 })],
    };

    it('joins the record when it raises a line that was there before', async () => {
      const { store, calls, drawn } = setup(STOCKED);
      await store.ensure();

      await store.step(on('weekly', MILK), 'old', 1);

      expect(calls).toContain('quantity:old:1');
      expect(drawn('weekly', 'milk')).toEqual([3]);
      expect(store.visit()).toEqual([
        {
          listId: 'weekly',
          itemId: 'milk',
          lineId: 'old',
          name: 'Leche',
          detail: '1 L',
          quantity: 3,
          before: 2,
          created: false,
          pending: false,
        },
      ]);
    });

    it('leaves the record when the line is back at what it held before', async () => {
      const { store, server, drawn } = setup(STOCKED);
      await store.ensure();
      await store.step(on('weekly', MILK), 'old', 1);

      await store.step(on('weekly', MILK), 'old', -1);

      expect(server.get('old')?.quantity).toBe(2);
      expect(drawn('weekly', 'milk')).toEqual([2]);
      expect(store.visit()).toEqual([]);
    });

    it('does not record a line that only went down', async () => {
      const { store, drawn } = setup(STOCKED);
      await store.ensure();

      await store.step(on('weekly', MILK), 'old', -1);

      expect(drawn('weekly', 'milk')).toEqual([1]);
      expect(store.count()).toBe(0);
    });

    it('lowers a line that was there before to nothing, and leaves it on the list', async () => {
      // Zero is what a list calls stocked. Only a line the visit made is taken
      // off the list by the minus.
      const { store, calls, server } = setup({
        ...alone(['READ', 'WRITE', 'DECIDE', 'MANAGE']),
        lines: [line('old', 'weekly', { quantity: 1 })],
      });
      await store.ensure();

      await store.step(on('weekly', MILK), 'old', -1);

      expect(calls.some((call) => call.startsWith('delete:'))).toBe(false);
      expect(server.get('old')?.quantity).toBe(0);
      expect(store.held()[0]).toMatchObject({ lineId: 'old', quantity: 0 });
    });

    it('does not go under nothing', async () => {
      const { store, calls } = setup({
        ...HOME,
        lines: [line('old', 'weekly', { quantity: 0 })],
      });
      await store.ensure();

      await store.step(on('weekly', MILK), 'old', -1);

      expect(calls.some((call) => call.startsWith('quantity:'))).toBe(false);
    });

    it('lowers by one above the floor', async () => {
      const { store, calls } = setup(HOME);
      await store.ensure();
      await store.add(MILK);
      await store.add(MILK);

      await store.step(on('weekly', MILK), 'line-1', -1);

      expect(calls).toContain('quantity:line-1:-1');
      expect(store.visit()[0]?.quantity).toBe(1);
    });

    it('puts the quantity back when a step is refused', async () => {
      const { store, drawn, failNext } = setup(STOCKED);
      await store.ensure();
      failNext();

      await store.step(on('weekly', MILK), 'old', 1);

      expect(drawn('weekly', 'milk')).toEqual([2]);
      expect(store.count()).toBe(0);
      expect(store.failures()).toBe(1);
    });

    it('moves nothing on a line it does not hold', async () => {
      const { store, calls } = setup(STOCKED);
      await store.ensure();

      await store.step(on('weekly', MILK), 'nowhere', 1);

      expect(calls.some((call) => call.startsWith('quantity:'))).toBe(false);
    });
  });

  describe('the minus at one, on a line the visit made', () => {
    it.each<[string, readonly ListPermission[], boolean, boolean]>([
      [
        'somebody who manages the list',
        ['READ', 'WRITE', 'DECIDE', 'MANAGE'],
        false,
        false,
      ],
      [
        'a writer whose line still waits for approval',
        ['READ', 'WRITE'],
        false,
        true,
      ],
      [
        'a writer on a list that approves lines by itself',
        ['READ', 'WRITE'],
        true,
        false,
      ],
    ])(
      'deletes the line for %s',
      async (_who, permissions, autoApproveLines, pending) => {
        const { store, calls, server, pendingNext } = setup(
          alone(permissions, autoApproveLines)
        );
        await store.ensure();
        if (pending) {
          pendingNext();
        }
        await store.add(MILK);

        await store.step(on('weekly', MILK), 'line-1', -1);

        expect(calls).toContain('delete:line-1');
        expect(server.size).toBe(0);
        expect(store.held()).toEqual([]);
        expect(store.count()).toBe(0);
      }
    );

    it('lowers an approved line to nothing for somebody who decides and does not manage', async () => {
      // DECIDE moves a quantity. Deleting an approved line is MANAGE.
      const { store, calls, server } = setup(
        alone(['READ', 'WRITE', 'DECIDE'])
      );
      await store.ensure();
      await store.add(MILK);

      await store.step(on('weekly', MILK), 'line-1', -1);

      expect(calls.some((call) => call.startsWith('delete:'))).toBe(false);
      expect(calls).toContain('quantity:line-1:-1');
      expect(server.get('line-1')?.quantity).toBe(0);
      expect(store.held()[0]).toMatchObject({ lineId: 'line-1', quantity: 0 });
      expect(store.count()).toBe(0);
    });
  });

  describe('taking back', () => {
    it('deletes a line the visit made, whatever it holds by now', async () => {
      const { store, calls, server } = setup(
        alone(['READ', 'WRITE', 'DECIDE', 'MANAGE'])
      );
      await store.ensure();
      await store.add(MILK);
      await store.add(MILK);

      await store.takeBack('line-1');

      expect(calls).toContain('delete:line-1');
      expect(server.size).toBe(0);
      expect(store.held()).toEqual([]);
      expect(store.count()).toBe(0);
    });

    it('puts a merged line back to the quantity it had, and no lower', async () => {
      const { store, calls, server, drawn } = setup({
        ...alone(['READ', 'WRITE', 'DECIDE', 'MANAGE']),
        lines: [line('old', 'weekly', { quantity: 2 })],
      });
      await store.ensure();
      await store.add(MILK);
      await store.step(on('weekly', MILK), 'old', 1);
      expect(server.get('old')?.quantity).toBe(4);

      await store.takeBack('old');

      // A signed change, so what somebody else added in the meantime stays.
      expect(calls).toContain('quantity:old:-2');
      expect(calls.some((call) => call.startsWith('delete:'))).toBe(false);
      expect(server.get('old')?.quantity).toBe(2);
      expect(drawn('weekly', 'milk')).toEqual([2]);
      expect(store.visit()).toEqual([]);
    });

    it('lowers an approved line it made to nothing when it cannot delete it', async () => {
      // `HOME` gives READ, WRITE and DECIDE. Only MANAGE deletes an approved line.
      const { store, calls, server } = setup(HOME);
      await store.ensure();
      await store.add(MILK);

      await store.takeBack('line-1');

      expect(calls).toContain('quantity:line-1:-1');
      expect(server.get('line-1')?.quantity).toBe(0);
    });

    it('does nothing for a line the visit did not raise', async () => {
      const { store, calls } = setup({
        ...HOME,
        lines: [line('old', 'weekly', { quantity: 2 })],
      });
      await store.ensure();
      const before = calls.length;

      await store.takeBack('old');

      expect(calls).toHaveLength(before);
    });

    it('takes back everything on one list and leaves the other', async () => {
      const { store, server } = setup(HOME);
      await store.ensure();
      await store.add(MILK);
      await store.add(BREAD);
      await store.add(MILK, 'barbecue');

      await store.takeAllBack('weekly');

      expect(store.visit().map((entry) => entry.listId)).toEqual(['barbecue']);
      expect(server.get('line-1')?.quantity).toBe(0);
      expect(server.get('line-2')?.quantity).toBe(0);
      expect(server.get('line-3')?.quantity).toBe(1);
    });

    it('keeps the entry and the line, where they were, when the undo is refused', async () => {
      const { store, drawn, failNext } = setup(
        alone(['READ', 'WRITE', 'DECIDE', 'MANAGE'])
      );
      await store.ensure();
      await store.add(MILK);
      await store.add(BREAD);
      failNext();

      await store.takeBack('line-1');

      expect(store.visit().map((entry) => entry.itemId)).toEqual([
        'milk',
        'bread',
      ]);
      expect(drawn('weekly', 'milk')).toEqual([1]);
      expect(store.failures()).toBe(1);
    });
  });

  describe('the lists of one product', () => {
    const STOCKED: World = {
      ...HOME,
      lines: [
        line('w-bread', 'weekly', { content: 'Pan', itemIds: ['bread'] }),
        line('m-milk', 'mum', { quantity: 2 }),
        line('m-typed', 'mum', { content: 'Leche para el café' }),
        line('d-milk', 'dad', { quantity: 3 }),
        line('b-no', 'barbecue', { approvalStatus: 'REJECTED' }),
      ],
    };

    it('answers every list the person can read, a read only one included', async () => {
      const { store } = setup(STOCKED);

      const lists = await store.readItem('milk');

      expect(lists?.map((entry) => entry.listId)).toEqual([
        'weekly',
        'barbecue',
        'mum',
        'dad',
      ]);
      expect(lists?.[3]).toEqual({
        listId: 'dad',
        zoneId: 'parents',
        name: 'dad',
        zoneName: "Parents' house",
        autoApproveLines: false,
        permissions: ['READ'],
      });
    });

    it('holds the lines of every list that hold the product', async () => {
      const { store, drawn } = setup(STOCKED);

      await store.readItem('milk');

      expect(store.held().map((held) => held.lineId)).toEqual([
        'm-milk',
        'm-typed',
        'd-milk',
      ]);
      expect(drawn('mum', 'milk')).toEqual([2, 1]);
    });

    it('joins the lines the chosen list was read with, and holds each once', async () => {
      const { store } = setup({ ...STOCKED, lastList: 'parents/mum' });
      await store.ensure();

      await store.readItem('milk');

      expect(store.held().map((held) => held.lineId)).toEqual([
        'm-milk',
        'm-typed',
        'd-milk',
      ]);
    });

    it('drops a line that held the product and is gone, and keeps the other products', async () => {
      const { store, server } = setup({
        ...HOME,
        lines: [
          line('w-milk', 'weekly'),
          line('w-bread', 'weekly', { content: 'Pan', itemIds: ['bread'] }),
        ],
      });
      await store.ensure();
      // Somebody else deleted it while the catalog was open.
      server.delete('w-milk');

      await store.readItem('milk');

      expect(store.held().map((held) => held.lineId)).toEqual(['w-bread']);
    });

    it('keeps a line an add made while the read was on its way', async () => {
      const { store, drawn, holdReads, releaseRead } = setup(STOCKED);
      holdReads();
      const reading = store.readItem('milk');

      // The read was sent before the add, so its answer does not know the line.
      await store.add(MILK, 'weekly');
      releaseRead();
      await reading;

      expect(drawn('weekly', 'milk')).toEqual([1]);
      expect(store.held().map((held) => held.lineId)).toEqual([
        'line-1',
        'm-milk',
        'm-typed',
        'd-milk',
      ]);
      expect(store.count()).toBe(1);
    });

    it('does not put an older quantity back on a line an add raised meanwhile', async () => {
      const { store, server, drawn, holdReads, releaseRead } = setup(STOCKED);
      holdReads();
      const reading = store.readItem('milk');

      await store.add(MILK, 'mum');
      expect(server.get('m-milk')?.quantity).toBe(3);
      // The read answers the two the line held when it was sent.
      releaseRead();
      await reading;

      expect(drawn('mum', 'milk')).toEqual([3, 1]);
      expect(
        store.held().filter((held) => held.lineId === 'm-milk')
      ).toHaveLength(1);
    });

    it('knows what the person may do on a list from this read alone', async () => {
      // A product page opened from a link: the lists of the catalog were never
      // read, and the minus still has to know whether it may delete.
      const { store, calls } = setup(
        alone(['READ', 'WRITE', 'DECIDE', 'MANAGE'])
      );
      await store.readItem('milk');
      await store.add(MILK, 'weekly');

      await store.step(on('weekly', MILK), 'line-1', -1);

      expect(calls).toContain('delete:line-1');
      expect(calls).not.toContain('zones');
    });

    it('answers null when the read failed, and holds nothing new', async () => {
      const { store, failNextRead } = setup(STOCKED);
      failNextRead();

      await expect(store.readItem('milk')).resolves.toBeNull();
      expect(store.held()).toEqual([]);
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
      store.visited('/velista/es/catalog/products/x');

      expect(store.count()).toBe(1);
      expect(store.target()?.listId).toBe('weekly');
      expect(store.held()).toHaveLength(1);
      expect(store.linesStatus()).toBe('ready');
    });

    it('joins what a product page adds to what the catalog added', async () => {
      const { store } = setup(HOME);
      await store.ensure();
      await store.add(MILK);

      store.visited('/en/catalog/products/milk');
      await store.add(BREAD, 'mum');
      store.visited('/en/catalog');

      expect(store.visit().map((entry) => entry.itemId)).toEqual([
        'milk',
        'bread',
      ]);
    });

    it('is erased, with the lines it held, when a navigation ends outside the catalog', async () => {
      const { store, server } = setup({
        ...HOME,
        lines: [line('old', 'weekly', { quantity: 2 })],
      });
      await store.ensure();
      await store.add(BREAD);

      store.visited('/en/home');

      expect(store.count()).toBe(0);
      expect(store.visit()).toEqual([]);
      expect(store.held()).toEqual([]);
      expect(store.lists()).toEqual([]);
      expect(store.target()).toBeNull();
      expect(store.ready()).toBe(false);
      expect(store.linesStatus()).toBe('idle');
      // The lines stay on their lists. Only the record goes.
      expect(server.size).toBe(2);
    });

    it('reads the lists and their lines again on the next visit', async () => {
      const { store, calls } = setup({
        ...HOME,
        lines: [line('old', 'weekly', { quantity: 2 })],
      });
      await store.ensure();
      store.visited('/en/home');

      await store.ensure();

      expect(calls.filter((call) => call === 'zones')).toHaveLength(2);
      expect(calls.filter((call) => call === 'lines:weekly')).toHaveLength(2);
      expect(store.target()?.listId).toBe('weekly');
      expect(store.held().map((held) => held.lineId)).toEqual(['old']);
    });

    it('drops an answer that arrives after the visit ended', async () => {
      const { store, holdWrites, releaseNext } = setup(HOME);
      await store.ensure();
      holdWrites();

      const adding = store.add(MILK);
      store.visited('/en/home');
      releaseNext();
      await adding;

      expect(store.count()).toBe(0);
      expect(store.held()).toEqual([]);
      expect(store.failures()).toBe(0);
    });

    it('does not count a refusal that arrives after the visit ended', async () => {
      const { store, failNext, holdWrites, releaseNext } = setup(HOME);
      await store.ensure();
      holdWrites();

      const adding = store.add(MILK);
      store.visited('/en/home');
      failNext();
      releaseNext();
      await adding;

      expect(store.failures()).toBe(0);
    });

    it('does not count, in the next visit, an add pressed in the one before', async () => {
      const { store, server, holdWrites, releaseNext } = setup(HOME);
      await store.ensure();
      holdWrites();
      const adding = store.add(MILK);

      store.visited('/en/home');
      store.visited('/en/catalog');
      await store.ensure();
      releaseNext();
      await adding;

      // The write went out, because the person asked for it. The new visit did
      // not make it, so the new record does not hold it.
      expect(server.get('line-1')?.quantity).toBe(1);
      expect(store.ready()).toBe(true);
      expect(store.count()).toBe(0);
      expect(store.visit()).toEqual([]);
    });
  });
});
