import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  draftFor,
  fieldOf,
  idOf,
  isEditable,
  toInput,
  type FieldDescriptor,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import {
  CATEGORY_KIND_OPTIONS,
  POSTAL_CODE_SOURCE_OPTIONS,
  PRICE_SCOPE_KIND_OPTIONS,
  PRICE_SOURCE_KIND_OPTIONS,
  UNIT_OF_MEASURE_OPTIONS,
} from './catalog-enums';
import {
  ITEM_SEED,
  LOCATION_ITEM_SEED,
  LOCATION_SEED,
  PRICE_POLICY_SEED,
  PRICE_SCOPE_SEED,
  PRICE_SEED,
} from './catalog-seed';
import { CATEGORIES } from './categories';
import { ChainContext } from './chains/chain-context';
import { CHAIN_PARAM } from './chains/chain-page';
import { CHAIN_RESOURCES } from './chains/chains-routes';
import { SHOP_PARAM } from './chains/shop-page';
import { ITEMS, withCategoryIds } from './items';
import { LOCATION_ITEMS } from './location-items';
import { LOCATIONS } from './locations';
import { PRICE_POLICIES } from './price-policies';
import { PRICE_SCOPES, priorityBand } from './price-scopes';
import { PRICES } from './prices';
import { PRODUCT_GROUPS } from './product-groups';
import { SECTIONS } from './sections';
import { SUPERMARKETS } from './supermarkets';
import { SUPERMARKET_SEED } from './supermarkets-seed';

/**
 * What the seven catalog descriptors claim, checked without rendering anything
 * (plan 0005, section 6).
 *
 * A descriptor is a statement about the gateway, and most of the ways to get one
 * wrong are silent: a column naming a field that does not exist draws an empty
 * cell, a filter naming a parameter no route declares answers 400 only when
 * somebody uses it, and an enum that has fallen behind its type shows a raw
 * value. So the checks here are about agreement rather than about behaviour,
 * and the screens themselves are `catalog-screens.spec.ts`.
 */

/** The two reading orders an operator can choose (admin plan 0026). */
const ENGLISH_FIRST: readonly string[] = ['en', 'es'];
const SPANISH_FIRST: readonly string[] = ['es', 'en'];

const ALL = [
  SUPERMARKETS,
  LOCATIONS,
  SECTIONS,
  PRICE_SCOPES,
  ITEMS,
  CATEGORIES,
  PRODUCT_GROUPS,
  PRICES,
  PRICE_POLICIES,
  LOCATION_ITEMS,
];

describe('every catalog descriptor', () => {
  it('names a field for each of its columns, in both layouts', () => {
    for (const descriptor of ALL) {
      const named = new Set(descriptor.fields.map((field) => field.name));

      for (const column of descriptor.list.columns) {
        expect([descriptor.name, column, named.has(column)]).toEqual([
          descriptor.name,
          column,
          true,
        ]);
      }
    }
  });

  /**
   * The one piece of per entity judgement the generic list cannot make. A card
   * shows a subset of the table's columns, and an entry that is not one of them
   * would draw a cell the row view never built.
   */
  it('draws a card from a subset of its own columns', () => {
    for (const descriptor of ALL) {
      const columns = new Set(descriptor.list.columns);

      for (const compact of descriptor.list.compact) {
        expect([descriptor.name, compact, columns.has(compact)]).toEqual([
          descriptor.name,
          compact,
          true,
        ]);
      }
    }
  });
});

/**
 * A chain holds its shops (admin plan 0042).
 *
 * Five descriptors moved under `/chains`, and what the address decides is
 * stated on each of them as `parent`. Every way to get one wrong is silent: a
 * route parameter nobody declares reads as no parent, so the list would ask
 * the gateway for every chain's rows, and a filter name that is not a field
 * would create a row that belongs to nothing.
 */
describe('the resources a chain holds', () => {
  const HELD = [
    SUPERMARKETS,
    LOCATIONS,
    SECTIONS,
    PRICE_SCOPES,
    LOCATION_ITEMS,
  ];

  it('is the five the Chains section registers, the chain first', () => {
    expect(CHAIN_RESOURCES).toEqual(HELD);
  });

  it('calls each one what its address calls it', () => {
    expect(HELD.map((descriptor) => descriptor.segment)).toEqual([
      'chains',
      'shops',
      'sections',
      'scopes',
      'products',
    ]);
  });

  it('puts a shop, a section and a scope under a chain, and a product under a shop', () => {
    const chain = {
      resource: 'supermarkets',
      param: CHAIN_PARAM,
      filter: 'supermarketId',
    };

    expect(SUPERMARKETS.parent).toBeUndefined();
    expect(LOCATIONS.parent).toEqual(chain);
    expect(SECTIONS.parent).toEqual(chain);
    expect(PRICE_SCOPES.parent).toEqual(chain);
    expect(LOCATION_ITEMS.parent).toEqual({
      resource: 'locations',
      param: SHOP_PARAM,
      filter: 'supermarketLocationId',
    });
  });

  /**
   * The parent's id fills a field on a new row, so the filter has to name one
   * that a create may set. It also points at a resource the section holds.
   */
  it('names a parent that is held, and a field a new row can carry', () => {
    const names = new Set(HELD.map((descriptor) => descriptor.name));

    for (const descriptor of HELD) {
      const parent = descriptor.parent;
      if (parent === undefined) {
        continue;
      }
      const field = fieldOf(descriptor, parent.filter);

      expect([descriptor.name, names.has(parent.resource)]).toEqual([
        descriptor.name,
        true,
      ]);
      expect([
        descriptor.name,
        field !== undefined && isEditable(field, 'create'),
      ]).toEqual([descriptor.name, true]);
    }
  });

  /** Section 4 of the plan: the address decides the chain, and no filter does. */
  it('offers no filter for what the address decides', () => {
    for (const descriptor of HELD) {
      const params = (descriptor.filters ?? []).map((filter) => filter.param);
      expect([
        descriptor.name,
        params.includes(descriptor.parent?.filter ?? ''),
      ]).toEqual([descriptor.name, false]);
    }
  });

  it('says "Add a shop" where "New" says too little', () => {
    expect(SUPERMARKETS.labels.create).toBe('catalog.supermarkets.add');
    expect(LOCATIONS.labels.create).toBe('catalog.locations.add');
    expect(PRICE_SCOPES.labels.create).toBe('catalog.priceScopes.add');
    expect(LOCATION_ITEMS.labels.create).toBe('catalog.locationItems.add');
  });

  /** In the column a chain is its name and the shops it holds. */
  it('ends a chain’s row with its shop count', () => {
    expect(SUPERMARKETS.list.brief).toEqual({ trailing: 'locationCount' });
  });

  /** The chain is the page the list is a tab of, so it is not a column. */
  it('leaves the chain out of the price scope columns', () => {
    expect(PRICE_SCOPES.list.columns).not.toContain('supermarketId');
  });

  /**
   * Admin plan 0042, section 2: the read joins the product's name and brand
   * on, so the Products tab never prints an id it could have named.
   */
  it('titles a shop product by the product, id only when the join found nothing', () => {
    const [milk] = LOCATION_ITEM_SEED as unknown as ResourceRow[];
    const itemId = fieldOf(LOCATION_ITEMS, 'itemId');

    expect(LOCATION_ITEMS.title(milk, ENGLISH_FIRST)).toBe('Whole milk 1 L');
    expect(LOCATION_ITEMS.title(milk, SPANISH_FIRST)).toBe('Leche entera 1 L');
    expect(
      LOCATION_ITEMS.title({ ...milk, itemName: null }, ENGLISH_FIRST)
    ).toBe('it_milk_1l');
    expect(itemId?.kind === 'reference' ? itemId.nameFrom : null).toBe(
      'itemName'
    );
    expect(LOCATION_ITEMS.list.columns).toEqual([
      'itemId',
      'itemBrand',
      'positionInStore',
      'available',
    ]);
  });

  /**
   * "Default" and "Make default" are facts about the chain, so both read the
   * chain's page and exist only on a list under one.
   */
  describe('the default scope of a chain', () => {
    const [national, cordoba] = PRICE_SCOPE_SEED as unknown as ResourceRow[];

    function under(chain: Partial<ChainContext> | null) {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers:
          chain === null ? [] : [{ provide: ChainContext, useValue: chain }],
      });
      return TestBed.runInInjectionContext(() => ({
        statesOf: PRICE_SCOPES.rowStates?.(),
        actions: PRICE_SCOPES.actions?.named?.() ?? [],
      }));
    }

    const mercadona = (setDefaultScope = jest.fn()) =>
      ({
        chain: signal(SUPERMARKET_SEED[0]),
        setDefaultScope,
      }) as unknown as Partial<ChainContext>;

    it('marks the scope its chain falls back to, and no other', () => {
      const { statesOf } = under(mercadona());

      expect(statesOf?.(national)).toEqual([
        { label: 'catalog.priceScopes.state.default', tone: 'good' },
      ]);
      expect(statesOf?.(cordoba)).toEqual([]);
    });

    it('offers to make another general scope the default, and writes the chain', async () => {
      const write = jest.fn().mockResolvedValue(undefined);
      const { actions } = under(mercadona(write));
      const [makeDefault] = actions;
      const store = PRICE_SCOPE_SEED.find(
        (scope) => scope.kind === 'STORE'
      ) as unknown as ResourceRow;

      expect(actions.map((action) => action.name)).toEqual(['makeDefault']);
      expect(makeDefault.available?.(national)).toBe(false);
      expect(makeDefault.available?.(cordoba)).toBe(true);
      // One shop's own scope is the most specific there is, so it is never
      // what a chain falls back to.
      expect(makeDefault.available?.(store)).toBe(false);

      await makeDefault.run(cordoba);

      expect(write).toHaveBeenCalledWith('ps_mercadona_4661');
    });

    it('says and offers nothing on a list that is under no chain', () => {
      const { statesOf, actions } = under(null);

      expect(statesOf?.(national)).toEqual([]);
      expect(actions).toEqual([]);
    });
  });
});

/**
 * A reference column names what it points at (admin plan 0023, section 1).
 *
 * Two honest routes to the name, and each field says which is its: joined on
 * by the backend where the target is large, resolved once per distinct id and
 * cached where it is small. A field declaring neither keeps its id, which is
 * the guard against the request storm plan 0004 refused.
 */
describe('reference columns that name their target', () => {
  it('reads the product name off the wire on the price list', () => {
    const itemId = fieldOf(PRICES, 'itemId');

    expect(itemId?.kind).toBe('reference');
    expect(itemId?.kind === 'reference' ? itemId.nameFrom : null).toBe(
      'itemName'
    );
  });

  it('looks the group and the chain up, both small targets', () => {
    const group = fieldOf(ITEMS, 'productGroupId');
    expect(group?.kind === 'reference' ? group.nameLookup : null).toBe(true);

    const chain = fieldOf(PRICE_SCOPES, 'supermarketId');
    expect(chain?.kind === 'reference' ? chain.nameLookup : null).toBe(true);
  });

  /** The two members are mutually exclusive, on every descriptor there is. */
  it('never declares both sources on one field', () => {
    for (const descriptor of ALL) {
      for (const field of descriptor.fields) {
        if (field.kind !== 'reference') {
          continue;
        }
        const both = field.nameFrom !== undefined && field.nameLookup === true;
        expect([descriptor.name, field.name, both]).toEqual([
          descriptor.name,
          field.name,
          false,
        ]);
      }
    }
  });

  /** Section 3.3: the compact card's heading gets the same name the column gets. */
  it('titles a price by its product, id only when the join found nothing', () => {
    expect(
      PRICES.title(PRICE_SEED[0] as unknown as ResourceRow, ENGLISH_FIRST)
    ).toBe('Whole milk 1 L');
    expect(
      PRICES.title(
        {
          ...(PRICE_SEED[0] as unknown as ResourceRow),
          itemName: null,
        },
        ENGLISH_FIRST
      )
    ).toBe('it_milk_1l');
  });

  /**
   * The title takes the operator's reading order (admin plan 0026, section 5).
   *
   * A descriptor that collapses a localized name is one of six, and the
   * argument is what stops all six being read English first whatever the
   * operator chose. It is an order and not a filter: a product named in one
   * language only keeps the name it has under either choice.
   */
  it('titles a price in the language the operator reads', () => {
    const row = {
      ...(PRICE_SEED[0] as unknown as ResourceRow),
      itemName: { en: 'Whole milk 1 L', es: 'Leche entera 1 L' },
    };

    expect(PRICES.title(row, ENGLISH_FIRST)).toBe('Whole milk 1 L');
    expect(PRICES.title(row, SPANISH_FIRST)).toBe('Leche entera 1 L');
    expect(
      PRICES.title(
        { ...row, itemName: { es: 'Leche entera 1 L' } },
        ENGLISH_FIRST
      )
    ).toBe('Leche entera 1 L');
  });
});

describe('the catalog enumerations', () => {
  /**
   * The values are the wire's. A list that has fallen behind its type shows a
   * raw `PERSONAL_CARE` in a cell rather than failing, which is exactly the
   * kind of drift nothing reports.
   */
  it('offers a distinct, keyed option for every value', () => {
    const lists = [
      CATEGORY_KIND_OPTIONS,
      UNIT_OF_MEASURE_OPTIONS,
      PRICE_SCOPE_KIND_OPTIONS,
      PRICE_SOURCE_KIND_OPTIONS,
      POSTAL_CODE_SOURCE_OPTIONS,
    ];

    for (const list of lists) {
      const values = list.map((option) => option.value);
      expect(new Set(values).size).toBe(values.length);
      expect(list.every((option) => option.label.startsWith('catalog.'))).toBe(
        true
      );
    }
  });

  it('covers every price source kind, including the pinned one', () => {
    expect(PRICE_SOURCE_KIND_OPTIONS.map((option) => option.value)).toEqual([
      'OFFICIAL_API',
      'OFFICIAL_WEB',
      'OFFICIAL_LEAFLET',
      'ADMIN',
      'USER_RECEIPT',
      'USER_REPORTED',
    ]);
  });
});

describe('the shops', () => {
  /**
   * Section 3. Three states and not two: a code with a source is known, a
   * `DERIVED` one was guessed from the nearest centroid, and a null code with a
   * null source is neither. The third is deliberate, because a wrong postcode is
   * worse than none, so it must not be drawn as a guess to go and check.
   */
  it('tells a known postal code from a guessed one and from none at all', () => {
    const sources = LOCATION_SEED.map((row) => row.postalCodeSource);

    expect(sources).toContain('SOURCE');
    expect(sources).toContain('DERIVED');
    expect(sources).toContain(null);

    const unknown = LOCATION_SEED.find((row) => row.postalCodeSource === null);
    expect(unknown?.postalCode).toBeNull();
  });

  it('offers the guess as a filter and shows the source as a column', () => {
    const filter = (LOCATIONS.filters ?? []).find(
      (entry) => entry.param === 'postalCodeSource'
    );

    expect(filter?.kind).toBe('enum');
    expect(LOCATIONS.list.columns).toContain('postalCodeSource');
    expect(LOCATIONS.list.compact).toContain('postalCodeSource');
  });

  /**
   * The trap: an operator correcting an address may reasonably expect the
   * pricing to follow, and it does not. The field says so where it is edited.
   */
  it('warns on the postal code that the price scope does not move with it', () => {
    expect(fieldOf(LOCATIONS, 'postalCode')?.help).toBe(
      'catalog.locations.postalCodeHelp'
    );
  });

  /**
   * The list could not be read until a chain was picked in a filter, and said
   * so in a state of its own. The chain is the address now (admin plan 0042),
   * so nothing is required and no filter offers the chain.
   */
  it('takes its chain from the address, and waits for no filter', () => {
    expect(LOCATIONS.parent).toEqual({
      resource: 'supermarkets',
      param: 'chainId',
      filter: 'supermarketId',
    });
    expect((LOCATIONS.filters ?? []).map((filter) => filter.param)).toEqual([
      'query',
      'postalCodeSource',
      'priceScopeId',
    ]);
  });

  /**
   * The column beside the open shop: the address, then the town and the code,
   * and at most two states. A label set by hand wins over the address, as it
   * does in the title.
   */
  it('says a row in a few words when the list is a column', () => {
    const [centro, , , consum] = LOCATION_SEED;

    expect(LOCATIONS.list.brief?.line).toEqual(['city', 'postalCode']);
    expect(LOCATIONS.list.brief?.heading?.(centro, ENGLISH_FIRST)).toBe(
      'Avenida del Gran Capitán 12'
    );
    expect(LOCATIONS.list.brief?.heading?.(consum, ENGLISH_FIRST)).toBe(
      'Consum Centro'
    );
  });

  /**
   * The label, the address and the town can each be null. A shop that had
   * none of them was a row with no text in it, so the tab said two shops and
   * the list showed one (admin plan 0049, target 3).
   */
  it('never draws a shop as a row with nothing in it', () => {
    const [centro] = LOCATION_SEED;
    const bare = { ...centro, label: null, address: null, city: null };
    const say = (row: typeof centro) => [
      LOCATIONS.title(row, ENGLISH_FIRST),
      LOCATIONS.list.brief?.heading?.(row, ENGLISH_FIRST),
    ];

    expect(say({ ...bare, postalCode: '14001' })).toEqual(['14001', '14001']);
    expect(
      say({ ...bare, postalCode: null, externalRef: 'node/1156230891' })
    ).toEqual(['node/1156230891', 'node/1156230891']);
    expect(
      say({ ...bare, address: '', postalCode: null, externalRef: null })
    ).toEqual([centro.id, centro.id]);
  });

  it('marks a shop with a map and a postal code that was guessed', () => {
    const statesOf = LOCATIONS.rowStates?.();
    const [centro, oeste, sierra] = LOCATION_SEED as unknown as ResourceRow[];

    expect(statesOf?.(centro)).toEqual([
      { label: 'catalog.locations.state.map', tone: 'neutral' },
    ]);
    expect(statesOf?.(oeste)).toEqual([
      { label: 'catalog.locations.state.postalCodeGuessed', tone: 'waiting' },
    ]);
    // Neither known nor guessed is deliberate, and is not a state to act on.
    expect(statesOf?.(sierra)).toEqual([]);
  });

  /**
   * The filter a reference picker over shops needs (admin plan 0011, section
   * 4). Without one `ResourceReferences.search` has nowhere to put the term, so
   * it drops it and asks for the first page: the picker then answers every
   * search with the same twenty shops, and a chain with three hundred cannot be
   * used at all.
   */
  it('offers the search its reference picker needs', () => {
    const search = (LOCATIONS.filters ?? []).find(
      (filter) => filter.kind === 'search'
    );

    expect(search?.param).toBe('query');
  });
});

/**
 * A shop's whole stack of price scopes (admin plan 0028, section 4).
 */
describe('the shop price scopes', () => {
  const field = fieldOf(LOCATIONS, 'priceScopeIds');
  const scopes = field?.kind === 'references' ? field : undefined;

  it('is a references field over the price scopes, named by lookup', () => {
    expect(field?.kind).toBe('references');
    expect(scopes?.resource).toBe('price-scopes');
    expect(scopes?.nameLookup).toBe(true);
    expect(fieldOf(LOCATIONS, 'priceScopeId')).toBeUndefined();
  });

  it('limits the picker to the chain, with no single shop scope', () => {
    expect(scopes?.scopeFrom?.({ supermarketId: 'sm_mercadona' })).toEqual({
      supermarketId: 'sm_mercadona',
      kind: ['LOCAL_AREA', 'REGION', 'NATIONAL'],
    });
  });

  it('offers nothing to add before the chain is known', () => {
    expect(scopes?.scopeFrom?.({})).toBeNull();
    expect(scopes?.scopeFrom?.({ supermarketId: '' })).toBeNull();
  });

  it('locks the shop’s own store scope and no other', () => {
    const shop = { id: 'loc_1', supermarketId: 'sm_mercadona' };

    expect(
      scopes?.locked?.(shop, { kind: 'STORE', externalKey: 'loc_1' })
    ).toBe(true);
    // Another shop's store scope, a region, and a create with no id yet.
    expect(
      scopes?.locked?.(shop, { kind: 'STORE', externalKey: 'loc_2' })
    ).toBe(false);
    expect(
      scopes?.locked?.(shop, { kind: 'REGION', externalKey: 'loc_1' })
    ).toBe(false);
    expect(scopes?.locked?.({}, { kind: 'STORE', externalKey: 'loc_1' })).toBe(
      false
    );
  });

  it('lists the stack by name, and filters on one scope', () => {
    expect(LOCATIONS.list.columns).toContain('priceScopeIds');
    expect(
      (LOCATIONS.filters ?? []).find((entry) => entry.param === 'priceScopeId')
        ?.kind
    ).toBe('reference');
  });

  it('seeds every shop with its own store scope at the head of its stack', () => {
    for (const shop of LOCATION_SEED) {
      const own = PRICE_SCOPE_SEED.filter(
        (scope) => scope.kind === 'STORE' && scope.externalKey === shop.id
      );
      expect([shop.id, own.length]).toEqual([shop.id, 1]);
      expect(shop.priceScopeIds).toContain(own[0].id);
      expect(shop.priceScopeId).toBe(own[0].id);
    }
  });
});

/** One set of four names for the tiers (admin plan 0028, section 2). */
describe('the price scope tier names', () => {
  it('names the four default priorities with the kinds’ own keys', () => {
    expect(priorityBand(100)).toEqual({
      kind: 'key',
      key: 'catalog.priceScopeKind.STORE',
    });
    expect(priorityBand(200)).toEqual({
      kind: 'key',
      key: 'catalog.priceScopeKind.LOCAL_AREA',
    });
    expect(priorityBand(300)).toEqual({
      kind: 'key',
      key: 'catalog.priceScopeKind.REGION',
    });
    expect(priorityBand(1000)).toEqual({
      kind: 'key',
      key: 'catalog.priceScopeKind.NATIONAL',
    });
  });

  it('says any other priority is custom, with its number', () => {
    expect(priorityBand(250)).toEqual({
      kind: 'key',
      key: 'catalog.priceScopes.priorityCustom',
      args: { priority: 250 },
    });
  });

  it('offers LOCAL_AREA as a kind and no POSTAL_CODE', () => {
    const values = PRICE_SCOPE_KIND_OPTIONS.map((option) => option.value);

    expect(values).toContain('LOCAL_AREA');
    expect(values).not.toContain('POSTAL_CODE');
    for (const option of PRICE_SCOPE_KIND_OPTIONS) {
      expect(option.label).toBe(`catalog.priceScopeKind.${option.value}`);
    }
  });

  it('translates the priority column through its read', () => {
    const priority = fieldOf(PRICE_SCOPES, 'priority');

    expect(priority?.read?.({ ...PRICE_SCOPE_SEED[0], priority: 200 })).toEqual(
      priorityBand(200)
    );
  });
});

describe('the price form', () => {
  /**
   * Since backend plan 0080 the form **adds a row** and never edits one: an
   * effective price is derived, and correcting a typo is removing the row and
   * adding another. So the descriptor offers a create and nothing else. It has
   * no detail screen: a price is read on the Prices tab of its product (admin
   * plan 0043, target 7).
   */
  it('adds a price and never edits or deletes the effective row', () => {
    expect(PRICES.actions?.create).toBe(true);
    expect(PRICES.actions?.edit).toBeUndefined();
    expect(PRICES.actions?.delete).toBeUndefined();
    expect(PRICES.detail).toBeUndefined();
    expect(PRICES.editor).toBeDefined();
  });

  /** A price sits under its product: `/products/{productId}/prices`. */
  it('is addressed under the product it prices', () => {
    expect(PRICES.parent).toEqual({
      resource: 'items',
      param: 'productId',
      filter: 'itemId',
    });
    expect(PRICES.segment).toBe('prices');
  });

  /**
   * `AddItemPriceDto` declares the values a row carries and nothing else, and
   * the validation pipe refuses a property no DTO declares. So a field the row
   * does not take must not be editable, or every add would answer 400.
   */
  it('types only what a price row carries, never the derived columns', () => {
    const editable = PRICES.fields
      .filter((field) => isEditable(field, 'create'))
      .map((field) => field.name)
      .sort();

    expect(editable).toEqual(
      [
        'itemId',
        'priceScopeId',
        'price',
        'currency',
        'unitPrice',
        'unitPriceLabel',
        'validFrom',
        'validUntil',
        // A past date, 30 days back at most (admin plan 0033; backend plan
        // 0160).
        'observedAt',
      ].sort()
    );
  });

  /**
   * Section 2, and the reason this screen is not a plain descriptor. A price is
   * keyed on `(itemId, priceScopeId)`; twelve shops served by one warehouse
   * share one row. Nothing on this form may point at a shop, or an operator
   * correcting what they saw in one would silently change eleven others.
   */
  it('points its scope field at scopes and nothing at a shop', () => {
    const scope = fieldOf(PRICES, 'priceScopeId');

    expect(scope?.kind).toBe('reference');
    expect(scope?.kind === 'reference' ? scope.resource : null).toBe(
      'price-scopes'
    );

    const shopPointing = PRICES.fields.filter(
      (field) => field.kind === 'reference' && field.resource === 'locations'
    );
    expect(shopPointing).toEqual([]);
  });

  /**
   * The rule from `0004` section 5, restated because this is the screen it
   * exists for. `unit_price / unit_size` disagrees with the source on 110 of
   * 4,232 products, in the field whose only purpose is comparison.
   */
  it('never fills in the unit price from anything else', () => {
    const draft = draftFor(PRICES, null, 'create');

    expect(draft['unitPrice']).toBe('');

    const typed = {
      ...draft,
      itemId: 'it_milk_1l',
      priceScopeId: 'ps_mercadona_4661',
      price: '2.00',
    };
    const input = toInput(PRICES, typed, 'create', draft);

    // The price is there and the unit price is not derived from it. An empty
    // nullable field submits null, which is the operator saying "no answer",
    // and never a number this form worked out.
    expect(input['price']).toBe(2);
    expect(input['unitPrice']).toBeNull();
  });

  /** Free text, because `100 ml` and `lv` are both real labels. */
  it('takes the unit price label as text rather than as a unit', () => {
    expect(fieldOf(PRICES, 'unitPriceLabel')?.kind).toBe('text');
  });

  /**
   * The key columns are what the row *is*: an added row is about a product in
   * a scope, and neither is something the derived row could be moved between.
   */
  it('fixes the product and the scope once the price exists', () => {
    for (const name of ['itemId', 'priceScopeId']) {
      const field = fieldOf(PRICES, name) as FieldDescriptor<ResourceRow>;

      expect([name, isEditable(field, 'create')]).toEqual([name, true]);
      expect([name, isEditable(field, 'edit')]).toEqual([name, false]);
    }
  });

  it('addresses a price by the pair it is keyed on', () => {
    expect(idOf(PRICES, PRICE_SEED[0] as unknown as ResourceRow)).toBe(
      'it_milk_1l~ps_mercadona_4661'
    );
  });
});

describe('the price list', () => {
  /** "What have I overridden": the effective rows an operator's price won. */
  it('shows where the shown price came from', () => {
    expect(PRICES.list.columns).toContain('sourceKind');
    expect(PRICES.list.compact).toContain('sourceKind');
  });

  it('shows when the price was last seen', () => {
    expect(PRICES.list.columns).toContain('observedAt');
    expect(fieldOf(PRICES, 'observedAt')?.kind).toBe('date');
  });

  /**
   * Backend plan 0080, section 5: the flag is the server's judgement and the
   * screen draws it as a column. It is never worked out here from the date,
   * because only the policy knows which kinds age out.
   */
  it('shows the stale flag as the server sent it', () => {
    expect(PRICES.list.columns).toContain('stale');
    expect(PRICES.list.compact).toContain('stale');
    expect(fieldOf(PRICES, 'stale')?.kind).toBe('boolean');
    expect(
      isEditable(
        fieldOf(PRICES, 'stale') as FieldDescriptor<ResourceRow>,
        'create'
      )
    ).toBe(false);
  });
});

describe('the price policies', () => {
  it('is edit only: six rows the migration seeded, and nothing creates a seventh', () => {
    expect(PRICE_POLICIES.actions?.edit).toBe(true);
    expect(PRICE_POLICIES.actions?.create).toBeUndefined();
    expect(PRICE_POLICIES.actions?.delete).toBeUndefined();
  });

  it('is keyed on the kind, which the PATCH takes in its path', () => {
    expect(PRICE_POLICIES.idField).toBe('sourceKind');
    expect(
      idOf(PRICE_POLICIES, PRICE_POLICY_SEED[3] as unknown as ResourceRow)
    ).toBe('ADMIN');
    expect(
      isEditable(
        fieldOf(PRICE_POLICIES, 'sourceKind') as FieldDescriptor<ResourceRow>,
        'edit'
      )
    ).toBe(false);
  });

  it('seeds section 3 of the plan, with no max age on the typed kind', () => {
    expect(PRICE_POLICY_SEED.map((row) => row.sourceKind)).toEqual(
      PRICE_SOURCE_KIND_OPTIONS.map((option) => option.value).sort(
        (a, b) =>
          PRICE_POLICY_SEED.findIndex((row) => row.sourceKind === a) -
          PRICE_POLICY_SEED.findIndex((row) => row.sourceKind === b)
      )
    );
    expect(
      PRICE_POLICY_SEED.find((row) => row.sourceKind === 'ADMIN')?.maxAgeDays
    ).toBeNull();
    expect(
      PRICE_POLICY_SEED.find((row) => row.sourceKind === 'USER_REPORTED')
        ?.enabled
    ).toBe(false);
  });
});

describe('availability', () => {
  /**
   * Two columns making two different claims, and never two checkboxes saying
   * the same word. On a price it is scope wide. On a per shop row it is a
   * nullable override, where null means "use the scope's answer" and is the
   * ordinary state.
   */
  it('is scope wide on a price and a nullable override in a shop', () => {
    expect(fieldOf(PRICES, 'available')?.nullable).toBeUndefined();
    expect(fieldOf(LOCATION_ITEMS, 'available')?.nullable).toBe(true);

    expect(fieldOf(PRICES, 'available')?.label).not.toBe(
      fieldOf(LOCATION_ITEMS, 'available')?.label
    );
  });

  /**
   * A price row carries no claim about stock (backend plan 0080, section 2),
   * so the add a price form must not send the flag: the DTO refuses it.
   */
  it('is not something the add a price form sends', () => {
    expect(
      isEditable(
        fieldOf(PRICES, 'available') as FieldDescriptor<ResourceRow>,
        'create'
      )
    ).toBe(false);
  });

  /**
   * Nor is it something the per shop form sends any more (backend plan 0084,
   * section 4). The column gained provenance and left
   * `supermarketLocationItem.upsert`, so a checkbox here would send a field the
   * route drops and report a change nobody made.
   */
  it('is not something the per shop form sends either', () => {
    expect(
      isEditable(
        fieldOf(LOCATION_ITEMS, 'available') as FieldDescriptor<ResourceRow>,
        'create'
      )
    ).toBe(false);

    // Not merely left null: absent. A row an operator merely opened must not
    // come back saying anything at all about stock.
    const draft = draftFor(LOCATION_ITEMS, null, 'create');
    expect(draft).not.toHaveProperty('available');
    expect(toInput(LOCATION_ITEMS, draft, 'create', {})).not.toHaveProperty(
      'available'
    );
  });

  it('carries the three answers a shop row really holds', () => {
    expect(LOCATION_ITEM_SEED.map((row) => row.available)).toEqual([
      true,
      false,
      null,
    ]);
  });
});

describe('localized names', () => {
  /**
   * The column is one `jsonb` object. Submitting only the language that was
   * typed in would erase the other one, so the whole draft goes, and the draft
   * holds every language the form opened with.
   */
  it('submits every locale that has text, including the ones nobody touched', () => {
    const draft = draftFor(ITEMS, null, 'create');
    const typed = {
      ...draft,
      name: { en: 'Whole milk', es: 'Leche entera' },
      categoryIds: ['cat_milk'],
      defaultUnit: 'LITER',
    };

    const input = toInput(ITEMS, typed, 'create', draft);

    expect(input['name']).toEqual({ en: 'Whole milk', es: 'Leche entera' });
  });

  /**
   * A blank box is a language the name does not have, and the wire spells that
   * by leaving the key out (plan 0079): `''` and `null` are both refused there.
   */
  it('leaves a blank locale out rather than sending an empty string', () => {
    const draft = draftFor(ITEMS, null, 'create');
    const typed = {
      ...draft,
      name: { en: 'Whole milk', es: '' },
      categoryIds: ['cat_milk'],
      defaultUnit: 'LITER',
    };

    const input = toInput(ITEMS, typed, 'create', draft);

    expect(input['name']).toEqual({ en: 'Whole milk' });
  });

  /** One entry per line, because a line break is what a synonym cannot contain. */
  it('reads a group’s synonyms as lines and submits them as a list', () => {
    const draft = draftFor(
      PRODUCT_GROUPS,
      {
        id: 'pg',
        name: { en: 'Whole milk', es: 'Leche entera' },
        slug: 'whole-milk',
        referenceUnit: 'LITER',
        synonyms: { en: ['full fat milk', 'whole fat milk'], es: [] },
      } as unknown as ResourceRow,
      'edit'
    );

    expect(draft['synonyms']).toEqual({
      en: 'full fat milk\nwhole fat milk',
      es: '',
    });

    const changed = {
      ...draft,
      synonyms: { en: 'full fat milk\n\nwhole fat milk\n', es: '' },
    };
    const input = toInput(PRODUCT_GROUPS, changed, 'edit', draft);

    expect(input['synonyms']).toEqual({
      en: ['full fat milk', 'whole fat milk'],
      es: [],
    });
  });
});

/**
 * The products in no group (plan 0012, section 2).
 *
 * The question used to be a boolean filter beside the group picker. It is now a
 * choice inside the picker, which is what lets every other nullable reference
 * ask the same question the same way.
 */
describe('the product list', () => {
  it('offers none on the group filter rather than a flag of its own', () => {
    const group = (ITEMS.filters ?? []).find(
      (filter) => filter.param === 'productGroupId'
    );

    expect(group?.kind === 'reference' ? group.nullable : null).toBe(true);
    expect((ITEMS.filters ?? []).map((filter) => filter.param)).not.toContain(
      'withoutProductGroup'
    );
  });
});

/**
 * The category tree and the product's place in it (admin plan 0036).
 *
 * Categories are rows now, so what is checked here is the shape of the two
 * fields that point at them: the product's list of leaves, and the parent a
 * category sits in.
 */
describe('categories', () => {
  it('writes the slug once and never again', () => {
    const slug = fieldOf(CATEGORIES, 'slug');

    expect(slug !== undefined && isEditable(slug, 'create')).toBe(true);
    expect(slug !== undefined && isEditable(slug, 'edit')).toBe(false);
  });

  it('offers only roots as a parent, and allows none', () => {
    const parent = fieldOf(CATEGORIES, 'parentId');

    expect(parent?.kind).toBe('reference');
    if (parent?.kind === 'reference') {
      expect(parent.nullable).toBe(true);
      expect(parent.scopeFrom?.({})).toEqual({ kind: 'root' });
    }
  });

  /**
   * `kind` is a filter and no column, and a read by ID sends no filter
   * (admin plan 0051). A root pasted into a picker of leaves must read as not
   * found, or the save is refused with `category_not_a_leaf`.
   */
  it('says whether a row read by its ID is a root or a leaf', () => {
    const root = { id: 'c1', parentId: null } as Parameters<
      NonNullable<typeof CATEGORIES.within>
    >[0];
    const leaf = { ...root, id: 'c2', parentId: 'c1' };
    // A row the gateway sent with no parent at all is a root too.
    const bare = { ...root, parentId: undefined };

    expect(CATEGORIES.within?.(root, { kind: 'leaf' })).toBe(false);
    expect(CATEGORIES.within?.(bare, { kind: 'leaf' })).toBe(false);
    expect(CATEGORIES.within?.(leaf, { kind: 'leaf' })).toBe(true);

    expect(CATEGORIES.within?.(leaf, { kind: 'root' })).toBe(false);
    expect(CATEGORIES.within?.(root, { kind: 'root' })).toBe(true);
    expect(CATEGORIES.within?.(bare, { kind: 'root' })).toBe(true);

    // No kind fixed, or one this screen does not know: nothing is narrowed.
    expect(CATEGORIES.within?.(root, {})).toBe(true);
    expect(CATEGORIES.within?.(leaf, { kind: '' })).toBe(true);
  });

  it('says a refusal about the parent under the parent', () => {
    expect(CATEGORIES.errorFields).toEqual({
      category_too_deep: 'parentId',
      category_not_a_leaf: 'parentId',
    });
  });

  /** The category is the row asked about, so the link carries no detail. */
  it('links a category in use to its products, filtered by it', () => {
    expect(CATEGORIES.errorLinks?.['category_in_use']).toEqual({
      resource: 'items',
      filter: 'categoryId',
      label: 'catalog.categories.inUseOpen',
    });
  });

  it('gives a product a required, ordered list of leaves', () => {
    const field = fieldOf(ITEMS, 'categoryIds');

    expect(field?.kind).toBe('references');
    if (field?.kind === 'references') {
      expect(field.resource).toBe('categories');
      expect(field.required).toBe(true);
      expect(field.ordered).toBe(true);
      expect(field.scopeFrom?.({})).toEqual({ kind: 'leaf' });
    }
  });

  it('filters the products by a category at any level', () => {
    expect(
      ITEMS.filters?.find((filter) => filter.param === 'categoryId')
    ).toEqual(
      expect.objectContaining({ kind: 'reference', resource: 'categories' })
    );
  });

  it('reads the ids off the categories a product row carries, in order', () => {
    const row = withCategoryIds({
      ...ITEM_SEED[0],
      categories: [
        { ...ITEM_SEED[0].categories[0], id: 'cat_b' },
        { ...ITEM_SEED[0].categories[0], id: 'cat_a' },
      ],
    });

    expect(row.categoryIds).toEqual(['cat_b', 'cat_a']);
    expect(
      draftFor(ITEMS, row as unknown as ResourceRow, 'edit')['categoryIds']
    ).toEqual(['cat_b', 'cat_a']);
  });

  /**
   * The first category is the one a row shows. Putting another first is a
   * change, where a shop's price scopes in another order are not.
   */
  it('sends a new order of the same categories, and nothing when untouched', () => {
    const row = withCategoryIds({
      ...ITEM_SEED[0],
      categories: [
        { ...ITEM_SEED[0].categories[0], id: 'cat_a' },
        { ...ITEM_SEED[0].categories[0], id: 'cat_b' },
      ],
    }) as unknown as ResourceRow;
    const original = draftFor(ITEMS, row, 'edit');

    expect(toInput(ITEMS, original, 'edit', original)).toEqual({});
    expect(
      toInput(
        ITEMS,
        { ...original, categoryIds: ['cat_b', 'cat_a'] },
        'edit',
        original
      )
    ).toEqual({ categoryIds: ['cat_b', 'cat_a'] });
  });
});
