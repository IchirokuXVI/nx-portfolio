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
  ResourceListPage,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  CONTENT_LOCALES,
  toCell,
  toInput,
  type FieldDescriptor,
} from '@portfolio/luna-shopper-admin/models';
import { LOCATIONS, type SupermarketLocation } from './locations';
import { LOCATION_SEED } from './locations-seed';
import { PRICE_SCOPES } from './price-scopes';
import { SUPERMARKETS } from './supermarkets';

/**
 * The shops, and the postal code that was guessed (plan 0005, section 3).
 *
 * The screen's whole job is to keep three states of a postal code apart, and to
 * refuse to pretend it can list shops across chains. Both are asserted here.
 */

const RESOURCES = [SUPERMARKETS, LOCATIONS, PRICE_SCOPES] as const;

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
      provideRouter(adminRoutes([...RESOURCES])),
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

async function settle(fixture: ComponentFixture<TestHost>) {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  }
}

const text = (fixture: ComponentFixture<TestHost>) =>
  fixture.nativeElement.textContent as string;

const RENDER = { locale: 'en', contentLocales: CONTENT_LOCALES };

/** The postal code source field, which the three states are read through. */
const SOURCE_FIELD = LOCATIONS.fields.find(
  (field) => field.name === 'postalCodeSource'
) as FieldDescriptor;

/** One seeded shop, by id. */
function shop(id: string): SupermarketLocation {
  const found = LOCATION_SEED.find((row) => row.id === id);
  if (found === undefined) {
    throw new Error(`no seeded shop ${id}`);
  }
  return found;
}

describe('the three states of a postal code', () => {
  /**
   * A code the shop published, a code a person typed, and a code inferred from
   * the nearest centroid are three different claims, and only one of them needs
   * reviewing. Collapsing them would make the review filter meaningless.
   */
  it('tells a published code from a guessed one', () => {
    expect(
      toCell(SOURCE_FIELD, shop('loc_mercadona_cordoba_centro'), RENDER)
    ).toEqual({ text: '', key: 'catalog.postalCodeSource.SOURCE' });

    expect(
      toCell(SOURCE_FIELD, shop('loc_mercadona_cordoba_sur'), RENDER)
    ).toEqual({ text: '', key: 'catalog.postalCodeSource.DERIVED' });

    expect(
      toCell(SOURCE_FIELD, shop('loc_mercadona_madrid_chamberi'), RENDER)
    ).toEqual({ text: '', key: 'catalog.postalCodeSource.MANUAL' });
  });

  /**
   * A shop with no postal code has no source either, and that is deliberate: a
   * wrong postcode is worse than none. It is a fourth answer rather than a
   * missing value, and it matches no value of the filter.
   */
  it('draws an unknown code as nothing rather than as a guess', () => {
    const unknown = shop('loc_bonpreu_bcn_gracia');

    expect(unknown.postalCode).toBeNull();
    expect(toCell(SOURCE_FIELD, unknown, RENDER)).toEqual({
      text: '',
      key: 'resource.value.none',
    });
  });

  it('lists the guessed addresses on their own', () => {
    const filter = LOCATIONS.filters?.find(
      (entry) => entry.param === 'postalCodeSource'
    );

    expect(filter?.kind).toBe('enum');
    expect(
      filter?.kind === 'enum' ? filter.options.map((o) => o.value) : []
    ).toEqual(['SOURCE', 'DERIVED', 'MANUAL']);
  });
});

describe('a localized name', () => {
  /**
   * The form renders one input per content locale, and submits the whole object
   * whether or not both were touched. Sending only the language that changed
   * would drop the other one from a `jsonb` column that is replaced wholesale.
   */
  it('submits every locale, including the untouched one', () => {
    const input = toInput(
      LOCATIONS,
      {
        supermarketId: 'sm_bonpreu',
        label: { en: 'Gràcia', es: '' },
        address: 'Carrer Gran de Gràcia 100',
      },
      'create',
      {}
    );

    expect(input['label']).toEqual({ en: 'Gràcia', es: '' });
    expect(Object.keys(input['label'] as object)).toEqual(CONTENT_LOCALES);
  });
});

describe('the shop list through the router', () => {
  /**
   * There is no route that lists shops across chains, so the screen says which
   * choice is missing rather than showing an error it caused itself by asking
   * anyway.
   */
  it('asks for a chain before it reads anything', async () => {
    const fixture = await boot('/locations');

    expect(text(fixture)).toContain('resource.list.blocked');
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(0);
    // Not "there is nothing here": there may be thousands, and nothing has
    // asked for them.
    expect(text(fixture)).not.toContain('resource.list.empty');
  });

  it('reads one chain’s shops once the chain is chosen', async () => {
    const fixture = await boot('/locations');
    const page: ResourceListPage = fixture.debugElement.query(
      By.directive(ResourceListPage)
    ).componentInstance;

    await page.store.setFilter('supermarketId', 'sm_mercadona');
    await settle(fixture);

    const mercadona = LOCATION_SEED.filter(
      (row) => row.supermarketId === 'sm_mercadona'
    );
    expect(page.store.rows()).toHaveLength(mercadona.length);
    expect(text(fixture)).toContain('Avenida del Gran Capitán 12');
    expect(text(fixture)).not.toContain('Carrer Gran de Gràcia 100');
  });
});
