import { TestBed } from '@angular/core/testing';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import { ResourceChanges } from '@portfolio/luna-shopper-admin/feature-resource';
import { SUPERMARKETS_PATH } from '../supermarkets';
import { ScopeChoices } from './scope-choices';

/**
 * The chains and their price scopes, read once for every picker.
 *
 * The service lives as long as the tab. So what it read has to go when a
 * chain or a price scope is written in this app, and a read that failed must
 * not be what every picker shows for the rest of the session.
 */
describe('ScopeChoices', () => {
  let chainReads: number;
  let scopeReads: number;
  let failScopes: boolean;
  let chainName: string;

  function boot(): ScopeChoices {
    chainReads = 0;
    scopeReads = 0;
    failScopes = false;
    chainName = 'Mercadona';

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: RESOURCE_GATEWAYS,
          useValue: {
            for: (source: { path: string }) => ({
              list: async () => {
                if (source.path === SUPERMARKETS_PATH) {
                  chainReads += 1;
                  return {
                    items: [
                      {
                        id: 'c1',
                        name: { es: chainName },
                        defaultPriceScopeId: null,
                      },
                    ],
                    nextCursor: null,
                  };
                }
                scopeReads += 1;
                if (failScopes) {
                  throw new Error('the gateway did not answer');
                }
                return {
                  items: [
                    {
                      id: `s${scopeReads}`,
                      supermarketId: 'c1',
                      kind: 'NATIONAL',
                      externalKey: 'es',
                      label: null,
                    },
                  ],
                  nextCursor: null,
                };
              },
            }),
          },
        },
      ],
    });

    return TestBed.inject(ScopeChoices);
  }

  it('reads the chains and the scopes of a chain once', async () => {
    const choices = boot();

    await choices.loadChains();
    await choices.loadChains();
    await choices.loadScopes('c1');
    await choices.loadScopes('c1');

    expect(chainReads).toBe(1);
    expect(scopeReads).toBe(1);
    expect(choices.scopesOf('c1').general).toHaveLength(1);
  });

  it.each(['supermarkets', 'price-scopes'])(
    'forgets what it read when one of the %s is written',
    async (resource) => {
      const choices = boot();
      await choices.loadChains();
      await choices.loadScopes('c1');

      chainName = 'Mercadona S.A.';
      TestBed.inject(ResourceChanges).wrote(resource);
      TestBed.tick();

      // Unread, so that the next picker to open asks again.
      expect(choices.chains()).toBeNull();
      expect(choices.scopesOf('c1').general).toBeNull();

      await choices.loadChains();
      await choices.loadScopes('c1');

      expect(chainReads).toBe(2);
      expect(scopeReads).toBe(2);
      expect(choices.chains()?.[0].name).toEqual({ es: 'Mercadona S.A.' });
    }
  );

  it('keeps what it read when another resource is written', async () => {
    const choices = boot();
    await choices.loadChains();

    TestBed.inject(ResourceChanges).wrote('items');
    TestBed.tick();

    expect(choices.chains()).toHaveLength(1);
  });

  it('draws a failed read as an empty list, and reads again on the next ask', async () => {
    const choices = boot();
    failScopes = true;

    await choices.loadScopes('c1');

    expect(choices.scopesOf('c1').general).toEqual([]);
    expect(choices.scopesOf('c1').generalFailed).toBe(true);

    failScopes = false;
    await choices.loadScopes('c1');

    expect(scopeReads).toBe(2);
    expect(choices.scopesOf('c1').general).toHaveLength(1);
    expect(choices.scopesOf('c1').generalFailed).toBe(false);
  });

  it('reads the single shop scopes again after a failed read of them', async () => {
    const choices = boot();
    await choices.loadScopes('c1');
    failScopes = true;

    await choices.loadShopScopes('c1');

    expect(choices.scopesOf('c1').shops).toEqual([]);
    expect(choices.scopesOf('c1').shopsFailed).toBe(true);

    failScopes = false;
    await choices.loadShopScopes('c1');

    expect(choices.scopesOf('c1').shops).toHaveLength(1);
    expect(choices.scopesOf('c1').shopsFailed).toBe(false);
  });
});
