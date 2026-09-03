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
  title: (row) => localizedTextValue(row.name, ['en', 'es']),
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

  it('draws a reference as the id it is, since resolving it costs a request', () => {
    expect(cellFor('priceScopeId')).toEqual({ text: 'ps_1' });
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
