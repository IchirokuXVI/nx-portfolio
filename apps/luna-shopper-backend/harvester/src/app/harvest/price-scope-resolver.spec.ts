import {
  PriceScopeKind,
  type PriceScopeView,
} from '@portfolio/luna-shopper/contracts';
import type { CatalogClient } from './catalog-client.service';
import { PriceScopeResolver } from './price-scope-resolver';

/**
 * Turning what a source named into what catalog holds (plan 0103, section 3).
 *
 * This is the code that used to live in `LidlCatalogRunner` and again in
 * `LidlStoreDiscoveryRunner`, which is why no other runner could create a scope
 * and the ingest could not create one at all.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';

function build(held: PriceScopeView[] = []) {
  const created: Array<{ externalKey: string | null; kind: PriceScopeKind }> =
    [];
  let pages = held;
  const listPriceScopes = jest.fn(async () => ({
    items: pages,
    nextCursor: null,
  }));
  const catalog = {
    listPriceScopes,
    createPriceScope: jest.fn(
      async (
        supermarketId: string,
        kind: PriceScopeKind,
        externalKey: string | null,
        label: unknown
      ) => {
        created.push({ externalKey, kind });
        const scope = {
          id: `scope-${externalKey}`,
          supermarketId,
          kind,
          externalKey,
          label,
        } as PriceScopeView;
        pages = [...pages, scope];
        return scope;
      }
    ),
  } as unknown as CatalogClient;

  return {
    resolver: new PriceScopeResolver(catalog).forRun(CHAIN),
    catalog,
    created,
    listPriceScopes,
  };
}

const region = (key: string, name: string | null = `Region ${key}`) => ({
  key,
  kind: PriceScopeKind.REGION,
  name,
});

describe('RunScopeResolver', () => {
  it('creates a scope for a key catalog does not hold, with the source name', async () => {
    const { resolver, catalog, created } = build();

    expect(await resolver.declare(region('21', 'Huesca'))).toBe('scope-21');
    expect(created).toEqual([
      { externalKey: '21', kind: PriceScopeKind.REGION },
    ]);
    // The source's own name, in both languages, because there is only one and
    // inventing a translation for it would be worse than repeating it.
    expect(catalog.createPriceScope).toHaveBeenCalledWith(
      CHAIN,
      PriceScopeKind.REGION,
      '21',
      { es: 'Huesca', en: 'Huesca' }
    );
  });

  it('reuses a scope catalog already holds for that key', async () => {
    // **The key is the source's own, never a uuid** (plan 0103, D3). That is
    // what makes a run idempotent across weeks: the region a store discovery
    // met last month resolves to the same scope a catalog run declares today.
    const { resolver, created } = build([
      {
        id: 'scope-held',
        supermarketId: CHAIN,
        kind: PriceScopeKind.REGION,
        externalKey: '21',
        label: null,
      } as PriceScopeView,
    ]);

    expect(await resolver.declare(region('21'))).toBe('scope-held');
    expect(created).toEqual([]);
  });

  it('pages the chain once however many keys a run declares', async () => {
    const { resolver, listPriceScopes } = build();

    await resolver.declare(region('1'));
    await resolver.declare(region('2'));
    await resolver.declare(region('1'));

    // A walk declares a region once per product priced for it, which for 59
    // regions across 4,000 products is a great many calls. The read is once.
    expect(listPriceScopes).toHaveBeenCalledTimes(1);
    expect(resolver.createdCount).toBe(2);
    expect(resolver.keys).toEqual(['1', '2']);
  });

  it('answers a key nothing declared with null, and asks catalog nothing', async () => {
    // This is what the ingest calls on every price of every product, so it is
    // synchronous and free of side effects. **A price is not a declaration**
    // (plan 0103, D4): a scope with no kind and no name is a row an operator
    // cannot act on, so an undeclared key is a warning rather than a scope.
    const { resolver, catalog } = build();

    await resolver.declare(region('21'));

    expect(resolver.idFor('21')).toBe('scope-21');
    expect(resolver.idFor('99')).toBeNull();
    expect(catalog.createPriceScope).toHaveBeenCalledTimes(1);
  });

  it('says which keys it had to create, for the run report', async () => {
    const { resolver } = build([
      {
        id: 'scope-held',
        supermarketId: CHAIN,
        kind: PriceScopeKind.REGION,
        externalKey: '21',
        label: null,
      } as PriceScopeView,
    ]);

    await resolver.declare(region('21'));
    await resolver.declare(region('26'));

    expect(resolver.wasCreated('21')).toBe(false);
    expect(resolver.wasCreated('26')).toBe(true);
  });
});
