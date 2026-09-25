import { provideLocationMocks } from '@angular/common/testing';
import { Component, type Provider } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DeploymentStore,
  GatewayError,
  HARVEST_SERVICE,
  HarvestMemory,
  RESOURCE_GATEWAYS,
  ResourceMemoryGateways,
  ServerReachability,
  SessionStorage,
  SessionStore,
  type HarvestServiceI,
  type ResourceGatewaysI,
  type ResourceSource,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  adminRoutes,
  provideResources,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type {
  ResourceGateway,
  ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { ITEM_SCOPE_PRICES_PATH } from './catalog-sources';
import { ItemFormPage } from './item-form-page';
import { ItemPricesPage, toShownBecause } from './item-prices-page';
import { toItemSourceEntryRow } from './item-source-entries';
import { ITEMS } from './items';
import { LOCATIONS } from './locations';
import { PriceFormPage } from './price-form-page';
import { PRICE_SCOPES } from './price-scopes';
import { PRICES } from './prices';
import { catalogRoutes } from './routes';
import { SUPERMARKETS } from './supermarkets';

/**
 * The screens admin plan 0033 adds to the catalog, against the in memory
 * gateways: one product at every scope, the source products panel on the
 * product screen, and the add a price form's proposal and date window.
 *
 * Each panel is also made to fail on its own, because that is the rule the plan
 * sets: an error in one read never blanks the screen around it.
 */

@Component({
  selector: 'lib-test-host',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class TestHost {}

const ALL = [SUPERMARKETS, LOCATIONS, PRICE_SCOPES, ITEMS, PRICES];

const SECTION: AdminSection = {
  key: 'catalog',
  label: '',
  resources: ALL,
  screens: catalogRoutes(),
};

/** A 503, which is what a service that is not answering reads as. */
function unavailable(): GatewayError {
  return new GatewayError({
    status: 503,
    code: 'service_unavailable',
    correlationId: 'cid',
  });
}

/** The memory gateways, with the all scopes read failing. */
function failingScopes(): ResourceGatewaysI {
  const memory = new ResourceMemoryGateways();
  return {
    for: <T extends ResourceRow>(source: ResourceSource<T>) => {
      if (source.path !== ITEM_SCOPE_PRICES_PATH) {
        return memory.for(source);
      }
      const failing = {
        list: async () => {
          throw unavailable();
        },
      };
      return failing as unknown as ResourceGateway<T>;
    },
  };
}

async function boot(url: string, providers: Provider[] = []) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [TestHost, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      provideRouter(adminRoutes([SECTION])),
      provideLocationMocks(),
      provideResources(...ALL),
      SessionStorage,
      SessionStore,
      DeploymentStore,
      ...providers,
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(TestHost);
  fixture.detectChanges();

  await TestBed.inject(Router).navigateByUrl(url);
  await settle(fixture);
  await settle(fixture);

  return fixture;
}

async function settle(fixture: ComponentFixture<TestHost>) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

const text = (fixture: ComponentFixture<TestHost>) =>
  fixture.nativeElement.textContent as string;

const buttonSaying = (
  fixture: ComponentFixture<TestHost>,
  label: string
): HTMLButtonElement | undefined =>
  [...fixture.nativeElement.querySelectorAll('button')].find(
    (button) => (button as HTMLButtonElement).textContent?.trim() === label
  ) as HTMLButtonElement | undefined;

describe('one product at every scope', () => {
  it('is mounted beside the product, not inside it', async () => {
    const fixture = await boot('/items/it_olive_oil_1l/prices');

    expect(
      fixture.debugElement.query(By.directive(ItemPricesPage))
    ).not.toBeNull();
  });

  it('lists each scope with its rows, the shown one marked, and why', async () => {
    const fixture = await boot('/items/it_olive_oil_1l/prices');
    const page = fixture.debugElement.query(By.directive(ItemPricesPage))
      .componentInstance as ItemPricesPage;

    const [scope] = page.scopes();
    expect(scope.name).toBe('Córdoba warehouse');
    expect(scope.rows.map((row) => row.shown)).toEqual([true, false]);
    expect(scope.shownBecause).toBe('PROTECTED_ADMIN');
    expect(text(fixture)).toContain(
      'catalog.prices.byItem.because.PROTECTED_ADMIN'
    );
    expect(text(fixture)).toContain('catalog.prices.history.shown');
  });

  it('draws the protection end as a date, and says it has passed', async () => {
    const fixture = await boot('/items/it_olive_oil_1l/prices');
    const page = fixture.debugElement.query(By.directive(ItemPricesPage))
      .componentInstance as ItemPricesPage;

    const [scope] = page.scopes();
    // 2026-09-10, which the seed fixed and which is behind any clock this
    // spec runs on, so the sentence is the ended one.
    expect(scope.protectedUntil).not.toBe('');
    expect(scope.protecting).toBe(false);
    expect(text(fixture)).toContain('catalog.prices.byItem.protectionEnded');
  });

  it('draws every scope of a product priced at two', async () => {
    const fixture = await boot('/items/it_milk_1l/prices');
    const page = fixture.debugElement.query(By.directive(ItemPricesPage))
      .componentInstance as ItemPricesPage;

    expect(page.scopes().map((scope) => scope.shownBecause)).toEqual([
      'ONLY_ROW',
      'ONLY_ROW',
    ]);
    expect(page.scopes().some((scope) => scope.stale)).toBe(true);
  });

  it('links each scope to its history, where a price is added', async () => {
    const fixture = await boot('/items/it_olive_oil_1l/prices');
    const page = fixture.debugElement.query(By.directive(ItemPricesPage))
      .componentInstance as ItemPricesPage;

    const [scope] = page.scopes();
    expect(scope.historyLink?.slice(0, 2)).toEqual(['/', 'prices']);
  });

  it('says so for a product no scope prices', async () => {
    const fixture = await boot('/items/it_dish_soap/prices');

    expect(text(fixture)).toContain('catalog.prices.byItem.empty');
  });

  it('keeps its heading when the scopes cannot be read', async () => {
    const fixture = await boot('/items/it_olive_oil_1l/prices', [
      { provide: RESOURCE_GATEWAYS, useValue: failingScopes() },
    ]);

    const alert = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(text(fixture)).toContain('Extra virgin olive oil 1 L');
    expect(buttonSaying(fixture, 'resource.action.retry')).toBeDefined();
  });

  it('reads an unknown reason as unknown rather than as one of the four', () => {
    expect(toShownBecause('SOMETHING_NEW')).toBe('UNKNOWN');
    expect(toShownBecause(null)).toBeNull();
    expect(toShownBecause('NEWEST')).toBe('NEWEST');
  });
});

describe('the product screen', () => {
  it('is the generic form with the source products below it', async () => {
    const fixture = await boot('/items/it_milk_1l');

    expect(
      fixture.debugElement.query(By.directive(ItemFormPage))
    ).not.toBeNull();
    expect(text(fixture)).toContain('catalog.items.sources.heading');
    expect(text(fixture)).toContain('Leche entera Hacendado');
  });

  it('warns on a barcode more than one row of the chain lists', async () => {
    const fixture = await boot('/items/it_milk_1l');

    const chips = [
      ...fixture.nativeElement.querySelectorAll('.chip.shared'),
    ] as HTMLElement[];
    // The two Mercadona rows share one barcode; the DEZA row has none.
    expect(chips).toHaveLength(2);
    expect(chips[0].textContent).toContain('catalog.items.sources.sharedEan');
  });

  it('links to the product at every scope', async () => {
    const fixture = await boot('/items/it_milk_1l');
    const page = fixture.debugElement.query(By.directive(ItemFormPage))
      .componentInstance as ItemFormPage;

    expect(page.pricesLink()).toEqual(['/', 'items', 'it_milk_1l', 'prices']);
  });

  it('says so for a product nothing names', async () => {
    const fixture = await boot('/items/it_dish_soap');

    expect(text(fixture)).toContain('catalog.items.sources.empty');
  });

  it('draws neither panel on a product being created', async () => {
    const fixture = await boot('/items/new');

    expect(text(fixture)).not.toContain('catalog.items.sources.heading');
    expect(text(fixture)).not.toContain('catalog.items.pricesLink');
  });

  it('keeps the form when the harvester does not answer', async () => {
    const harvest = Object.assign(new HarvestMemory(), {
      listItemEntries: async () => {
        throw unavailable();
      },
    }) as HarvestServiceI;
    const fixture = await boot('/items/it_milk_1l', [
      { provide: HARVEST_SERVICE, useValue: harvest },
    ]);

    // The panel's own failure, with its own retry.
    expect(
      fixture.nativeElement.querySelector(
        'lib-item-source-entries [role="alert"]'
      )
    ).not.toBeNull();
    // And the form, drawn and filled in.
    expect(
      fixture.nativeElement.querySelector('lib-resource-form')
    ).not.toBeNull();
  });

  it('maps a source row from the wire and drops one with no id', () => {
    expect(toItemSourceEntryRow({ name: 'x' })).toBeNull();
    expect(
      toItemSourceEntryRow({
        id: 'e1',
        status: 'SOMETHING',
        matchedBy: 'SHARED_EAN',
        eanSharedBy: 1,
      })
    ).toMatchObject({
      status: 'UNRESOLVED',
      matchKey: 'catalog.items.sources.matchSharedEan',
      // One row is its own barcode, not a shared one.
      sharedBy: 0,
    });
  });
});

describe('the add a price form', () => {
  async function form() {
    const fixture = await boot('/prices/new?itemId=it_dish_soap');
    const page = fixture.debugElement.query(By.directive(PriceFormPage))
      .componentInstance as PriceFormPage;
    return { fixture, page };
  }

  it('proposes a unit price in the base unit, and fills nothing in', async () => {
    const { fixture, page } = await form();

    page.store.set('price', '1.50');
    await settle(fixture);

    // 750 ml at 1.50 is 2.00 a litre.
    expect(page.proposal()).toEqual({ unitPrice: '2.00', label: '1 L' });
    expect(page.store.draft()['unitPrice']).toBe('');
    expect(text(fixture)).toContain('catalog.prices.proposal.heading');
  });

  it('puts the proposal in the fields only when asked', async () => {
    const { fixture, page } = await form();

    page.store.set('price', '1.50');
    await settle(fixture);
    buttonSaying(fixture, 'catalog.prices.proposal.use')?.click();
    await settle(fixture);

    expect(page.store.draft()['unitPrice']).toBe('2.00');
    expect(page.store.draft()['unitPriceLabel']).toBe('1 L');
    expect(page.proposalInUse()).toBe(true);
  });

  it('proposes nothing without a price', async () => {
    const { page } = await form();

    expect(page.proposal()).toBeNull();
  });

  it('refuses an observed date in the future, under the field', async () => {
    const { fixture, page } = await form();
    const create = jest.spyOn(page.store, 'submit');

    page.store.set(
      'observedAt',
      new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    );
    await settle(fixture);
    await page.submit();

    expect(page.priceMessages()['observedAt']).toEqual([
      { kind: 'key', key: 'catalog.prices.observedAtFuture' },
    ]);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses one more than 30 days back', async () => {
    const { page } = await form();

    page.store.set(
      'observedAt',
      new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
    );

    expect(page.observedAtProblem()).toEqual({
      kind: 'key',
      key: 'catalog.prices.observedAtTooOld',
    });
  });

  it('takes one inside the window', async () => {
    const { page } = await form();

    page.store.set(
      'observedAt',
      new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    );

    expect(page.observedAtProblem()).toBeNull();
  });
});

describe('a price history', () => {
  it('opens the same product at every scope', async () => {
    const fixture = await boot('/prices/it_olive_oil_1l~ps_mercadona_4661');
    const router = TestBed.inject(Router);

    const button = buttonSaying(fixture, 'catalog.prices.byItem.open');
    expect(button).toBeDefined();
    button?.click();
    await settle(fixture);

    expect(router.url).toBe('/items/it_olive_oil_1l/prices');
  });
});
