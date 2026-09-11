import { computed, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import type {
  BasketLine,
  BasketParticipant,
  BasketPriceScope,
  BasketProduct,
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

function line(
  id: string,
  content: string,
  pickId: string | null = null,
  createdBy = 'p-guest'
): BasketLine {
  return {
    id,
    content,
    quantity: 1,
    settled: 0,
    pickId,
    optionIds: [],
    position: 0,
    createdBy,
    touchedBy: null,
    touchedAt: null,
    lastOutcome: null,
  };
}

function product(
  id: string,
  en: string,
  es: string,
  brand: string | null = null
): BasketProduct {
  return { id, name: { en, es }, brand, size: null, unit: null, offer: null };
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
  readonly lines: WritableSignal<readonly BasketLine[]>;
  readonly lastAdded: WritableSignal<BasketLine | null>;
  readonly locale: WritableSignal<string>;
  /** What the run drew from, which is what the filter sheet offers (`0075`). */
  readonly sources: WritableSignal<
    readonly { zoneId: string; listId: string }[]
  >;
  readonly listNames: WritableSignal<ReadonlyMap<string, string>>;
  /** The scopes this basket is priced at, which a remembered shop is checked against. */
  readonly scopes: WritableSignal<ReadonlyMap<string, BasketPriceScope>>;
  /** This device's storage, so a spec can seed a record and read what was written. */
  readonly storage: Map<string, string>;
}

function harness(
  lines: readonly BasketLine[],
  products: ReadonlyMap<string, BasketProduct> = new Map(),
  storage: Map<string, string> = new Map(),
  /** What a storage that will not answer looks like from above the facade (`0076`). */
  browser: Partial<BrowserFacade> = {}
): Harness {
  TestBed.resetTestingModule();

  const held = signal(lines);
  const lastAdded = signal<BasketLine | null>(null);
  const locale = signal('en');
  const sources = signal<readonly { zoneId: string; listId: string }[]>([]);
  const listNames = signal<ReadonlyMap<string, string>>(new Map());
  const scopes = signal<ReadonlyMap<string, BasketPriceScope>>(new Map());

  TestBed.configureTestingModule({
    providers: [
      { provide: RokuLocaleStore, useValue: { locale } },
      provideFakeBrowserFacade(storage, browser),
      {
        provide: BasketStore,
        useValue: {
          lines: held,
          products: signal(products),
          lastAdded,
          me: signal<BasketParticipant | null>(ME),
          // The run's own sources travel on the basket rather than on its lines, so
          // the double answers the whole read the way the store reaches for it.
          basket: computed(() => ({ sources: sources(), scopes: scopes() })),
          listNames,
        },
      },
      BasketViewStore,
    ],
  });

  return {
    view: TestBed.inject(BasketViewStore),
    lines: held,
    lastAdded,
    locale,
    sources,
    listNames,
    scopes,
    storage,
  };
}

/** A basket of three lists, for the filter section and its chips. */
function withLists(harnessed: Harness): Harness {
  harnessed.sources.set([
    { zoneId: 'z1', listId: 'l-groceries' },
    { zoneId: 'z1', listId: 'l-weekly' },
    { zoneId: 'z2', listId: 'l-parents' },
  ]);
  harnessed.listNames.set(
    new Map([
      ['l-groceries', 'Groceries'],
      ['l-weekly', 'Weekly shop'],
      ['l-parents', 'Parents'],
    ])
  );
  return harnessed;
}

function onLists(
  id: string,
  content: string,
  listIds: readonly string[]
): BasketLine {
  return {
    ...line(id, content),
    origins: listIds.map((listId) => ({
      id: `o-${id}-${listId}`,
      zoneId: 'z1',
      listId,
      lineId: `zl-${id}`,
      quantity: 1,
    })),
  };
}

const contents = (lines: readonly BasketLine[]) =>
  lines.map((row) => row.content);

describe('BasketViewStore', () => {
  const basket: readonly BasketLine[] = [
    line('l-1', 'Milk', 'item-milk'),
    line('l-2', 'Sourdough loaf'),
    line('l-3', 'Plátano'),
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
    const { view, lines } = harness(basket);

    expect(view.visibleLines()).toEqual(lines());
    expect(view.searching()).toBe(false);
  });

  it('narrows to what matches, in the order the basket already held', () => {
    const { view } = harness(basket);
    view.search('o');

    // Both matches, and the loaf is still before the plátano: the search hides
    // rows and never reorders, which is what `0075` goes on to decide.
    expect(contents(view.visibleLines())).toEqual([
      'Sourdough loaf',
      'Plátano',
    ]);
  });

  it("matches a line through its pick's name and brand", () => {
    const { view } = harness(basket, products);

    view.search('hacendado');
    expect(contents(view.visibleLines())).toEqual(['Milk']);

    view.search('whole');
    expect(contents(view.visibleLines())).toEqual(['Milk']);
  });

  it('re-reads the names when the reader changes language', () => {
    const { view, locale } = harness(basket, products);
    view.search('leche');

    expect(view.visibleLines()).toHaveLength(0);

    locale.set('es');
    expect(contents(view.visibleLines())).toEqual(['Milk']);
  });

  it('folds the query once, for the row to draw its mark from', () => {
    const { view } = harness(basket);
    view.search('  PLÁTANO ');

    expect(view.folded()).toBe('platano');
  });

  it("clears itself when the reader's own line lands", () => {
    const { view, lastAdded } = harness(basket);
    view.search('yogurt');

    lastAdded.set(line('l-4', 'Yogurt', null, ME.id));
    // Effects are scheduled, not synchronous, so the arrival has to be flushed
    // before the query can have answered it.
    TestBed.tick();

    // The thing somebody searched for and did not find is very often the next line
    // they add, and a row that arrived hidden by the failed search is a row
    // somebody types a second time.
    expect(view.query()).toBe('');
  });

  it("does not clear itself when somebody else's line lands", () => {
    const { view, lastAdded } = harness(basket);
    view.search('yogurt');

    // Four people are working this basket. Clearing the field because somebody
    // across the shop typed something takes the screen out from under the person
    // holding this phone.
    lastAdded.set(line('l-5', 'Crisps', null, 'p-somebody-else'));
    TestBed.tick();

    expect(view.query()).toBe('yogurt');
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
  const basket: readonly BasketLine[] = [
    onLists('l-1', 'Milk', ['l-groceries']),
    onLists('l-2', 'Bread', ['l-groceries', 'l-weekly']),
    onLists('l-3', 'Cheese', ['l-weekly']),
    onLists('l-4', 'Batteries', []),
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
    expect(contents(view.visibleLines())).toEqual([
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
    it('offers every named source, counting the lines that reach it', () => {
      const { view } = withLists(harness(basket));

      expect(view.sourceLists()).toEqual([
        { id: 'l-groceries', name: 'Groceries', lines: 2 },
        { id: 'l-weekly', name: 'Weekly shop', lines: 2 },
        { id: 'l-parents', name: 'Parents', lines: 0 },
      ]);
    });

    /** A checkbox with no words is a control nobody can act on. */
    it('drops a source the basket never named', () => {
      const harnessed = withLists(harness(basket));
      harnessed.listNames.set(new Map([['l-groceries', 'Groceries']]));

      expect(harnessed.view.sourceLists().map((source) => source.id)).toEqual([
        'l-groceries',
      ]);
    });

    it('draws one checkbox for a list two zones reach', () => {
      const harnessed = withLists(harness(basket));
      harnessed.sources.set([
        { zoneId: 'z1', listId: 'l-groceries' },
        { zoneId: 'z2', listId: 'l-groceries' },
      ]);

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

    it('narrows to the kept lists and sinks the line on no list', () => {
      const { view } = withLists(harness(basket));

      view.toggleList('l-weekly');
      view.toggleList('l-parents');

      const sections = view.sections();
      expect(sections).toHaveLength(2);
      expect(contents(sections[0].rows.map((row) => row.line))).toEqual([
        'Milk',
        'Bread',
      ]);
      expect(sections[1].heading).toBe('basket.group.noList');
      expect(contents(sections[1].rows.map((row) => row.line))).toEqual([
        'Batteries',
      ]);
      // The sunk line is one of the lines on the screen, so the count includes it.
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

    harnessed.lines.set([...basket, onLists('l-5', 'Apples', ['l-groceries'])]);

    expect(contents(harnessed.view.visibleLines())[0]).toBe('Apples');
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
  const basket: readonly BasketLine[] = [
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
