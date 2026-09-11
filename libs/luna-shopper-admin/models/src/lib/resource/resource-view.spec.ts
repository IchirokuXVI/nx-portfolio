import { localizedTextValue } from './localized-text';
import { defineResource, type ResourceDescriptor } from './resource-descriptor';
import {
  EMPTY_VALUE_KEY,
  FALSE_VALUE_KEY,
  toCell,
  toRowView,
  TRUE_VALUE_KEY,
  type RenderOptions,
} from './resource-view';

interface Shop {
  id: string;
  name: Record<string, string>;
  websiteUrl: string | null;
  price: string | null;
  openedAt: string | null;
  stores: number | null;
  tier: string;
  active: boolean | null;
  priceScopeId: string | null;
}

const options: RenderOptions = { locale: 'en', contentLocales: ['en', 'es'] };

const descriptor: ResourceDescriptor<Shop> = {
  name: 'shops',
  segment: 'shops',
  labels: { one: 'shops.one', many: 'shops.many' },
  title: (row, locales) => localizedTextValue(row.name, locales),
  fields: [
    { kind: 'text', name: 'id', label: 'shops.id', editable: false },
    {
      kind: 'localized-text',
      name: 'name',
      label: 'shops.name',
      locales: ['en', 'es'],
    },
    { kind: 'text', name: 'websiteUrl', label: 'shops.website', format: 'url' },
    { kind: 'money', name: 'price', label: 'shops.price', decimals: 2 },
    { kind: 'date', name: 'openedAt', label: 'shops.openedAt' },
    { kind: 'number', name: 'stores', label: 'shops.stores' },
    {
      kind: 'enum',
      name: 'tier',
      label: 'shops.tier',
      options: [{ value: 'a', label: 'shops.tier.a' }],
    },
    { kind: 'boolean', name: 'active', label: 'shops.active' },
    {
      kind: 'reference',
      name: 'priceScopeId',
      label: 'shops.priceScope',
      resource: 'price-scopes',
    },
  ],
  list: {
    columns: ['name', 'websiteUrl', 'stores'],
    compact: ['name'],
  },
  gateway: () => {
    throw new Error('not used');
  },
};

const row: Shop = {
  id: 's1',
  name: { en: 'Bonpreu', es: 'Bonpreu' },
  websiteUrl: 'https://bonpreu.example',
  price: '3.5',
  openedAt: '2026-01-15T10:30:00.000Z',
  stores: 1200,
  tier: 'a',
  active: true,
  priceScopeId: 'ps_1',
};

const cellFor = (name: keyof Shop, value: Partial<Shop> = {}) =>
  toCell(
    descriptor.fields.find((field) => field.name === name) ??
      descriptor.fields[0],
    { ...row, ...value },
    options
  );

describe('toCell', () => {
  it('reads localized text in the preferred content locale', () => {
    expect(cellFor('name')).toEqual({ text: 'Bonpreu' });
  });

  /**
   * A Spanish only name reads as its Spanish name in an English table, and the
   * cell says which language it is still waiting for (plan 0079).
   */
  it('shows the fallback of a name in one language and names the gap', () => {
    expect(cellFor('name', { name: { es: 'Bonpreu' } })).toEqual({
      text: 'Bonpreu',
      missing: ['en'],
    });
  });

  it('formats money to the column scale', () => {
    expect(cellFor('price')).toEqual({ text: '3.50' });
  });

  it('formats a date with Intl rather than leaving the instant on screen', () => {
    const cell = cellFor('openedAt');
    expect(cell.text).not.toContain('T10:30');
    expect(cell.text).not.toBe('');
  });

  it('gives a url field a link target as well as its text', () => {
    expect(cellFor('websiteUrl')).toEqual({
      text: 'https://bonpreu.example',
      href: 'https://bonpreu.example',
    });
  });

  it('renders an enum as its keyed label, never as the stored value', () => {
    expect(cellFor('tier')).toEqual({ text: '', key: 'shops.tier.a' });
  });

  /**
   * A value the descriptor does not list is still shown. An enum the backend
   * widened should reach the operator as something they can report rather than
   * as a blank cell.
   */
  it('shows an enum value the descriptor does not know', () => {
    expect(cellFor('tier', { tier: 'z' })).toEqual({ text: 'z' });
  });

  it('says yes and no as keys, so both are translated', () => {
    expect(cellFor('active')).toEqual({ text: '', key: TRUE_VALUE_KEY });
    expect(cellFor('active', { active: false })).toEqual({
      text: '',
      key: FALSE_VALUE_KEY,
    });
  });

  /**
   * A boolean that is missing is not the same claim as a boolean that is false,
   * and the cell has to be able to say which.
   */
  it('tells a missing boolean apart from a false one', () => {
    expect(cellFor('active', { active: null })).toEqual({
      text: '',
      key: EMPTY_VALUE_KEY,
    });
  });

  it('says nothing is there, as a key, for every other empty value', () => {
    expect(cellFor('websiteUrl', { websiteUrl: null })).toEqual({
      text: '',
      key: EMPTY_VALUE_KEY,
    });
    expect(cellFor('price', { price: null })).toEqual({
      text: '',
      key: EMPTY_VALUE_KEY,
    });
    expect(cellFor('stores', { stores: null })).toEqual({
      text: '',
      key: EMPTY_VALUE_KEY,
    });
  });

  /**
   * The id is on the row, so the cell always knows what it points at even when
   * it cannot yet say what that is called (admin plan 0023, section 2.1). The
   * link is deliberately absent: it needs the route table, which this module
   * must not know, so the list page derives it from the registry.
   */
  it('draws a reference as its id and carries what it points at', () => {
    expect(cellFor('priceScopeId')).toEqual({
      text: 'ps_1',
      reference: { resource: 'price-scopes', id: 'ps_1' },
    });
  });
});

/**
 * A reference whose name rides the row (admin plan 0023, section 2.4): the
 * backend joined the target's name on, and the cell renders it exactly as a
 * `localized-text` field would, id as the fallback.
 */
describe('a reference that names its target from the row', () => {
  interface PriceRow {
    id: string;
    itemId: string;
    itemName: Record<string, string> | null;
  }

  const named = defineResource<PriceRow>({
    name: 'prices',
    segment: 'prices',
    labels: { one: 'prices.one', many: 'prices.many' },
    title: (entry) => entry.itemId,
    fields: [
      {
        kind: 'reference',
        name: 'itemId',
        label: 'prices.item',
        resource: 'items',
        nameFrom: 'itemName',
      },
    ],
    list: { columns: ['itemId'], compact: ['itemId'] },
    gateway: () => {
      throw new Error('not used');
    },
  });

  const cellOf = (itemName: Record<string, string> | null) =>
    toRowView(named, { id: 'si1', itemId: 'it_1', itemName }, options).cells[
      'itemId'
    ];

  it('renders the joined name through the content locales', () => {
    expect(cellOf({ en: 'Whole milk', es: 'Leche entera' })).toEqual({
      text: 'Whole milk',
      reference: { resource: 'items', id: 'it_1' },
    });
  });

  it('marks the locales the name is still waiting for', () => {
    expect(cellOf({ es: 'Leche entera' })).toEqual({
      text: 'Leche entera',
      missing: ['en'],
      reference: { resource: 'items', id: 'it_1' },
    });
  });

  it('falls back to the id when the join found nothing', () => {
    expect(cellOf(null)).toEqual({
      text: 'it_1',
      reference: { resource: 'items', id: 'it_1' },
    });
  });
});

describe('toRowView', () => {
  it('carries the id and what the descriptor calls the row', () => {
    const view = toRowView(descriptor, row, options);

    expect(view.id).toBe('s1');
    expect(view.title).toBe('Bonpreu');
  });

  /**
   * Only what the presentation asked for. A field the descriptor declares but
   * does not put in a column is not a cell, so a table cannot grow a column
   * nobody chose.
   */
  it('makes a cell for the columns and for nothing else', () => {
    const view = toRowView(descriptor, row, options);

    expect(Object.keys(view.cells)).toEqual(['name', 'websiteUrl', 'stores']);
  });

  it('keeps the row, for a named action that needs it', () => {
    expect(toRowView(descriptor, row, options).row).toBe(row);
  });
});

/**
 * The operator's reading order (admin plan 0026).
 *
 * `contentLocales` used to be the `CONTENT_LOCALES` constant at every call
 * site, so every localized value on screen was read English first whatever the
 * operator was working in. It is an order now, and the two properties that make
 * it an order rather than a filter are asserted here: a row named in one
 * language only still shows the name it has, under **either** choice, and the
 * cell still reports the language it is missing.
 */
describe('a localized value under a chosen reading order', () => {
  const english: RenderOptions = { locale: 'en', contentLocales: ['en', 'es'] };
  const spanish: RenderOptions = { locale: 'en', contentLocales: ['es', 'en'] };

  const bilingual: Shop = {
    ...row,
    name: { en: 'Bakery', es: 'Panaderia' },
  };
  const spanishOnly: Shop = { ...row, name: { es: 'Panaderia' } };

  const nameCell = (shop: Shop, render: RenderOptions) =>
    toCell(
      descriptor.fields.find((field) => field.name === 'name') ??
        descriptor.fields[0],
      shop,
      render
    );

  it('reads the chosen language first', () => {
    expect(nameCell(bilingual, english)).toEqual({ text: 'Bakery' });
    expect(nameCell(bilingual, spanish)).toEqual({ text: 'Panaderia' });
  });

  /**
   * The row an operator is looking for. Nothing is hidden and no cell goes
   * blank: the name it has is shown and the gap is still marked, so the screen
   * that finds untranslated rows is not the one screen that cannot show them.
   */
  it('falls through to the language a name has, and still reports the gap', () => {
    expect(nameCell(spanishOnly, english)).toEqual({
      text: 'Panaderia',
      missing: ['en'],
    });
    expect(nameCell(spanishOnly, spanish)).toEqual({
      text: 'Panaderia',
      missing: ['en'],
    });
  });

  /** The title takes the order too, so a heading agrees with its own table. */
  it('titles a row in the chosen language', () => {
    expect(toRowView(descriptor, bilingual, english).title).toBe('Bakery');
    expect(toRowView(descriptor, bilingual, spanish).title).toBe('Panaderia');
    expect(toRowView(descriptor, spanishOnly, english).title).toBe('Panaderia');
  });
});

/**
 * A field that says where its displayed value comes from.
 *
 * The shape it exists for is a zone row: the gateway decorates it with the
 * owner's name from a second call to auth, and that name is null whenever the
 * id resolved to nobody. The rule is that the screen renders the id and the
 * listing still succeeds (plan 0074, section 3), which is one expression on the
 * descriptor rather than a special case in the list.
 */
describe('a field that reads from somewhere else', () => {
  const decorated = defineResource<{
    id: string;
    ownerName: string | null;
    ownerUserId: string;
  }>({
    name: 'zones',
    segment: 'zones',
    labels: { one: 'zones.one', many: 'zones.many' },
    title: (entry) => entry.id,
    fields: [
      {
        kind: 'text',
        name: 'ownerName',
        label: 'zones.owner',
        editable: false,
        read: (entry) => entry.ownerName ?? entry.ownerUserId,
      },
    ],
    list: { columns: ['ownerName'], compact: ['ownerName'] },
    gateway: () => {
      throw new Error('not used');
    },
  });

  it('shows the property when it has one', () => {
    const view = toRowView(
      decorated,
      { id: 'z1', ownerName: 'rosa', ownerUserId: 'u1' },
      options
    );

    expect(view.cells['ownerName']).toEqual({ text: 'rosa' });
  });

  it('falls back to what the field named instead', () => {
    const view = toRowView(
      decorated,
      { id: 'z1', ownerName: null, ownerUserId: 'u1' },
      options
    );

    expect(view.cells['ownerName']).toEqual({ text: 'u1' });
  });
});
