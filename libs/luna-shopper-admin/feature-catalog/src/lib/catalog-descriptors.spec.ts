import {
  fieldOf,
  isEditable,
  queryFilters,
  unansweredFilters,
  type AnyResourceDescriptor,
  type FieldDescriptor,
} from '@portfolio/luna-shopper-admin/models';
import { ITEMS } from './items';
import { LOCATION_ITEMS } from './location-items';
import { LOCATIONS } from './locations';
import { PRICE_SCOPES } from './price-scopes';
import { PRICES } from './prices';
import { PRODUCT_GROUPS } from './product-groups';
import { SUPERMARKETS } from './supermarkets';

/**
 * What every catalog descriptor has to be true of (plan 0005, section 1).
 *
 * The seven resources are configuration rather than code, which means the
 * mistakes available in them are configuration mistakes: a column naming a field
 * that is not there, a phone column the table does not show, a filter pointing
 * at a resource nobody mounted. None of those fail to compile and none of them
 * are visible until the screen is opened, so they are asserted here once for all
 * seven rather than seven times.
 */

const CATALOG: readonly AnyResourceDescriptor[] = [
  SUPERMARKETS,
  LOCATIONS,
  PRICE_SCOPES,
  PRODUCT_GROUPS,
  ITEMS,
  PRICES,
  LOCATION_ITEMS,
];

const NAMES = new Set(CATALOG.map((descriptor) => descriptor.name));

describe.each(CATALOG.map((d) => [d.name, d] as const))(
  'the %s descriptor',
  (_name, descriptor) => {
    it('names a real field for every column', () => {
      const missing = descriptor.list.columns.filter(
        (column) => fieldOf(descriptor, column) === undefined
      );

      expect(missing).toEqual([]);
    });

    /**
     * The compact list is what survives to a phone, so it has to be a subset of
     * what the table shows. A card column that is not a table column would
     * appear only on a phone, which is nobody's intention.
     */
    it('draws its phone columns from its table columns', () => {
      const columns = new Set<string>(descriptor.list.columns);
      const stray = descriptor.list.compact.filter(
        (name) => !columns.has(name)
      );

      expect(stray).toEqual([]);
    });

    it('points every reference at a resource this app mounts', () => {
      const targets = descriptor.fields
        .filter(
          (field): field is Extract<FieldDescriptor, { kind: 'reference' }> =>
            field.kind === 'reference'
        )
        .map((field) => field.resource);

      const filters = (descriptor.filters ?? [])
        .filter((filter) => filter.kind === 'reference')
        .map((filter) => filter.resource);

      expect(
        [...targets, ...filters].filter((target) => !NAMES.has(target))
      ).toEqual([]);
    });

    /**
     * A filter that narrows another one has to name a filter this resource
     * really offers, or the picker waits forever for a value nothing can set.
     */
    it('scopes a filter only by a filter it has', () => {
      const params = new Set((descriptor.filters ?? []).map((f) => f.param));
      const dangling = (descriptor.filters ?? [])
        .filter((filter) => filter.kind === 'reference')
        .map((filter) => filter.scopedBy)
        .filter(
          (scopedBy): scopedBy is string =>
            scopedBy !== undefined && !params.has(scopedBy)
        );

      expect(dangling).toEqual([]);
    });

    it('gives every field a keyed label rather than words', () => {
      const unkeyed = descriptor.fields
        .map((field) => field.label)
        .filter((label) => !label.startsWith('catalog.'));

      expect(unkeyed).toEqual([]);
    });
  }
);

describe('the catalog as a whole', () => {
  it('gives every resource its own name and its own segment', () => {
    expect(new Set(CATALOG.map((d) => d.name)).size).toBe(CATALOG.length);
    expect(new Set(CATALOG.map((d) => d.segment)).size).toBe(CATALOG.length);
  });

  /**
   * Four of the seven routes accept an `order` parameter and drop it: the
   * service orders by creation whatever is asked. Offering a control that
   * changed nothing would be worse than offering none, so only the three that
   * honour it declare sorts.
   */
  it('offers an order only where the backend honours one', () => {
    const sorted = CATALOG.filter((d) => (d.sorts ?? []).length > 0).map(
      (d) => d.name
    );

    expect(sorted.sort()).toEqual(['items', 'product-groups', 'supermarkets']);
  });
});

describe('a list that cannot begin from everything', () => {
  /**
   * There is no route that lists shops across chains: a chain's shops are
   * addressed under the chain. So the list has to wait, and the descriptor is
   * what says so.
   */
  it('waits for the chain before reading any shops', () => {
    const waiting = unansweredFilters(LOCATIONS.filters ?? [], {});

    expect(waiting.map((filter) => filter.param)).toEqual(['supermarketId']);
    expect(
      unansweredFilters(LOCATIONS.filters ?? [], { supermarketId: 'x' })
    ).toEqual([]);
  });

  /**
   * A shop cannot be searched for without naming its chain, and the aisle
   * position route has no chain parameter at all. So the chain narrows the shop
   * picker and is never sent: the gateway validates its query with
   * `forbidNonWhitelisted`, so sending it would be a 400 rather than a harmless
   * extra.
   */
  it('asks for a chain it never sends, so a shop can be chosen', () => {
    const filters = LOCATION_ITEMS.filters ?? [];
    const chain = filters.find((f) => f.param === 'supermarketId');
    const shop = filters.find((f) => f.param === 'supermarketLocationId');

    expect(chain?.required).toBe(true);
    expect(chain?.local).toBe(true);
    expect(shop?.kind === 'reference' ? shop.scopedBy : null).toBe(
      'supermarketId'
    );

    expect(
      queryFilters(filters, {
        supermarketId: 'sm_mercadona',
        supermarketLocationId: 'loc_1',
      })
    ).toEqual({ supermarketLocationId: 'loc_1' });
  });

  /**
   * The chain is a path segment on the shops route rather than a parameter it
   * declares, so it reaches the gateway and is then left out of the query
   * string. It is not `local`: it really is sent, just not as a parameter.
   */
  it('sends the chain for shops, because the path is built from it', () => {
    expect(
      queryFilters(LOCATIONS.filters ?? [], {
        supermarketId: 'sm_mercadona',
        postalCodeSource: 'DERIVED',
      })
    ).toEqual({ supermarketId: 'sm_mercadona', postalCodeSource: 'DERIVED' });
  });
});

describe('the fields a form must not offer to change', () => {
  /**
   * Half the catalog is keyed on something the caller states rather than on an
   * id the server mints, and none of those appear in the matching update DTO. A
   * form that offered them on an edit would take the operator's answer, report
   * success, and change nothing.
   */
  it.each([
    ['prices', PRICES, ['itemId', 'priceScopeId']],
    ['location-items', LOCATION_ITEMS, ['itemId', 'supermarketLocationId']],
    ['price-scopes', PRICE_SCOPES, ['supermarketId']],
    ['locations', LOCATIONS, ['supermarketId']],
  ] as const)('%s cannot move its key', (_name, descriptor, keys) => {
    for (const key of keys) {
      const field = fieldOf(descriptor, key);
      expect(field).toBeDefined();
      expect(field === undefined ? null : isEditable(field, 'create')).toBe(
        true
      );
      expect(field === undefined ? null : isEditable(field, 'edit')).toBe(
        false
      );
    }
  });
});
