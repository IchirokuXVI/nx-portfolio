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
   * Each reference points at a resource and resolves its name one way.
   *
   * `nameFrom` and `nameLookup` are mutually exclusive: the first reads a name
   * the row already carries and the second asks the registry for it, and a field
   * declaring both would say two different things about where its name comes
   * from (admin plan 0023, sections 3 and 4).
   */
  it('resolves each reference by name, one way and not two', () => {
    const references = BRANDS.fields.filter(
      (field): field is ReferenceField<Record<string, unknown>> =>
        field.kind === 'reference'
    );

    expect(references.map((field) => [field.name, field.resource])).toEqual([
      ['canonicalBrandId', 'brands'],
      ['privateLabelSupermarketId', 'supermarkets'],
    ]);

    for (const field of references) {
      expect(
        field.nameFrom !== undefined && field.nameLookup !== undefined
      ).toBe(false);
    }
  });

  /**
   * The link points at brands, which is this resource itself (backend plan
   * 0124). Brands are a large target, so the label rides the row rather than
   * costing one lookup per distinct id, and it is a plain string rather than a
   * localized text: a brand is spelled the same in both content languages.
   */
  it('names the brand it spells from the row, and clears with null', () => {
    const field = BRANDS.fields.find(
      (candidate) => candidate.name === 'canonicalBrandId'
    ) as ReferenceField<Record<string, unknown>>;

    expect(field.kind).toBe('reference');
    expect(field.resource).toBe('brands');
    expect(field.nameFrom).toBe('canonicalLabel');
    expect(field.nameLookup).toBeUndefined();
    expect(field.nullable).toBe(true);
    expect(isEditable(field, 'edit')).toBe(true);
  });

  /** After the name, because it is the second thing the name is about. */
  it('draws the link beside the name on the list', () => {
    expect(BRANDS.list.columns).toEqual([
      'label',
      'canonicalBrandId',
      'key',
      'privateLabelSupermarketId',
      'itemCount',
    ]);
  });

  /**
   * Refusals that name a brand, and where that brand lives.
   *
   * `brand_key_taken` is on an edit as well as a create: renaming a brand into
   * a name that makes a key another brand holds is refused the same way.
   */
  it('links the two refusals that name a brand', () => {
    expect(BRANDS.errorLinks).toEqual({
      brand_link_too_deep: {
        detail: 'brandId',
        resource: 'brands',
        label: 'brands.registered.links.open',
      },
      brand_key_taken: {
        detail: 'brandId',
        resource: 'brands',
        label: 'brands.registered.links.open',
      },
    });
  });

  /**
   * The filter is **not** nullable, unlike the field.
   *
   * `GET /v1/admin/catalog/brands` takes a chain's uuid on
   * `privateLabelSupermarketId` and has no "none", so offering that choice would
   * be a control whose only possible answer is a refused request.
   */
  it('offers no "none" on either reference filter, because neither route has one', () => {
    const filters = (BRANDS.filters ?? []).filter(
      (candidate) => candidate.kind === 'reference'
    );

    expect(
      filters.map((filter) => [
        filter.param,
        filter.kind === 'reference' ? filter.resource : '',
      ])
    ).toEqual([
      ['privateLabelSupermarketId', 'supermarkets'],
      ['canonicalBrandId', 'brands'],
    ]);

    for (const filter of filters) {
      expect(filter.kind === 'reference' && filter.nullable).toBeUndefined();
    }
  });

  /**
   * The link filter is a picker over brands, and a picker types to search. A
   * reference filter sends the typed text only if the **target** declares a
   * search filter, and here the target is this same descriptor.
   */
  it('can be searched, which is what makes its own picker work', () => {
    expect((BRANDS.filters ?? []).map((filter) => filter.kind)).toContain(
      'search'
    );
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

  /**
   * A spelling can be deleted and nothing else can, so the list offers no
   * delete at all: the control is on the detail screen, where the link that
   * makes it legal is on the page.
   */
  it('offers create and edit, and no delete on the list', () => {
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
