import { inject, type Provider } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import {
  ResourceReferences,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { defineResource } from '@portfolio/luna-shopper-admin/models';
import { BasketLinesPanel } from './basket-lines-panel';
import { basketSettlements, toBasketSettlement } from './basket-settlements';
import {
  bootShoppers,
  find,
  settle,
  ShoppersTestHost,
  textOf,
} from './shoppers.testing';

/**
 * A basket row's settlements (admin plan 0033; backend plan 0160): what each
 * one was, how many, what was paid or that nothing was, where, and by whom.
 */

/** The shopping list of the fixture, under the person who owns it. */
const SATURDAY =
  '/shoppers/people/11111111-1111-4111-8111-111111111111/shopping-lists/b-saturday';

/**
 * A chain and its shops, mounted the way admin plan 0042 mounts them, for the
 * spec about a settlement's shop being a link. Two rows, enough for the shop
 * of the fixture to have an address under its chain.
 */
const CHAINS = defineResource<{ id: string; name: string }>({
  name: 'supermarkets',
  segment: 'chains',
  labels: { one: 'chain', many: 'chains' },
  title: (row) => row.name,
  fields: [{ kind: 'text', name: 'name', label: 'name' }],
  list: { columns: ['name'], compact: ['name'] },
  actions: { edit: true },
  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<{ id: string; name: string }>({
      path: '/test/chains',
      seed: [{ id: 'chain-1', name: 'Chain' }],
    }),
});

interface Shop {
  id: string;
  supermarketId: string;
  address: string;
}

const SHOPS = defineResource<Shop>({
  name: 'locations',
  segment: 'shops',
  parent: {
    resource: 'supermarkets',
    param: 'chainId',
    filter: 'supermarketId',
  },
  labels: { one: 'shop', many: 'shops' },
  title: (row) => row.address,
  fields: [{ kind: 'text', name: 'address', label: 'address' }],
  list: { columns: ['address'], compact: ['address'] },
  actions: { edit: true },
  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<Shop>({
      path: '/test/shops',
      seed: [
        {
          id: 'loc_cordoba_centro',
          supermarketId: 'chain-1',
          address: 'Calle Cruz Conde 4',
        },
      ],
    }),
});

const CHAINS_SECTION: AdminSection = {
  key: 'chains',
  label: '',
  held: [CHAINS, SHOPS],
};

async function boot(
  url: string,
  providers: Provider[] = [],
  others: readonly AdminSection[] = []
) {
  const fixture = await bootShoppers(url, providers, others);
  // The names the page asks for land one turn after the page does.
  await settle(fixture);
  return fixture;
}

/** The panel of the record page that draws the rows and their settlements. */
function page(fixture: ComponentFixture<ShoppersTestHost>): BasketLinesPanel {
  return fixture.debugElement.query(By.directive(BasketLinesPanel))
    .componentInstance as BasketLinesPanel;
}

const text = textOf;

describe('a basket row’s settlements', () => {
  it('shows the price paid, the shop and who settled', async () => {
    const fixture = await boot(SATURDAY);

    const [bought] = page(fixture).settlementsOf('line-bread');
    expect(bought.outcome).toBe('BOUGHT');
    expect(bought.quantity).toBe(1);
    expect(bought.paid).toContain('1.29');
    // The shop is not a resource this spec mounts, so its id stands, and
    // there is nowhere for a link to go.
    expect(bought.shop).toBe('loc_cordoba_centro');
    expect(bought.shopPath).toBeNull();
    expect(find(fixture, '[data-shop]')?.tagName).toBe('SPAN');
    // The person is, and is named.
    expect(bought.by).toBe('rosa');
    expect(bought.byParticipant).toBe(false);
  });

  it('says there was no price rather than drawing nothing', async () => {
    const fixture = await boot(SATURDAY);

    const [none] = page(fixture).settlementsOf('line-milk');
    expect(none.outcome).toBe('NOT_AVAILABLE');
    expect(none.paid).toBe('');
    expect(none.byParticipant).toBe(true);
    expect(text(fixture)).toContain('people.baskets.settlement.noPrice');
    expect(text(fixture)).toContain(
      'people.baskets.settlement.outcome.NOT_AVAILABLE'
    );
  });

  it('keeps a settlement that was taken back, marked as such', async () => {
    const fixture = await boot(SATURDAY);

    const settled = page(fixture).settlementsOf('line-bread');
    expect(settled.map((one) => one.reverted)).toEqual([false, true]);
    expect(
      fixture.nativeElement.querySelectorAll('.settlements li.reverted')
    ).toHaveLength(1);
    expect(text(fixture)).toContain('people.baskets.settlement.reverted');
  });

  it('keeps every settlement when no name can be looked up', async () => {
    const fixture = await boot(SATURDAY, [
      {
        provide: ResourceReferences,
        // `resolve` answers `null` for a row it cannot read, and never
        // throws. The record page around the panel asks it too.
        useValue: { resolve: async () => null },
      },
    ]);

    const [bought] = page(fixture).settlementsOf('line-bread');
    expect(bought.by).toBe('11111111-1111-4111-8111-111111111111');
    expect(bought.paid).toContain('1.29');
  });

  /**
   * Admin plan 0045, target 3: the shop of a settlement links to the shop's
   * page of admin plan 0042, which is under its chain. The shop is read for
   * its name, and the same read says which chain it is in.
   */
  it('links the shop of a settlement to its page under its chain', async () => {
    const fixture = await boot(SATURDAY, [], [CHAINS_SECTION]);

    const [bought] = page(fixture).settlementsOf('line-bread');
    expect(bought.shop).toBe('Calle Cruz Conde 4');
    expect(bought.shopPath).toEqual([
      '/',
      'chains',
      'chain-1',
      'shops',
      'loc_cordoba_centro',
    ]);
    expect(find(fixture, 'a[data-shop]')?.getAttribute('href')).toBe(
      '/chains/chain-1/shops/loc_cordoba_centro'
    );
  });

  it('says a row nobody settled has not been', async () => {
    const fixture = await boot(SATURDAY);

    expect(page(fixture).settlementsOf('line-unknown')).toEqual([]);
  });
});

describe('a settlement off the wire', () => {
  it('turns cents into an amount and keeps "no price" as null', () => {
    expect(
      toBasketSettlement({ id: 's', outcome: 'BOUGHT', pricePaidCents: 129 })
    ).toMatchObject({ paid: 1.29, outcome: 'BOUGHT' });
    expect(
      toBasketSettlement({ id: 's', outcome: 'BOUGHT', pricePaidCents: null })
    ).toMatchObject({ paid: null });
  });

  it('reads an outcome it does not know as unknown, and drops a row with no id', () => {
    expect(toBasketSettlement({ id: 's', outcome: 'LOST' })?.outcome).toBe(
      'UNKNOWN'
    );
    expect(basketSettlements([{ outcome: 'BOUGHT' }, 'nonsense'])).toEqual([]);
    expect(basketSettlements(undefined)).toEqual([]);
  });
});
