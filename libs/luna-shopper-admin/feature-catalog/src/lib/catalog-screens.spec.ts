import { provideLocationMocks } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DeploymentStore,
  SessionStorage,
  SessionStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  adminRoutes,
  provideResources,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { ReferencePicker } from '@portfolio/luna-shopper-admin/ui';
import { ITEMS } from './items';
import { LOCATION_ITEMS } from './location-items';
import { LOCATIONS } from './locations';
import { PriceScopeNotice } from './price-scope-notice';
import { PRICE_SCOPES } from './price-scopes';
import { PRICES } from './prices';
import { PRODUCT_GROUPS } from './product-groups';
import { SUPERMARKETS } from './supermarkets';

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

const ALL = [
  SUPERMARKETS,
  LOCATIONS,
  PRICE_SCOPES,
  ITEMS,
  PRODUCT_GROUPS,
  PRICES,
  LOCATION_ITEMS,
];

async function boot(url: string) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [TestHost, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter(adminRoutes(ALL)),
      provideLocationMocks(),
      provideResources(...ALL),
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
  [...fixture.nativeElement.querySelectorAll('tbody tr, .card')]
    .map((row) => (row as HTMLElement).textContent ?? '')
    .join(' ') as string;

const buttonSaying = (
  fixture: ComponentFixture<TestHost>,
  label: string
): HTMLButtonElement | undefined =>
  [...fixture.nativeElement.querySelectorAll('button')].find(
    (button) => (button as HTMLButtonElement).textContent?.trim() === label
  ) as HTMLButtonElement | undefined;

/** Choose a value in one filter, the way its control would. */
async function chooseFilter(
  fixture: ComponentFixture<TestHost>,
  param: string,
  value: string
) {
  // `select#...` and not `#...`: a reference filter's own search box carries the
  // same id, so a bare id lookup finds a text input and setting its value does
  // nothing at all.
  const select = fixture.nativeElement.querySelector(
    `select#filter-${param}`
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
    .find((found) => found.componentInstance.controlId() === `filter-${param}`);

  picker?.componentInstance.valueChange.emit(value);
  await settle(fixture);
}

describe('the price list', () => {
  it('draws every price, whoever set it', async () => {
    const fixture = await boot('/prices');

    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(3);
  });

  /**
   * "What have I typed in and pinned." Section 4 is that this question is
   * currently unanswerable anywhere else, because the confirmation queue that
   * would have surfaced a disagreement does not exist.
   */
  it('narrows to the prices somebody typed in', async () => {
    const fixture = await boot('/prices');

    await chooseFilter(fixture, 'priceSourceKind', 'ADMIN');

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rowsText(fixture)).not.toContain(
      'catalog.priceSourceKind.OFFICIAL_API'
    );
  });

  /** So a stale price is recognisable as stale rather than merely as a number. */
  it('shows when each price was last seen', async () => {
    const fixture = await boot('/prices');

    const headers = [...fixture.nativeElement.querySelectorAll('thead th')].map(
      (cell) => (cell as HTMLElement).textContent?.trim()
    );

    expect(headers).toContain('catalog.prices.priceSourceKind');
    expect(headers).toContain('catalog.prices.priceObservedAt');
  });
});

describe('reverting a pinned price', () => {
  /**
   * Nothing in the gateway sets `priceSourceKind` back: the upsert DTO has no
   * such property. What lifts the pin is the **price** going null, because
   * `decidePriceWrite` writes over any row that has no price whatever its source
   * kind says. So this asserts the price is gone, which is the thing that
   * matters, rather than a label that has not moved.
   */
  it('clears the typed price, and asks before it does', async () => {
    const fixture = await boot('/prices');
    await chooseFilter(fixture, 'priceSourceKind', 'ADMIN');

    buttonSaying(fixture, 'catalog.prices.action.revert')?.click();
    await settle(fixture);

    expect(text(fixture)).toContain('catalog.prices.confirm.revert.heading');

    buttonSaying(fixture, 'catalog.prices.confirm.revert.confirm')?.click();
    await settle(fixture);
    await settle(fixture);

    // The row is still there and its price is not. A row with no price is one
    // an automated run may write again.
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rowsText(fixture)).not.toContain('8.45');
  });

  /** A harvested price is not pinned, so there is nothing to revert. */
  it('is not offered on a price an automated source set', async () => {
    const fixture = await boot('/prices');
    await chooseFilter(fixture, 'priceSourceKind', 'OFFICIAL_API');

    expect(
      buttonSaying(fixture, 'catalog.prices.action.revert')
    ).toBeUndefined();
  });
});

describe('the price form', () => {
  /**
   * Section 2, and the whole reason this screen is not a plain descriptor. A
   * price is keyed on `(itemId, priceScopeId)`, and twelve shops served by one
   * warehouse share one row, so the screen has to say which scope and how many
   * shops that is.
   *
   * The assertion is on the notice's inputs rather than on its text, because
   * every sentence it draws interpolates and the testing translator does not.
   */
  it('names the scope, its kind, and how many shops it covers', async () => {
    const fixture = await boot('/prices/it_milk_1l~ps_mercadona_4661');
    await settle(fixture);
    await settle(fixture);

    const notice = fixture.debugElement.query(By.directive(PriceScopeNotice));
    expect(notice).not.toBeNull();

    const inputs = notice.componentInstance as PriceScopeNotice;
    expect(inputs.scopeName()).toBe('Córdoba warehouse');
    expect(inputs.kindLabel()).toBe('catalog.priceScopeKind.WAREHOUSE');
    // Two shops in the seed price against warehouse 4661.
    expect(inputs.locationCount()).toBe(2);
    expect(inputs.atLeast()).toBe(false);
  });

  /**
   * There is no control on this screen a shop could be chosen in, and that is
   * the descriptor's doing rather than a check inside the form: `priceScopeId`
   * is a reference to `price-scopes`.
   */
  it('offers scopes to choose from, and never shops', async () => {
    const fixture = await boot('/prices/new');

    const resources = fixture.debugElement
      .queryAll(By.directive(ReferencePicker))
      .map((found) => found.componentInstance.resource() as string);

    expect(resources).toContain('price-scopes');
    expect(resources).not.toContain('locations');
  });

  /** The pair is what the row *is*, so it is settable once and then shown. */
  it('does not offer to move an existing price to another scope', async () => {
    const fixture = await boot('/prices/it_milk_1l~ps_mercadona_4661');
    await settle(fixture);

    const resources = fixture.debugElement
      .queryAll(By.directive(ReferencePicker))
      .map((found) => found.componentInstance.resource() as string);

    expect(resources).not.toContain('price-scopes');
    expect(resources).not.toContain('items');
  });
});

describe('the shops list', () => {
  /**
   * A third state beside empty and no match. "There are no shops" and "you have
   * not said whose shops" are different sentences, and drawing the first would
   * be a claim nothing had checked.
   */
  it('says which filter it is waiting for before it reads anything', async () => {
    const fixture = await boot('/locations');

    expect(text(fixture)).toContain('resource.list.blocked');
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(0);
    expect(text(fixture)).not.toContain('resource.list.empty');
  });

  it('draws one chain’s shops once the chain is named', async () => {
    const fixture = await boot('/locations');

    await chooseFilter(fixture, 'supermarketId', 'sm_mercadona');

    expect(text(fixture)).not.toContain('resource.list.blocked');
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(3);
  });

  /**
   * Section 3: three states, kept apart. A guess is a guess, a known code is
   * known, and a shop with neither is deliberate rather than missing.
   */
  it('tells a known postal code from a guess and from none at all', async () => {
    const fixture = await boot('/locations');
    await chooseFilter(fixture, 'supermarketId', 'sm_mercadona');

    const body = rowsText(fixture);
    expect(body).toContain('catalog.postalCodeSource.SOURCE');
    expect(body).toContain('catalog.postalCodeSource.DERIVED');
    // The shop with no code at all reads as nothing, not as a guess to check.
    expect(body).toContain('resource.value.none');
  });

  it('narrows to the guessed ones', async () => {
    const fixture = await boot('/locations');
    await chooseFilter(fixture, 'supermarketId', 'sm_mercadona');
    await chooseFilter(fixture, 'postalCodeSource', 'DERIVED');

    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(rowsText(fixture)).toContain('14005');
  });
});

describe('the per shop rows', () => {
  it('waits to be told which shop, like the shops wait for a chain', async () => {
    const fixture = await boot('/location-items');

    expect(text(fixture)).toContain('resource.list.blocked');
  });

  it('offers no delete, because the gateway has no route for one', async () => {
    const fixture = await boot('/location-items');
    await chooseFilter(fixture, 'supermarketLocationId', 'loc_cordoba_centro');

    expect(buttonSaying(fixture, 'resource.action.delete')).toBeUndefined();
  });
});
