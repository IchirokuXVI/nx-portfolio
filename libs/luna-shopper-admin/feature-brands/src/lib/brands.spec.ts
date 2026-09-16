import {
  isEditable,
  type ReferenceField,
} from '@portfolio/luna-shopper-admin/models';
import { BRANDS } from './brands';

/**
 * What the brands descriptor claims, checked without rendering anything (admin
 * plan 0027, section 7).
 *
 * A descriptor is a statement about the gateway, and most of the ways to get one
 * wrong are silent: a column naming a field that does not exist draws an empty
 * cell, a filter naming a parameter no route declares answers 400 only when
 * somebody uses it, and a sort the route does not accept is a control that
 * changes nothing.
 */
describe('BRANDS', () => {
  it('names a field for each of its columns', () => {
    const named = new Set(BRANDS.fields.map((field) => field.name));

    for (const column of BRANDS.list.columns) {
      expect([column, named.has(column)]).toEqual([column, true]);
    }
  });

  it('draws a card from a subset of its own columns', () => {
    const columns = new Set(BRANDS.list.columns);

    for (const compact of BRANDS.list.compact) {
      expect([compact, columns.has(compact)]).toEqual([compact, true]);
    }
  });

  /**
   * The chain reference points at a resource, resolved by name.
   *
   * `nameFrom` and `nameLookup` are mutually exclusive: the first reads a name
   * the row already carries and the second asks the registry for it, and a field
   * declaring both would say two different things about where its name comes
   * from (admin plan 0023, sections 3 and 4).
   */
  it('resolves the chain by name, one way and not two', () => {
    const references = BRANDS.fields.filter(
      (field): field is ReferenceField<Record<string, unknown>> =>
        field.kind === 'reference'
    );

    expect(references.map((field) => field.name)).toEqual([
      'privateLabelSupermarketId',
    ]);

    for (const field of references) {
      expect(field.resource).toBe('supermarkets');
      expect(
        field.nameFrom !== undefined && field.nameLookup !== undefined
      ).toBe(false);
    }
  });

  /**
   * The filter is **not** nullable, unlike the field.
   *
   * `GET /v1/admin/catalog/brands` takes a chain's uuid on
   * `privateLabelSupermarketId` and has no "none", so offering that choice would
   * be a control whose only possible answer is a refused request.
   */
  it('offers no "none" on the chain filter, because the route has none', () => {
    const filter = (BRANDS.filters ?? []).find(
      (candidate) => candidate.kind === 'reference'
    );

    expect(filter).toBeDefined();
    expect(filter?.kind === 'reference' && filter.nullable).toBeUndefined();
  });

  it('sends only the two orders the route accepts', () => {
    expect((BRANDS.sorts ?? []).map((sort) => sort.value)).toEqual([
      'label',
      'itemCount',
    ]);
  });

  /**
   * The key is made from the label by `brandKey` and is in no request body, so
   * a control for it would be a control the server ignores.
   */
  it('lets nothing edit the key, in either mode', () => {
    const key = BRANDS.fields.filter((field) => field.name === 'key');

    expect(key).toHaveLength(1);
    expect(key.map((field) => isEditable(field, 'create'))).toEqual([false]);
    expect(key.map((field) => isEditable(field, 'edit'))).toEqual([false]);
  });

  /** There is no delete route (backend plan 0115, section 9). */
  it('offers create and edit, and never delete', () => {
    expect(BRANDS.actions).toEqual({ create: true, edit: true });
  });

  it('calls a row by its label', () => {
    expect(BRANDS.title({ label: 'Hacendado' }, ['en', 'es'])).toBe(
      'Hacendado'
    );
  });

  /** Every label a screen draws is a key, so a name can change in `en.json`. */
  it('keys every label it shows', () => {
    const keys = [
      BRANDS.labels.one,
      BRANDS.labels.many,
      ...BRANDS.fields.flatMap((field) => [field.label, field.help ?? '']),
      ...(BRANDS.sorts ?? []).map((sort) => sort.label),
      ...(BRANDS.filters ?? []).map((filter) => filter.label),
    ].filter((key) => key !== '');

    for (const key of keys) {
      expect([key, key.startsWith('brands.')]).toEqual([key, true]);
    }
  });
});
