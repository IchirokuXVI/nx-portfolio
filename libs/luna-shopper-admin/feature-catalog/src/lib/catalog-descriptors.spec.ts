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
import {
  LOCATION_ITEM_SEED,
  LOCATION_SEED,
  PRICE_POLICY_SEED,
  PRICE_SEED,
} from './catalog-seed';
import { ITEMS } from './items';
import { LOCATION_ITEMS } from './location-items';
import { LOCATIONS } from './locations';
import { PRICE_POLICIES } from './price-policies';
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

describe('the price form', () => {
  /**
   * Since backend plan 0080 the form **adds a row** and never edits one: an
   * effective price is derived, and correcting a typo is removing the row and
   * adding another. So the descriptor offers a create and nothing else, and
   * opens a row on a detail screen of its own rather than on the form.
   */
  it('adds a price and never edits or deletes the effective row', () => {
    expect(PRICES.actions?.create).toBe(true);
    expect(PRICES.actions?.edit).toBeUndefined();
    expect(PRICES.actions?.delete).toBeUndefined();
    expect(PRICES.detail).toBeDefined();
    expect(PRICES.editor).toBeDefined();
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
  it('shows where the shown price came from and offers it as a filter', () => {
    expect(PRICES.list.columns).toContain('sourceKind');
    expect(PRICES.list.compact).toContain('sourceKind');

    const filter = (PRICES.filters ?? []).find(
      (entry) => entry.param === 'sourceKind'
    );
    expect(filter?.kind).toBe('enum');
    expect(
      filter?.kind === 'enum'
        ? filter.options.map((option) => option.value)
        : []
    ).toContain('ADMIN');
  });

  it('shows when the price was last seen', () => {
    expect(PRICES.list.columns).toContain('observedAt');
    expect(fieldOf(PRICES, 'observedAt')?.kind).toBe('date');
  });

  /**
   * Backend plan 0080, section 5: the flag is the server's judgement and the
   * screen draws it as a column and offers it as a filter. It is never worked
   * out here from the date, because only the policy knows which kinds age out.
   */
  it('shows the stale flag as the server sent it and filters on it', () => {
    expect(PRICES.list.columns).toContain('stale');
    expect(PRICES.list.compact).toContain('stale');
    expect(fieldOf(PRICES, 'stale')?.kind).toBe('boolean');
    expect(
      isEditable(
        fieldOf(PRICES, 'stale') as FieldDescriptor<ResourceRow>,
        'create'
      )
    ).toBe(false);

    const filter = (PRICES.filters ?? []).find(
      (entry) => entry.param === 'stale'
    );
    expect(filter?.kind).toBe('boolean');
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
      category: 'DAIRY',
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
      category: 'DAIRY',
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
