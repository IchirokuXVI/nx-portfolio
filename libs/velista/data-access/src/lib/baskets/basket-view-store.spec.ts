import { computed, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import type {
  BasketListRef,
  BasketParticipant,
  BasketPriceScope,
  BasketProduct,
  BasketRow,
  BasketRowEntry,
} from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  StorageKeys,
  type BrowserFacade,
} from '@portfolio/velista/platform';
import { BasketStore } from './basket-store';
import {
  parseBasketViewMemory,
  type BasketViewMemory,
} from './basket-view-memory';
import { BasketViewStore } from './basket-view-store';

/**
 * What the basket page draws, as opposed to what the basket holds (velista
 * `0074`, section 4.3).
 *
 * The one idea worth a test of its own: **the search hides rows and does nothing
 * else.** It never reorders, it never reaches the server, and it never survives the
 * screen. Everything below is one of those four sentences.
 */

/** One row, with one entry on a list nobody was served unless a test says so. */
function row(
  rowKey: string,
  content: string,
  optionId: string | null = null,
  entries: readonly BasketRowEntry[] = [entry(null, `zl-${rowKey}`)]
): BasketRow {
  return {
    rowKey,
    content,
    left: 1,
    bought: 0,
    asked: 1,
    state: 'WANTED',
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    optionIds: optionId === null ? [] : [optionId],
    touchedBy: null,
    touchedAt: null,
    entries,
  };
}

function entry(listId: string | null, lineId: string): BasketRowEntry {
  return {
    lineId,
    listId,
    left: 1,
    bought: 0,
    asked: 1,
    state: 'WANTED',
    awaitingApproval: false,
    demandEditable: true,
  };
}

function product(
  id: string,
  en: string,
  es: string,
  brand: string | null = null
): BasketProduct {
  return {
    id,
    name: { en, es },
    brand,
    size: null,
    unit: null,
    offer: null,
    offers: [],
    categories: ['OTHER'],
  };
}

const ME: BasketParticipant = {
  id: 'p-me',
  kind: 'OWNER',
  displayName: null,
  username: 'Dani',
  guestNumber: null,
  userId: 'u-1',
  joinedAt: null,
  lastSeenAt: null,
  shareLinkId: null,
};

interface Harness {
  readonly view: BasketViewStore;
  readonly rows: WritableSignal<readonly BasketRow[]>;
  readonly locale: WritableSignal<string>;
  /** The covered lists this reader was served, which the sheet offers (`0090`). */
  readonly lists: WritableSignal<ReadonlyMap<string, BasketListRef>>;
  /** The scopes this basket is priced at, which a remembered shop is checked against. */
  readonly scopes: WritableSignal<ReadonlyMap<string, BasketPriceScope>>;
  /** This device's storage, so a spec can seed a record and read what was written. */
  readonly storage: Map<string, string>;
}

function harness(
  rows: readonly BasketRow[],
  products: ReadonlyMap<string, BasketProduct> = new Map(),
  storage: Map<string, string> = new Map(),
  /** What a storage that will not answer looks like from above the facade (`0076`). */
  browser: Partial<BrowserFacade> = {}
): Harness {
  TestBed.resetTestingModule();

  const held = signal(rows);
  const locale = signal('en');
  const lists = signal<ReadonlyMap<string, BasketListRef>>(new Map());
  const scopes = signal<ReadonlyMap<string, BasketPriceScope>>(new Map());

  TestBed.configureTestingModule({
    providers: [
      { provide: RokuLocaleStore, useValue: { locale } },
      provideFakeBrowserFacade(storage, browser),
      {
        provide: BasketStore,
        useValue: {
          rows: held,
          products: signal(products),
          me: signal<BasketParticipant | null>(ME),
          // The scopes travel on the basket rather than on its rows, so the double
          // answers the whole read the way the store reaches for it.
          basket: computed(() => ({ scopes: scopes() })),
          lists,
        },
      },
      BasketViewStore,
    ],
  });

  return {
    view: TestBed.inject(BasketViewStore),
    rows: held,
    locale,
    lists,
    scopes,
    storage,
  };
}

/** A basket of three served lists, for the filter section and its chips. */
function withLists(harnessed: Harness): Harness {
  harnessed.lists.set(
    new Map([
      ['l-groceries', ref('l-groceries', 'Groceries')],
      ['l-weekly', ref('l-weekly', 'Weekly shop')],
      ['l-parents', ref('l-parents', 'Parents')],
    ])
  );
  return harnessed;
}

function ref(listId: string, name: string): BasketListRef {
  return { listId, name, zoneId: 'z1', zoneName: 'Home' };
}

/** A row asked for by the named lists, one entry each. */
function onLists(
  rowKey: string,
  content: string,
  listIds: readonly string[]
): BasketRow {
  return row(
    rowKey,
    content,
    null,
    listIds.map((listId) => entry(listId, `zl-${rowKey}-${listId}`))
  );
}

const contents = (rows: readonly BasketRow[]) => rows.map((row) => row.content);

describe('BasketViewStore', () => {
  const basket: readonly BasketRow[] = [
    row('l-1', 'Milk', 'item-milk'),
    row('l-2', 'Sourdough loaf'),
    row('l-3', 'Plátano'),
  ];

  const products = new Map([
    [
      'item-milk',
      product('item-milk', 'Whole milk', 'Leche entera', 'Hacendado'),
    ],
  ]);

  /**
   * `0074` asserted the **same array** here, so that an untouched basket cost
   * nothing. `0075` gave this store sections, and every line in one is wrapped in a
   * row, so there is no array of lines left to hand back by identity: the flat list
   * is read back out of the rows. The lines themselves are still the store's own
   * objects, which is what anything tracking a row by id depends on, and a dozen
   * wrappers per redraw is not a cost worth a second code path.
   */
  it('draws the whole basket until somebody searches', () => {
    const { view, rows } = harness(basket);

    expect(view.visibleRows()).toEqual(rows());
    expect(view.searching()).toBe(false);
  });

  it('narrows to what matches, in the order the basket already held', () => {
    const { view } = harness(basket);
    view.search('o');

    // Both matches, and the loaf is still before the plátano: the search hides
    // rows and never reorders, which is what `0075` goes on to decide.
    expect(contents(view.visibleRows())).toEqual(['Sourdough loaf', 'Plátano']);
  });

  it("matches a line through its pick's name and brand", () => {
    const { view } = harness(basket, products);

    view.search('hacendado');
    expect(contents(view.visibleRows())).toEqual(['Milk']);

    view.search('whole');
    expect(contents(view.visibleRows())).toEqual(['Milk']);
  });

  it('re-reads the names when the reader changes language', () => {
    const { view, locale } = harness(basket, products);
    view.search('leche');

    expect(view.visibleRows()).toHaveLength(0);

    locale.set('es');
    expect(contents(view.visibleRows())).toEqual(['Milk']);
  });

  it('folds the query once, for the row to draw its mark from', () => {
    const { view } = harness(basket);
    view.search('  PLÁTANO ');

    expect(view.folded()).toBe('platano');
  });

  /**
   * The search is never remembered and never survives the screen (`0076`), which
   * is the one thing `leave` is for.
   *
   * It used to clear itself when this reader's own line landed, because the thing
   * somebody searched for and did not find is very often the next thing they add.
   * The composer is velista `0092`'s, with a list to add to, and that rule comes
   * back with it.
   */
  it('keeps what was typed while the basket moves underneath it', () => {
    const { view, rows } = harness(basket);
    view.search('milk');

    rows.set([...basket, row('l-4', 'Yogurt')]);

    expect(view.query()).toBe('milk');
    expect(contents(view.visibleRows())).toEqual(['Milk']);
  });

  it('is given back on leaving, so a later basket does not start searched', () => {
    const { view } = harness(basket);
    view.search('milk');

    view.leave();

    expect(view.query()).toBe('');
    expect(view.searching()).toBe(false);
  });
});

/**
 * The whole state of the screen (velista `0075`, section 2).
 *
 * The idea worth a test of its own here: **every setter applies at once.** There is
 * no draft and no apply step, so the count on the sheet's own button is the truth
 * rather than a prediction, and a sheet that leaves for the shop picker and comes
 * back finds what it set still set.
 */
describe('BasketViewStore, the view state', () => {
  const basket: readonly BasketRow[] = [
    onLists('l-1', 'Milk', ['l-groceries']),
    onLists('l-2', 'Bread', ['l-groceries', 'l-weekly']),
    onLists('l-3', 'Cheese', ['l-weekly']),
    // A row this reader cannot place. Its list is covered and not served, which
    // `toBasket` maps to a null `listId`: there is one question here and one
    // answer, so the fixture holds the shape the mapper produces.
    row('l-4', 'Batteries'),
  ];

  const DEFAULTS = {
    order: 'shop',
    grouping: 'none',
    shop: null,
    lists: null,
  };

  it('opens on the defaults: the shop order, ungrouped, every list, no shop', () => {
    const { view } = withLists(harness(basket));

    expect(view.state()).toEqual(DEFAULTS);
    expect(view.activeCount()).toBe(0);
    expect(view.chips()).toEqual([]);
    expect(view.sections()).toHaveLength(1);
  });

  it('applies every setter at once, with no apply step', () => {
    const { view } = withLists(harness(basket));

    view.setOrder('alpha');
    expect(contents(view.visibleRows())).toEqual([
      'Batteries',
      'Bread',
      'Cheese',
      'Milk',
    ]);

    view.setGrouping('category');
    expect(view.grouping()).toBe('category');

    view.setShop('scope-1');
    expect(view.shop()).toBe('scope-1');

    expect(view.activeCount()).toBe(3);
  });

  it('puts every property back on reset, and leaves the search alone', () => {
    const { view } = withLists(harness(basket));
    view.setOrder('alpha');
    view.setGrouping('list');
    view.toggleList('l-weekly');
    view.search('milk');

    view.reset();

    expect(view.state()).toEqual(DEFAULTS);
    // Reset is a control in the filter sheet; the search is a field on the page
    // behind it, and it has a Cancel of its own two taps away.
    expect(view.query()).toBe('milk');
  });

  it('resets one property, which is what a chip’s x does', () => {
    const { view } = withLists(harness(basket));
    view.setOrder('alpha');
    view.toggleList('l-weekly');

    view.resetProperty('order');

    expect(view.order()).toBe('shop');
    expect(view.lists()).not.toBeNull();
  });

  describe('the source lists', () => {
    /**
     * **Every served list**, and not the lists its rows happen to name: a list this
     * basket covers is still one of the households it is about when every row of it
     * has been bought, and a checkbox that appeared and disappeared as rows were
     * settled would be unusable.
     *
     * The group's name goes in beside the list's, because a list alone is
     * ambiguous when two households both keep one called "Groceries".
     */
    it('offers every served list, counting the rows that reach it', () => {
      const { view } = withLists(harness(basket));

      expect(view.sourceLists()).toEqual([
        { id: 'l-groceries', name: 'Groceries · Home', lines: 2 },
        { id: 'l-weekly', name: 'Weekly shop · Home', lines: 2 },
        { id: 'l-parents', name: 'Parents · Home', lines: 0 },
      ]);
    });

    /**
     * A list the basket served no ref for is one this reader may not name, and a
     * checkbox with no words is a control nobody can act on.
     */
    it('offers only the lists the basket served', () => {
      const harnessed = withLists(harness(basket));
      harnessed.lists.set(
        new Map([['l-groceries', ref('l-groceries', 'Groceries')]])
      );

      expect(harnessed.view.sourceLists().map((source) => source.id)).toEqual([
        'l-groceries',
      ]);
    });

    it('draws one checkbox per list, however many rows reach it', () => {
      const harnessed = withLists(harness(basket));
      harnessed.lists.set(
        new Map([['l-groceries', ref('l-groceries', 'Groceries')]])
      );

      expect(harnessed.view.sourceLists()).toHaveLength(1);
    });

    /** Empty for a guest, which is what keeps the section out of their sheet. */
    it('offers nothing when the run named no sources', () => {
      const { view } = harness(basket);

      expect(view.sourceLists()).toEqual([]);
      expect(view.keptLists().size).toBe(0);
    });
  });

  describe('the list filter', () => {
    it('keeps everything until something is unchecked', () => {
      const { view } = withLists(harness(basket));

      expect(view.lists()).toBeNull();
      expect([...view.keptLists()].sort()).toEqual([
        'l-groceries',
        'l-parents',
        'l-weekly',
      ]);
    });

    /**
     * **A reader cannot filter out what they cannot name** (velista `0090`,
     * section 8.2). A row with an unserved entry might well be on the very list
     * they kept, and there is no way to ask, so it stays.
     *
     * There is no sink any more. Backend `0136` removed the thing it held: a line
     * is on a list or it does not exist.
     */
    it('narrows to the kept lists and keeps what it cannot place', () => {
      const { view } = withLists(harness(basket));

      view.toggleList('l-weekly');
      view.toggleList('l-parents');

      const sections = view.sections();
      expect(sections).toHaveLength(1);
      expect(contents(sections[0].rows.map((drawn) => drawn.row))).toEqual([
        'Milk',
        'Bread',
        'Batteries',
      ]);
      expect(view.visibleCount()).toBe(3);
    });

    /** A filter that keeps nothing is not a filter, and the control will not go there. */
    it('refuses to uncheck the last kept list', () => {
      const { view } = withLists(harness(basket));
      view.toggleList('l-weekly');
      view.toggleList('l-parents');
      const before = view.lists();

      view.toggleList('l-groceries');

      expect(view.lists()).toBe(before);
      expect([...view.keptLists()]).toEqual(['l-groceries']);
    });

    /**
     * Re-checking everything is the default, not a filter that happens to keep all
     * of it: a set holding every list would leave a chip saying a filter is on.
     */
    it('collapses back to the default when everything is kept again', () => {
      const { view } = withLists(harness(basket));
      view.toggleList('l-weekly');
      expect(view.lists()).not.toBeNull();

      view.toggleList('l-weekly');

      expect(view.lists()).toBeNull();
      expect(view.activeCount()).toBe(0);
      expect(view.chips()).toEqual([]);
    });

    it('chips one kept list by name and several by count', () => {
      const { view } = withLists(harness(basket));

      view.toggleList('l-weekly');
      view.toggleList('l-parents');
      expect(view.chips()).toEqual([
        {
          property: 'lists',
          key: 'basket.view.lists.only',
          args: { name: 'Groceries' },
        },
      ]);

      view.toggleList('l-weekly');
      expect(view.chips()).toEqual([
        {
          property: 'lists',
          key: 'basket.view.lists.some',
          args: { kept: 2, total: 3 },
        },
      ]);
    });
  });

  /**
   * Nothing here listens. `sections` is a `computed` over `BasketStore.lines`, so
   * every realtime write the store makes flows through it (section 7).
   */
  it('redraws its sections when a line arrives', () => {
    const harnessed = withLists(harness(basket));
    harnessed.view.setOrder('alpha');

    harnessed.rows.set([...basket, onLists('l-5', 'Apples', ['l-groceries'])]);

    expect(contents(harnessed.view.visibleRows())[0]).toBe('Apples');
  });

  it('gives the whole view state back on leaving, not only the search', () => {
    const { view } = withLists(harness(basket));
    view.setOrder('alpha');
    view.setGrouping('list');
    view.toggleList('l-weekly');

    view.leave();

    expect(view.state()).toEqual(DEFAULTS);
  });
});

/**
 * What the sheet remembers between visits (velista `0076`).
 *
 * Three sentences carry all of it. **Only what moves lines is kept**, so the order,
 * the grouping and the shop come back and the search and the list filter never do.
 * **A date is compared once**, when the basket loads, so a value that expires while
 * somebody is standing in an aisle does not move the rows in front of them. And **a
 * value this basket cannot honour is dropped but not deleted**, because the next
 * basket is very possibly one that can.
 */
describe('BasketViewStore, what the sheet remembers', () => {
  const basket: readonly BasketRow[] = [
    onLists('l-1', 'Milk', ['l-groceries']),
    onLists('l-2', 'Bread', ['l-weekly']),
  ];

  const HOUR = 60 * 60 * 1000;
  /** A fixed moment, so no test here starts passing or failing with the calendar. */
  const NOW = Date.UTC(2026, 0, 15, 10, 0, 0);
  const KEY = StorageKeys.basketView;

  const DEFAULTS = {
    order: 'shop',
    grouping: 'none',
    shop: null,
    lists: null,
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => jest.useRealTimers());

  const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

  const seed = (memory: BasketViewMemory) =>
    new Map([[KEY, JSON.stringify(memory)]]);

  const written = (storage: Map<string, string>) =>
    parseBasketViewMemory(storage.get(KEY) ?? null);

  /** A basket priced at one shop, which is what a remembered shop is checked against. */
  function priced(harnessed: Harness): Harness {
    harnessed.scopes.set(
      new Map([
        [
          'scope-mercadona',
          {
            priceScopeId: 'scope-mercadona',
            supermarketName: { en: 'Mercadona', es: 'Mercadona' },
            locations: [],
          },
        ],
      ])
    );
    return harnessed;
  }

  it('applies a remembered order, grouping and shop when the basket loads', () => {
    const harnessed = priced(
      withLists(
        harness(
          basket,
          new Map(),
          seed({
            version: 1,
            order: { value: 'alpha', until: null },
            grouping: { value: 'category', until: null },
            shop: { value: 'scope-mercadona', until: at(HOUR) },
          })
        )
      )
    );

    harnessed.view.restore();

    expect(harnessed.view.state()).toEqual({
      order: 'alpha',
      grouping: 'category',
      shop: 'scope-mercadona',
      lists: null,
    });
  });

  it('starts on the defaults when this device remembers nothing', () => {
    const harnessed = priced(withLists(harness(basket)));

    harnessed.view.restore();

    expect(harnessed.view.state()).toEqual(DEFAULTS);
    expect(harnessed.storage.size).toBe(0);
  });

  it('ignores a property whose date has passed, and takes it out of the record', () => {
    const harnessed = priced(
      withLists(
        harness(
          basket,
          new Map(),
          seed({
            version: 1,
            order: { value: 'alpha', until: null },
            shop: { value: 'scope-mercadona', until: at(-1) },
          })
        )
      )
    );

    harnessed.view.restore();

    expect(harnessed.view.order()).toBe('alpha');
    expect(harnessed.view.shop()).toBeNull();
    expect(written(harnessed.storage)).toEqual({
      version: 1,
      order: { value: 'alpha', until: null },
    });
  });

  /**
   * The expiry is a date, not a timer. A shop remembered at 10:00 and read at 11:50
   * is applied, and noon arriving while the basket is open changes nothing: the next
   * basket to open is what ignores it.
   */
  it('keeps a property whose date is still ahead, and does not drop it later', () => {
    const harnessed = priced(
      withLists(
        harness(
          basket,
          new Map(),
          seed({
            version: 1,
            shop: { value: 'scope-mercadona', until: at(HOUR) },
          })
        )
      )
    );

    harnessed.view.restore();
    expect(harnessed.view.shop()).toBe('scope-mercadona');

    jest.setSystemTime(NOW + 3 * HOUR);

    expect(harnessed.view.shop()).toBe('scope-mercadona');
    expect(written(harnessed.storage)?.shop?.until).toBe(at(HOUR));
  });

  it('dates the shop two hours out, and setting the grouping leaves that date alone', () => {
    const harnessed = priced(withLists(harness(basket)));

    harnessed.view.setShop('scope-mercadona');
    expect(written(harnessed.storage)?.shop).toEqual({
      value: 'scope-mercadona',
      until: at(2 * HOUR),
    });

    jest.setSystemTime(NOW + HOUR);
    harnessed.view.setGrouping('category');

    const record = written(harnessed.storage);
    expect(record?.shop).toEqual({
      value: 'scope-mercadona',
      until: at(2 * HOUR),
    });
    expect(record?.grouping).toEqual({ value: 'category', until: null });
  });

  it('ignores a remembered shop this basket has no price from, and keeps it stored', () => {
    const stored: BasketViewMemory = {
      version: 1,
      shop: { value: 'scope-lidl', until: at(HOUR) },
    };
    const harnessed = priced(
      withLists(harness(basket, new Map(), seed(stored)))
    );

    harnessed.view.restore();

    expect(harnessed.view.shop()).toBeNull();
    expect(written(harnessed.storage)).toEqual(stored);
  });

  it('ignores a remembered list grouping for a reader with no lists, and keeps it stored', () => {
    const stored: BasketViewMemory = {
      version: 1,
      grouping: { value: 'list', until: null },
    };
    // No `withLists`: this reader's sheet offers no "List" radio at all, and a
    // basket grouped by a choice the sheet cannot show is one nobody can undo.
    const harnessed = priced(harness(basket, new Map(), seed(stored)));

    harnessed.view.restore();

    expect(harnessed.view.grouping()).toBe('none');
    expect(written(harnessed.storage)).toEqual(stored);
  });

  it('never writes the list filter or the search', () => {
    const harnessed = withLists(harness(basket));

    harnessed.view.search('milk');
    harnessed.view.toggleList('l-weekly');
    harnessed.view.setOrder('alpha');

    expect(written(harnessed.storage)).toEqual({
      version: 1,
      order: { value: 'alpha', until: null },
    });
  });

  it('leaves the search and the list filter alone when it restores', () => {
    const harnessed = priced(
      withLists(
        harness(
          basket,
          new Map(),
          seed({ version: 1, order: { value: 'alpha', until: null } })
        )
      )
    );

    harnessed.view.search('milk');
    harnessed.view.toggleList('l-weekly');

    harnessed.view.restore();

    expect(harnessed.view.order()).toBe('alpha');
    expect(harnessed.view.query()).toBe('milk');
    expect(harnessed.view.lists()).toEqual(
      new Set(['l-groceries', 'l-parents'])
    );
  });

  it.each([
    [
      'a version this build does not write',
      { version: 2, order: { value: 'alpha', until: null } },
    ],
    [
      'a value outside its own union',
      { version: 1, order: { value: 'newest', until: null } },
    ],
    ['a record that is not JSON at all', 'basket-view'],
  ])('applies nothing at all for %s', (_case, raw) => {
    const harnessed = priced(
      withLists(
        harness(
          basket,
          new Map(),
          new Map([[KEY, typeof raw === 'string' ? raw : JSON.stringify(raw)]])
        )
      )
    );

    harnessed.view.restore();

    expect(harnessed.view.state()).toEqual(DEFAULTS);
  });

  /**
   * The facade answers null for a storage that throws, which is private mode and
   * site data blocked. Nothing here is load bearing enough to fail a tap over, so
   * the device merely forgets.
   */
  it('forgets, and goes on working, when storage will not answer', () => {
    const harnessed = withLists(
      harness(basket, new Map(), new Map(), {
        readStorage: () => null,
        writeStorage: () => undefined,
      })
    );

    harnessed.view.restore();
    harnessed.view.setOrder('alpha');
    harnessed.view.setGrouping('category');

    expect(harnessed.view.order()).toBe('alpha');
    expect(harnessed.view.grouping()).toBe('category');
    expect(harnessed.storage.size).toBe(0);
  });

  it('writes a record holding nothing when the sheet is reset', () => {
    const harnessed = priced(withLists(harness(basket)));
    harnessed.view.setOrder('alpha');
    harnessed.view.setShop('scope-mercadona');

    harnessed.view.reset();

    expect(written(harnessed.storage)).toEqual({ version: 1 });
  });

  /**
   * Taking a remembered grouping off the page is a choice, and the record says so.
   * A chip's x that merely forgot would hand the grouping straight back on the next
   * basket, which is the same control failing to do what it says.
   */
  it('remembers a property put back to its default by hand', () => {
    const harnessed = priced(
      withLists(
        harness(
          basket,
          new Map(),
          seed({ version: 1, grouping: { value: 'category', until: null } })
        )
      )
    );
    harnessed.view.restore();

    harnessed.view.resetProperty('grouping');

    expect(written(harnessed.storage)).toEqual({
      version: 1,
      grouping: { value: 'none', until: null },
    });
  });

  /**
   * The shop is the exception, because its default is the **absence** of a value and
   * `Remembered` has no room for one. Forgetting it and remembering its default are
   * the same thing to the next basket, which starts with no shop either way.
   */
  it('forgets the shop when the cheapest anywhere is chosen again', () => {
    const harnessed = priced(withLists(harness(basket)));
    harnessed.view.setShop('scope-mercadona');

    harnessed.view.resetProperty('shop');

    expect(written(harnessed.storage)).toEqual({ version: 1 });
  });

  it('writes nothing for the list filter, which has nothing to put back', () => {
    const harnessed = withLists(harness(basket));
    harnessed.view.toggleList('l-weekly');

    harnessed.view.resetProperty('lists');

    expect(harnessed.storage.size).toBe(0);
    expect(harnessed.view.lists()).toBeNull();
  });
});

/**
 * The chosen shop, named (velista `0078`, sections 3 and 5).
 *
 * Resolved here rather than in the sheet, because the chip row on the page behind it
 * says the same word: two places resolving a `LocalizedName` is two places to forget
 * the reader's language changed.
 */
describe('BasketViewStore: the chosen shop', () => {
  const basket: readonly BasketRow[] = [
    onLists('l-1', 'Milk', ['l-groceries']),
    onLists('l-2', 'Bread', ['l-weekly']),
  ];

  /** Mercadona with two shops, and Dia with none: an owner's basket and a guest's. */
  function shops(harnessed: Harness): Harness {
    harnessed.scopes.set(
      new Map([
        [
          'scope-mercadona',
          {
            priceScopeId: 'scope-mercadona',
            supermarketName: { en: 'Mercadona', es: 'Mercadona' },
            locations: [
              {
                id: 'loc-tejares',
                label: null,
                address: 'Ronda de los Tejares 32',
                city: 'Córdoba',
                postalCode: '14008',
              },
              {
                id: 'loc-barcelona',
                label: null,
                address: 'Avenida de Barcelona 4',
                city: 'Córdoba',
                postalCode: '14001',
              },
            ],
          },
        ],
        [
          'scope-dia',
          {
            priceScopeId: 'scope-dia',
            supermarketName: { en: 'Dia', es: 'Dia' },
            locations: [],
          },
        ],
      ])
    );
    return harnessed;
  }

  it('offers every scope the basket was priced at', () => {
    const harnessed = shops(harness(basket));

    expect(
      harnessed.view.priceScopes().map((held) => held.priceScopeId)
    ).toEqual(['scope-mercadona', 'scope-dia']);
  });

  it('names the chain and the scope’s first shop', () => {
    const harnessed = shops(harness(basket));

    harnessed.view.setShop('scope-mercadona');

    // The first of two, which is `0062` section 5.1's rule for a place with
    // several locations: any of them is where the price comes from, and a list of
    // addresses answers a question the sheet cannot answer anyway.
    expect(harnessed.view.chosenShop()).toEqual({
      priceScopeId: 'scope-mercadona',
      chain: 'Mercadona',
      shop: 'Ronda de los Tejares 32',
    });
  });

  it('names no shop for a scope the reader was sent none of', () => {
    const harnessed = shops(harness(basket));

    harnessed.view.setShop('scope-dia');

    expect(harnessed.view.chosenShop()?.shop).toBeNull();
  });

  it('names nothing for a shop this basket was not priced at', () => {
    const harnessed = shops(harness(basket));

    harnessed.view.setShop('scope-gone');

    expect(harnessed.view.chosenShop()).toBeNull();
  });

  /**
   * The chip is the **chain** and never the shop: the chip row is one line on a 390
   * wide phone, and "Mercadona" is what distinguishes this view from the default
   * while a street name distinguishes one Mercadona from another.
   */
  it('chips the chain’s name alone', () => {
    const harnessed = shops(harness(basket));

    harnessed.view.setShop('scope-mercadona');

    expect(harnessed.view.chips()).toEqual([
      {
        property: 'shop',
        key: 'basket.view.chip.shop',
        args: { name: 'Mercadona' },
      },
    ]);
  });

  /**
   * Section 5.1, and what staging and production are actually in: a shop nobody has
   * priced marks nothing, so the rows quote the cheapest exactly as they did.
   */
  it('quotes no shop until one of them prices something on the basket', () => {
    const harnessed = shops(harness(basket));

    harnessed.view.setShop('scope-mercadona');

    // Nothing in this basket's products carries an offer at all.
    expect(harnessed.view.pricedShop()).toBeNull();
  });
});
