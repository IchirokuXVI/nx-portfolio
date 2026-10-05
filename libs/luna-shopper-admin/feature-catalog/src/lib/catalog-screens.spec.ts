import { provideLocationMocks } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DeploymentStore,
  ResourceMemoryGateways,
  ServerReachability,
  SessionStorage,
  SessionStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  adminRoutes,
  provideSections,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type {
  ResourceGateway,
  ResourceInput,
  ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import {
  ReferencePicker,
  ReferencesControl,
} from '@portfolio/luna-shopper-admin/ui';
import { CHAIN_RESOURCES, chainsRoutes } from './chains/chains-routes';
import {
  PRODUCT_RESOURCES,
  PRODUCTS_SEGMENT,
  productsRoutes,
} from './products/products-routes';

/**
 * The catalog screens, rendered (plan 0005, section 6).
 *
 * Everything runs against the in-memory gateway, which is the default behind
 * `RESOURCE_GATEWAYS`, so there is no backend and no `HttpClient` in this file.
 * The seed is the catalog's own, so the rows a screen draws are the rows
 * `catalog-seed.ts` describes.
 *
 * Assertions are on keys and on component inputs rather than on sentences
 * wherever a string is interpolated, because the testing translator does not
 * interpolate: `{{count}}` never becomes a number, so a spec that read the
 * rendered text would be asserting on the key and calling it a count.
 */

@Component({
  selector: 'lib-test-host',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class TestHost {}

/**
 * The two sections these screens live in.
 *
 * **The chains are the real thing** (admin plan 0042): the five resources a
 * chain holds are named as `held` and mounted by `chainsRoutes()`, so a shop
 * is drawn where the app draws it, under its chain, and never as a flat list
 * this spec made up.
 *
 * **The products are the real thing as well** (admin plan 0043). A shop's
 * product row names its product through the registry, so the product has to
 * be where the app mounts it. The product screens have a spec of their own
 * beside them, under `products/`.
 */
const SECTIONS: readonly AdminSection[] = [
  {
    key: 'chains',
    label: '',
    held: CHAIN_RESOURCES,
    screens: chainsRoutes(),
  },
  {
    key: 'products',
    label: '',
    segment: PRODUCTS_SEGMENT,
    held: PRODUCT_RESOURCES,
    heldTabs: true,
    screens: productsRoutes(),
  },
];

/** The chain and the shop most of the cases below stand on. */
const MERCADONA_SHOPS = '/chains/sm_mercadona/shops';
const CENTRO = `${MERCADONA_SHOPS}/loc_cordoba_centro`;

async function boot(url: string) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [TestHost, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      provideRouter(adminRoutes(SECTIONS)),
      provideLocationMocks(),
      provideSections(...SECTIONS),
      SessionStorage,
      SessionStore,
      DeploymentStore,
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(TestHost);
  fixture.detectChanges();

  await TestBed.inject(Router).navigateByUrl(url);
  await settle(fixture);

  return fixture;
}

/**
 * Lets a read settle, then redraws.
 *
 * A macrotask rather than a handful of `Promise.resolve()`s, because a read goes
 * through several awaits and counting them would make this spec depend on how
 * many. `whenStable` is not an option in a zoneless spec: it hangs.
 */
async function settle(fixture: ComponentFixture<TestHost>) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

const text = (fixture: ComponentFixture<TestHost>) =>
  fixture.nativeElement.textContent as string;

/**
 * What the **rows** say, which is not what the screen says.
 *
 * A filter draws every value it offers as an option, so the whole screen's text
 * contains `catalog.postalCodeSource.DERIVED` whether or not a single row is a
 * guess. Asserting on that would pass with an empty table.
 */
const rowsText = (fixture: ComponentFixture<TestHost>) =>
  [...fixture.nativeElement.querySelectorAll('tbody tr, .card, [data-row]')]
    .map((row) => (row as HTMLElement).textContent ?? '')
    .join(' ') as string;

const buttonSaying = (
  fixture: ComponentFixture<TestHost>,
  label: string
): HTMLButtonElement | undefined =>
  [...fixture.nativeElement.querySelectorAll('button')].find(
    (button) => (button as HTMLButtonElement).textContent?.trim() === label
  ) as HTMLButtonElement | undefined;

/**
 * The id of one filter's control.
 *
 * A list that is part of a larger page names its resource in the id, because
 * two lists can be on screen at once: the chains are a column beside the
 * shops, and both have a search called `query`. A list that is the whole page
 * has no such neighbour and keeps the short id.
 */
function filterId(param: string, resource?: string): string {
  return resource === undefined
    ? `filter-${param}`
    : `filter-${resource}-${param}`;
}

/** Any control, of any list, that filters by this parameter. */
const anyFilterFor = (fixture: ComponentFixture<TestHost>, param: string) =>
  fixture.nativeElement.querySelector(
    `[id^="filter-"][id$="${param}"]`
  ) as HTMLElement | null;

/** Choose a value in one filter, the way its control would. */
async function chooseFilter(
  fixture: ComponentFixture<TestHost>,
  param: string,
  value: string,
  resource?: string
) {
  // `select#...` and not `#...`: a reference filter's own search box carries the
  // same id, so a bare id lookup finds a text input and setting its value does
  // nothing at all.
  const select = fixture.nativeElement.querySelector(
    `select#${filterId(param, resource)}`
  ) as HTMLSelectElement | null;

  if (select !== null) {
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await settle(fixture);
    return;
  }

  // A reference filter is a searching picker rather than a select, and driving
  // its debounce here would be testing the picker instead of the screen.
  const picker = fixture.debugElement
    .queryAll(By.directive(ReferencePicker))
    .find(
      (found) =>
        found.componentInstance.controlId() === filterId(param, resource)
    );

  picker?.componentInstance.valueChange.emit(value);
  await settle(fixture);
}

/**
 * The Price scopes tab of a chain (admin plan 0042, target 7).
 *
 * The list used to name its chain in a column, by lookup. The chain is the
 * page the list is a tab of now, so the column is gone and so is the request
 * that named it.
 */
describe('the price scopes of a chain', () => {
  it('lists that chain’s scopes and no other chain’s', async () => {
    const fixture = await boot('/chains/sm_consum/scopes');
    await settle(fixture);

    // Consum has one scope in the seed, and Mercadona has six.
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(rowsText(fixture)).toContain('loc_consum_centro');
    expect(rowsText(fixture)).not.toContain('4661');
  });

  it('draws no column and no filter for the chain the address names', async () => {
    const fixture = await boot('/chains/sm_mercadona/scopes');
    await settle(fixture);

    const headers = [...fixture.nativeElement.querySelectorAll('thead th')].map(
      (cell) => (cell as HTMLElement).textContent?.trim()
    );
    expect(headers).not.toContain('catalog.priceScopes.supermarketId');
    expect(anyFilterFor(fixture, 'supermarketId')).toBeNull();
    expect(rowsText(fixture)).not.toContain('sm_mercadona');
    // The one filter it keeps is the kind.
    expect(
      fixture.nativeElement.querySelector(
        `select#${filterId('kind', 'price-scopes')}`
      )
    ).not.toBeNull();
  });
});

/**
 * The Shops tab of a chain (admin plan 0042, target 4).
 *
 * The list is the column beside the open shop, so a shop is one row of a few
 * words: its address, its town and postal code, and its states.
 */
describe('the shops of a chain', () => {
  /**
   * The chain's page, which holds the shops.
   *
   * Every query below starts here, because the chains are a column of the
   * same kind of rows beside it: hidden on a narrow screen, and never removed.
   */
  const page = (fixture: ComponentFixture<TestHost>) =>
    fixture.nativeElement.querySelector('lib-chain-page') as HTMLElement;

  const rowsOf = (fixture: ComponentFixture<TestHost>) =>
    [...page(fixture).querySelectorAll('[data-row]')] as HTMLElement[];

  const shopsText = (fixture: ComponentFixture<TestHost>) =>
    rowsOf(fixture)
      .map((row) => row.textContent ?? '')
      .join(' ');

  /** A column keeps its search in view and the other filters under a button. */
  async function openFilters(fixture: ComponentFixture<TestHost>) {
    (
      page(fixture).querySelector('[data-more-filters]') as HTMLButtonElement
    ).click();
    await settle(fixture);
  }

  /** The chain is the address, so the list reads at once. */
  it('reads the chain’s shops from the address, with nothing to choose first', async () => {
    const fixture = await boot(MERCADONA_SHOPS);

    expect(text(fixture)).not.toContain('resource.list.empty');
    expect(rowsOf(fixture)).toHaveLength(3);
  });

  it('lists that chain’s shops only', async () => {
    const mercadona = await boot(MERCADONA_SHOPS);
    expect(shopsText(mercadona)).toContain('Avenida del Gran Capitán 12');
    expect(shopsText(mercadona)).not.toContain('Consum Centro');

    const consum = await boot('/chains/sm_consum/shops');
    expect(rowsOf(consum)).toHaveLength(1);
    expect(shopsText(consum)).toContain('Consum Centro');
  });

  it('offers no control for the chain, and keeps its other filters', async () => {
    const fixture = await boot(MERCADONA_SHOPS);
    await openFilters(fixture);

    expect(anyFilterFor(fixture, 'supermarketId')).toBeNull();
    // The search by address, city or postal code, the postal code source and
    // the price scope (admin plan 0042, target 4).
    expect(
      page(fixture).querySelector(`#${filterId('query', 'locations')}`)
    ).not.toBeNull();
    expect(
      page(fixture).querySelector(
        `select#${filterId('postalCodeSource', 'locations')}`
      )
    ).not.toBeNull();
    expect(
      fixture.debugElement
        .queryAll(By.directive(ReferencePicker))
        .map((found) => found.componentInstance.controlId() as string)
    ).toEqual([filterId('priceScopeId', 'locations')]);
  });

  /**
   * The chains are a column beside the shops, and both lists have a search
   * called `query`. A label points at its control by id, so two controls with
   * one id would leave one of them unlabelled.
   */
  it('shares no control id with the column of chains beside it', async () => {
    const fixture = await boot(MERCADONA_SHOPS);
    await openFilters(fixture);

    const ids = [...fixture.nativeElement.querySelectorAll('[id]')].map(
      (element) => (element as HTMLElement).id
    );

    expect(ids).toContain(filterId('query', 'supermarkets'));
    expect(ids).toContain(filterId('query', 'locations'));
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });

  /**
   * Section 3 of plan 0005, as a column of rows says it: the town and the
   * postal code under the address, and a state on the one code that is a
   * guess. A shop with no code at all says nothing where the code would be
   * and carries no state, because a missing code is deliberate and not a
   * guess to go and check.
   */
  it('tells a known postal code from a guess and from none at all', async () => {
    const fixture = await boot(MERCADONA_SHOPS);

    const row = (address: string) =>
      rowsOf(fixture).find((found) => found.textContent?.includes(address))
        ?.textContent ?? '';
    const guessed = 'catalog.locations.state.postalCodeGuessed';

    expect(row('Gran Capitán')).toContain('14001');
    expect(row('Gran Capitán')).not.toContain(guessed);
    expect(row('Domínguez Ortiz')).toContain('14005');
    expect(row('Domínguez Ortiz')).toContain(guessed);
    expect(row('Trassierra')).not.toContain(guessed);
    expect(row('Trassierra')).not.toContain('resource.value.none');
  });

  it('marks the one shop that has a map', async () => {
    const fixture = await boot(MERCADONA_SHOPS);

    const marked = rowsOf(fixture).filter((row) =>
      row.textContent?.includes('catalog.locations.state.map')
    );

    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toContain('Gran Capitán');
  });

  it('narrows to the guessed ones', async () => {
    const fixture = await boot(MERCADONA_SHOPS);
    await openFilters(fixture);
    await chooseFilter(fixture, 'postalCodeSource', 'DERIVED', 'locations');

    expect(rowsOf(fixture)).toHaveLength(1);
    expect(shopsText(fixture)).toContain('14005');
    // The button that holds the filters says how many are narrowing the list.
    expect(
      page(fixture).querySelector('[data-more-filters] .filter-count')
        ?.textContent
    ).toBe('1');
  });

  it('opens a shop under its chain, on its details', async () => {
    const fixture = await boot(MERCADONA_SHOPS);

    rowsOf(fixture)
      .find((row) => row.textContent?.includes('Gran Capitán'))
      ?.click();
    await settle(fixture);
    await settle(fixture);

    expect(TestBed.inject(Router).url).toBe(`${CENTRO}/details`);
  });
});

/**
 * A shop's stack of price scopes, edited whole (admin plan 0028, section 7).
 */
describe('the shop price scopes', () => {
  /** What the shop gateway was asked to write, by the form's submit. */
  function recordUpdates(): ResourceInput[] {
    const sent: ResourceInput[] = [];
    const original = ResourceMemoryGateways.prototype.for;
    jest
      .spyOn(ResourceMemoryGateways.prototype, 'for')
      .mockImplementation(function <T extends ResourceRow>(
        this: ResourceMemoryGateways,
        source: Parameters<ResourceMemoryGateways['for']>[0]
      ): ResourceGateway<T> {
        const gateway = original.call(this, source) as ResourceGateway<T>;
        if (source.path.endsWith('/locations')) {
          const update = gateway.update.bind(gateway);
          gateway.update = (id, input) => {
            sent.push(input);
            return update(id, input);
          };
        }
        return gateway;
      });
    return sent;
  }

  afterEach(() => jest.restoreAllMocks());

  /**
   * The list is a column of addresses now, so the scopes are named where the
   * shop is open: on its Details tab, as the chips of the field.
   */
  it('names the shop’s scopes on its Details tab', async () => {
    const fixture = await boot(`${CENTRO}/details`);
    await settle(fixture);
    await settle(fixture);

    const control = fixture.debugElement.query(By.directive(ReferencesControl));
    const chips = control.nativeElement.textContent as string;
    expect(chips).toContain('Córdoba warehouse');
    expect(chips).not.toContain('ps_mercadona_4661');
  });

  it('keeps the store scope when a region is removed, and sends the stack whole', async () => {
    const sent = recordUpdates();
    const fixture = await boot(`${CENTRO}/details`);
    await settle(fixture);

    const control = fixture.debugElement.query(By.directive(ReferencesControl));
    const chips = [
      ...control.nativeElement.querySelectorAll('li.chip'),
    ] as HTMLElement[];
    expect(chips).toHaveLength(2);

    // The shop's own store scope is locked; the warehouse is not.
    const [store, region] = chips;
    expect(store.querySelector('button')).toBeNull();
    region.querySelector('button')?.click();
    await settle(fixture);

    buttonSaying(fixture, 'resource.action.save')?.click();
    await settle(fixture);

    expect(sent).toEqual([{ priceScopeIds: ['ps_store_loc_cordoba_centro'] }]);
  });
});

/**
 * The Products tab of a shop (admin plan 0042, target 5).
 *
 * The rows used to wait to be told which shop, the way the shops waited for a
 * chain. The shop is the address now.
 */
describe('the products of a shop', () => {
  it('reads the shop’s rows from the address, with nothing to choose first', async () => {
    const fixture = await boot(`${CENTRO}/products`);
    await settle(fixture);

    // The seed holds two rows for this shop and one for another.
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(anyFilterFor(fixture, 'supermarketLocationId')).toBeNull();
  });

  it('names the product and its brand, and never prints the id', async () => {
    const fixture = await boot(`${CENTRO}/products`);
    await settle(fixture);

    expect(rowsText(fixture)).toContain('Whole milk 1 L');
    expect(rowsText(fixture)).toContain('Hacendado');
    expect(rowsText(fixture)).not.toContain('it_milk_1l');
  });

  it('offers no delete, because the gateway has no route for one', async () => {
    const fixture = await boot(`${CENTRO}/products`);
    await settle(fixture);

    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(buttonSaying(fixture, 'resource.action.delete')).toBeUndefined();
  });
});
