import { provideLocationMocks } from '@angular/common/testing';
import { Component, inject } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DeploymentStore,
  RESOURCE_GATEWAYS,
  ServerReachability,
  SessionStorage,
  SessionStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  adminRoutes,
  provideResources,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  defineResource,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { BRANDS } from './brands';
import { BrandsGateway } from './brands-gateway';

/**
 * The brand detail screen, rendered (admin plan 0027, section 7).
 *
 * Everything runs against the in memory gateway, which is the default behind
 * `RESOURCE_GATEWAYS`, so there is no backend and no `HttpClient` here: the rows
 * are the ones `brand-seed.ts` describes.
 *
 * Assertions are on keys rather than on sentences wherever a string is
 * interpolated, because the testing translator does not interpolate.
 */

@Component({
  selector: 'lib-test-host',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class TestHost {}

/**
 * A chains descriptor, local to this file.
 *
 * `ChainNames` resolves a chain through whatever this app mounted under
 * `supermarkets`, and the real one lives in `feature-catalog`. Declaring a small
 * one here keeps the spellings block honest without making this library depend
 * on the catalog's, which it does not otherwise.
 */
const SUPERMARKETS = defineResource<Wire.CatalogSupermarketView>({
  name: 'supermarkets',
  segment: 'supermarkets',
  labels: {
    one: 'catalog.supermarkets.one',
    many: 'catalog.supermarkets.many',
  },
  title: (row) => row.name['en'] ?? row.id,
  fields: [{ kind: 'text', name: 'id', label: 'catalog.supermarkets.id' }],
  list: { columns: ['id'], compact: ['id'] },
  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<Wire.CatalogSupermarketView>({
      path: '/v1/admin/catalog/supermarkets',
      seed: [
        {
          id: 'sm_mercadona',
          name: { en: 'Mercadona', es: 'Mercadona' },
          logoUrl: null,
          websiteUrl: null,
          externalBrandKey: null,
          defaultPriceScopeId: null,
        },
        {
          id: 'sm_carrefour',
          name: { en: 'Carrefour', es: 'Carrefour' },
          logoUrl: null,
          websiteUrl: null,
          externalBrandKey: null,
          defaultPriceScopeId: null,
        },
      ],
    }),
});

/**
 * Both resources at the root rather than under `/harvest`.
 *
 * This file is about the screen, not about where the app hangs it: the mount is
 * asserted in `shell-sections.spec.ts`, against the real sections.
 */
const SECTION: AdminSection = {
  key: 'brands',
  label: '',
  resources: [BRANDS, SUPERMARKETS],
};

async function boot(url: string, before?: () => void) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [TestHost, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      provideRouter(adminRoutes([SECTION])),
      provideLocationMocks(),
      provideResources(BRANDS, SUPERMARKETS),
      SessionStorage,
      SessionStore,
      DeploymentStore,
    ],
  }).compileComponents();

  before?.();

  const fixture = TestBed.createComponent(TestHost);
  fixture.detectChanges();

  await TestBed.inject(Router).navigateByUrl(url);
  await settle(fixture);

  return fixture;
}

/**
 * Lets a read settle, then redraws.
 *
 * A macrotask rather than a handful of microtasks, because a read goes through
 * several awaits and counting them would make this spec depend on how many.
 * `whenStable` is not an option in a zoneless spec: it hangs.
 */
async function settle(fixture: ComponentFixture<TestHost>) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

const text = (fixture: ComponentFixture<TestHost>) =>
  fixture.nativeElement.textContent as string;

/** The spellings block's own rows, which is not the whole screen. */
const spellingRows = (fixture: ComponentFixture<TestHost>) =>
  [
    ...fixture.nativeElement.querySelectorAll('.panel tbody tr'),
  ] as HTMLElement[];

describe('BrandDetailPage', () => {
  it('draws the brand in the generic form, above the spellings', async () => {
    const fixture = await boot('/brands/br_elpozo');

    // The form is the generic one, reading the same descriptor off the route.
    expect(
      fixture.nativeElement.querySelector('lib-resource-form-page')
    ).not.toBeNull();
    expect(
      (
        fixture.nativeElement.querySelector(
          'input#field-label'
        ) as HTMLInputElement
      ).value
    ).toBe('El Pozo');
  });

  it('groups the spellings by chain, each chain named once', async () => {
    const fixture = await boot('/brands/br_elpozo');
    const rows = spellingRows(fixture);

    // Three rows: two Carrefour spellings and one Mercadona.
    expect(rows).toHaveLength(3);

    // The chain is a row header written once per chain, spanning its rows, so
    // the two Carrefour spellings sit under one name rather than two.
    const headers = rows
      .map((row) => row.querySelector('th'))
      .filter((header): header is HTMLTableCellElement => header !== null);

    expect(headers.map((header) => header.textContent?.trim())).toEqual([
      'Carrefour',
      'Mercadona',
    ]);
    expect(headers.map((header) => header.getAttribute('rowspan'))).toEqual([
      '2',
      '1',
    ]);
  });

  /** Seeing `ELPOZO` beside `El Pozo` is the point of the block. */
  it('lists a spelling that differs from the label only by case', async () => {
    const fixture = await boot('/brands/br_elpozo');
    const spellings = spellingRows(fixture).map((row) =>
      row.querySelector('.spelling')?.textContent?.trim()
    );

    expect(spellings).toEqual(['ELPOZO', 'El Pozo', 'El Pozo']);
  });

  /** The normal state of a brand somebody registered by hand. */
  it('says so plainly when no harvested product carries the brand', async () => {
    const fixture = await boot('/brands/br_campofrio');

    expect(text(fixture)).toContain('brands.registered.spellings.empty');
    expect(spellingRows(fixture)).toHaveLength(0);
  });

  /**
   * The two are different questions, and only one of them is out.
   */
  it('shows a failed read in that block alone, leaving the form usable', async () => {
    const fixture = await boot('/brands/br_elpozo', () => {
      jest
        .spyOn(TestBed.inject(BrandsGateway), 'spellings')
        .mockRejectedValue(
          Object.assign(new Error('nope'), { code: 'not_found', status: 404 })
        );
    });

    expect(
      fixture.nativeElement.querySelector('.panel [role="alert"]')?.textContent
    ).toContain('resource.error.notFound');

    // The brand above it is still there, still editable.
    const label = fixture.nativeElement.querySelector(
      'input#field-label'
    ) as HTMLInputElement;
    expect(label.value).toBe('El Pozo');
    expect(label.disabled).toBe(false);
  });
});
