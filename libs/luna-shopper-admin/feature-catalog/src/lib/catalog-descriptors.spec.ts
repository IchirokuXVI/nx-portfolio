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
  ITEM_CATEGORY_OPTIONS,
  POSTAL_CODE_SOURCE_OPTIONS,
  PRICE_SCOPE_KIND_OPTIONS,
  PRICE_SOURCE_KIND_OPTIONS,
  UNIT_OF_MEASURE_OPTIONS,
} from './catalog-enums';
import { LOCATION_ITEM_SEED, LOCATION_SEED, PRICE_SEED } from './catalog-seed';
import { ITEMS } from './items';
import { LOCATION_ITEMS } from './location-items';
import { LOCATIONS } from './locations';
import { PRICE_SCOPES } from './price-scopes';
import { PRICES } from './prices';
import { PRODUCT_GROUPS } from './product-groups';
import { SUPERMARKETS } from './supermarkets';

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

const ALL = [
  SUPERMARKETS,
  LOCATIONS,
  PRICE_SCOPES,
  ITEMS,
  PRODUCT_GROUPS,
  PRICES,
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

  it('gives a filter that a list cannot be read without', () => {
    for (const descriptor of ALL) {
      const params = new Set(
        (descriptor.filters ?? []).map((filter) => filter.param)
      );

      for (const required of descriptor.requires ?? []) {
        expect([descriptor.name, required, params.has(required)]).toEqual([
          descriptor.name,
          required,
          true,
        ]);
      }
    }
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
      ITEM_CATEGORY_OPTIONS,
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

  it('cannot be read until a chain is named', () => {
    expect(LOCATIONS.requires).toEqual(['supermarketId']);
  });
});

describe('the price form', () => {
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

  it('offers no shop among its filters either', () => {
    const shopPointing = (PRICES.filters ?? []).filter(
      (filter) => filter.kind === 'reference' && filter.resource === 'locations'
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
   * The key columns are what the row *is*. A `PUT` with a different pair writes
   * a second price rather than moving this one, so they are settable once.
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
  /** "What have I typed in and pinned", which nothing else can ask. */
  it('shows where a price came from and offers it as a filter', () => {
    expect(PRICES.list.columns).toContain('priceSourceKind');
    expect(PRICES.list.compact).toContain('priceSourceKind');

    const filter = (PRICES.filters ?? []).find(
      (entry) => entry.param === 'priceSourceKind'
    );
    expect(filter?.kind).toBe('enum');
    expect(
      filter?.kind === 'enum'
        ? filter.options.map((option) => option.value)
        : []
    ).toContain('ADMIN');
  });

  /** So a stale price is recognisable as stale rather than merely as a number. */
  it('shows when the price was last seen', () => {
    expect(PRICES.list.columns).toContain('priceObservedAt');
    expect(fieldOf(PRICES, 'priceObservedAt')?.kind).toBe('date');
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
   * A per shop row an operator merely opened must not come back saying "not
   * sold here". The column has three answers and the draft starts on the third.
   */
  it('starts a per shop override at "nobody has checked"', () => {
    const draft = draftFor(LOCATION_ITEMS, null, 'create');

    expect(draft['available']).toBeNull();

    const input = toInput(LOCATION_ITEMS, draft, 'create', {});
    expect(input['available']).toBeNull();
  });

  /**
   * `SupermarketItem.available` defaults to true, so a price created through an
   * untouched checkbox would declare the product unsold at the moment it was
   * priced.
   */
  it('starts a scope wide flag at what the column defaults to', () => {
    const draft = draftFor(PRICES, null, 'create');

    expect(draft['available']).toBe(true);
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
   * typed in would erase the other one.
   */
  it('submit every locale, including the ones nobody touched', () => {
    const draft = draftFor(ITEMS, null, 'create');
    const typed = {
      ...draft,
      name: { en: 'Whole milk', es: '' },
      category: 'DAIRY',
      defaultUnit: 'LITER',
    };

    const input = toInput(ITEMS, typed, 'create', draft);

    expect(input['name']).toEqual({ en: 'Whole milk', es: '' });
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
