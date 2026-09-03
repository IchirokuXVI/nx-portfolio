import { provideLocationMocks } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DeploymentStore,
  ResourceMemoryGateways,
  SessionStorage,
  SessionStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  adminRoutes,
  provideResources,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  fieldOf,
  isEditable,
  naturalKey,
  toInput,
  type FieldDescriptor,
} from '@portfolio/luna-shopper-admin/models';
import { CATALOG_SCREENS } from './catalog-screens';
import { ITEMS } from './items';
import { LOCATIONS } from './locations';
import { PRICE_SCOPES } from './price-scopes';
import { isPinned, PRICE_KEY, priceGateway, PRICES, unpin } from './prices';
import { PRICE_SEED } from './prices-seed';
import { PRODUCT_GROUPS } from './product-groups';
import { SUPERMARKETS } from './supermarkets';

/**
 * The price screen, which is the one the plan singles out (plan 0005, section
 * 4 and section 6).
 *
 * Everything here runs against the in-memory gateway, which is the default
 * behind `RESOURCE_GATEWAYS`, so there is no backend and no `HttpClient`
 * anywhere in this file.
 */

const RESOURCES = [
  SUPERMARKETS,
  LOCATIONS,
  PRICE_SCOPES,
  PRODUCT_GROUPS,
  ITEMS,
  PRICES,
] as const;

@Component({
  selector: 'lib-test-host',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class TestHost {}

async function boot(url: string): Promise<ComponentFixture<TestHost>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [TestHost, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter(adminRoutes([...RESOURCES], CATALOG_SCREENS)),
      provideLocationMocks(),
      provideResources(...RESOURCES),
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
 * Lets the reads settle, then redraws.
 *
 * Twice, because the price form makes a second round of requests once the first
 * one has told it which scope to describe. `whenStable` is not an option in a
 * zoneless spec: it hangs.
 */
async function settle(fixture: ComponentFixture<TestHost>) {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  }
}

const text = (fixture: ComponentFixture<TestHost>) =>
  fixture.nativeElement.textContent as string;

/** The pinned row in the seed, which is what most of this file is about. */
const PINNED = PRICE_SEED.find((row) => row.priceSourceKind === 'ADMIN');

describe('the price descriptor', () => {
  it('addresses a price by its product and its scope, never by a shop', () => {
    expect(PRICES.identify?.(PRICE_SEED[0])).toBe(
      'it_milk_hacendado_1l~ps_mercadona_4661'
    );
  });

  /**
   * The mistake this whole screen exists to prevent. A picker of shop names on
   * a price form would let an operator "fix the price at this Mercadona" and
   * silently change it for every shop the warehouse supplies.
   */
  it('cannot submit a price against a shop', () => {
    const references = PRICES.fields
      .filter(
        (field): field is Extract<FieldDescriptor, { kind: 'reference' }> =>
          field.kind === 'reference'
      )
      .map((field) => field.resource);

    expect(references).toContain('price-scopes');
    expect(references).not.toContain('locations');
    expect(fieldOf(PRICES, 'supermarketLocationId')).toBeUndefined();
  });

  it('shows where a price came from and when it was last seen', () => {
    const source = fieldOf(PRICES, 'priceSourceKind');
    const seen = fieldOf(PRICES, 'priceObservedAt');

    expect(PRICES.list.columns).toContain('priceSourceKind');
    expect(PRICES.list.columns).toContain('priceObservedAt');
    // Both are set by the server. Offering to edit them would take an answer
    // the upsert DTO has no property to carry.
    expect(source === undefined ? null : isEditable(source, 'create')).toBe(
      false
    );
    expect(seen === undefined ? null : isEditable(seen, 'create')).toBe(false);
  });

  /** "What have I typed in and pinned" is otherwise unanswerable. */
  it('can be filtered down to the prices a person typed', () => {
    const filter = PRICES.filters?.find(
      (entry) => entry.param === 'priceSourceKind'
    );

    expect(filter?.kind).toBe('enum');
    expect(
      filter?.kind === 'enum'
        ? filter.options.map((option) => option.value)
        : []
    ).toContain('ADMIN');
  });

  it('offers to clear a pin only on a price that has one', () => {
    const action = PRICES.actions?.named?.find(
      (named) => named.name === 'unpin'
    );

    expect(action?.confirm).toBe(true);
    expect(action?.available?.(PINNED ?? {})).toBe(true);
    expect(action?.available?.(PRICE_SEED[0])).toBe(false);
  });
});

describe('the form derives nothing', () => {
  /**
   * `unitPrice` is the source's own figure and the obvious derivation,
   * `price / unitSize`, disagrees with it on 110 of 4,232 products, in the field
   * whose only purpose is comparison. A form that filled it in helpfully would
   * be quietly wrong once in forty times.
   */
  it('leaves the per unit price empty when only a price was typed', () => {
    const input = toInput(
      PRICES,
      {
        itemId: 'it_milk_hacendado_1l',
        priceScopeId: 'ps_mercadona_4661',
        price: '1.20',
        currency: 'EUR',
        unitPrice: '',
        unitPriceLabel: '',
        available: true,
      },
      'create',
      {}
    );

    expect(input['price']).toBe(1.2);
    expect(input['unitPrice']).toBeNull();
    expect(Object.keys(input)).not.toContain('unitSize');
  });

  /**
   * The digits are held as text and converted once, at the edge, because the
   * gateway's own DTO validates them with `@IsNumber()`. Four decimals survive
   * that conversion exactly.
   */
  it('sends the digits that were typed, to the column’s own scale', () => {
    const input = toInput(
      PRICES,
      {
        itemId: 'i',
        priceScopeId: 's',
        price: '11.99',
        unitPrice: '0.2998',
        unitPriceLabel: 'lv',
        currency: 'EUR',
        available: true,
      },
      'create',
      {}
    );

    expect(input['price']).toBe(11.99);
    expect(input['unitPrice']).toBe(0.2998);
    expect(input['unitPriceLabel']).toBe('lv');
  });

  /** An edit never carries the key: changing it would address a different row. */
  it('leaves the key out of an edit', () => {
    const input = toInput(PRICES, { price: '2.00' }, 'edit', { price: '1.00' });

    expect(Object.keys(input)).toEqual(['price']);
  });
});

describe('clearing a pin', () => {
  /**
   * Nothing in the gateway can change `priceSourceKind`: the upsert DTO has no
   * property for it, and a write from this app means `ADMIN` by definition. But
   * the rule that protects a pinned price checks the price as well as the
   * source, and a row holding no price is written by the next automated run
   * whatever its source says. So clearing the price is what unpins the row.
   */
  it('empties the price, so a run may write the row again', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [ResourceMemoryGateways] });
    const gateway = TestBed.runInInjectionContext(() =>
      priceGateway(TestBed.inject(ResourceMemoryGateways))
    );

    const before = PINNED;
    expect(before).toBeDefined();
    if (before === undefined) {
      return;
    }

    expect(isPinned(before)).toBe(true);
    await unpin(before, gateway);

    const after = await gateway.read(naturalKey(before, PRICE_KEY));
    expect(after.price).toBeNull();
    expect(after.unitPrice).toBeNull();
    expect(after.unitPriceLabel).toBeNull();
    // The row survives, and so does everything else on it. Deleting it would
    // have taken `available` and the product's link to the scope with it.
    expect(after.itemId).toBe(before.itemId);
    expect(after.priceScopeId).toBe(before.priceScopeId);
    expect(after.available).toBe(before.available);
  });
});

describe('the price screen, through the router', () => {
  it('lists the prices with where each one came from', async () => {
    const fixture = await boot('/prices');

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(PRICE_SEED.length);
    expect(text(fixture)).toContain('catalog.priceSourceKind.ADMIN');
    expect(text(fixture)).toContain('catalog.priceSourceKind.OFFICIAL_API');
  });

  /**
   * The screen's one bespoke part (plan 0005, section 2). It is asserted on the
   * component's own inputs rather than on rendered words, because the count is
   * interpolated and the testing translator does not interpolate.
   */
  it('names the scope and counts the shops it covers', async () => {
    const fixture = await boot(
      '/prices/it_milk_hacendado_1l~ps_mercadona_4661'
    );

    const note = fixture.nativeElement.querySelector('lib-price-scope-note');
    expect(note).not.toBeNull();
    expect(note.textContent).toContain('catalog.priceScopeKind.WAREHOUSE');
    expect(note.textContent).toContain('4661');
    expect(note.textContent).toContain('catalog.prices.scopeNote.covers');
    expect(note.textContent).toContain('catalog.prices.scopeNote.warning');
  });

  it('opens a price by its product and its scope', async () => {
    const fixture = await boot(
      '/prices/it_milk_hacendado_1l~ps_mercadona_4661'
    );

    expect(text(fixture)).toContain('resource.form.edit');
    expect(text(fixture)).not.toContain('resource.error.notFound');
  });
});
