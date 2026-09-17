import { provideLocationMocks } from '@angular/common/testing';
import { Component, inject } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DeploymentStore,
  GatewayError,
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
import { BrandDetailPage } from './brand-detail-page';
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

/** The links block, which is absent for a brand that is neither. */
const linksBlock = (fixture: ComponentFixture<TestHost>) =>
  fixture.nativeElement.querySelector('[data-links]') as HTMLElement | null;

const deleteButton = (fixture: ComponentFixture<TestHost>) =>
  fixture.nativeElement.querySelector(
    '[data-delete]'
  ) as HTMLButtonElement | null;

const detail = (fixture: ComponentFixture<TestHost>) =>
  fixture.debugElement.query(By.directive(BrandDetailPage))
    .componentInstance as BrandDetailPage;

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

/**
 * What a brand is linked to, and what is linked to it (admin plan 0032, section
 * 2.2).
 *
 * Three states, all three of them in the seed: `DEBORAH 48H` is a spelling of
 * `Deborah`, `Deborah` has one spelling, and every other brand is neither and
 * draws no block at all.
 */
describe('the links block', () => {
  it('names the brand a spelling belongs to, and links to it', async () => {
    const fixture = await boot('/brands/br_deborah48h');

    expect(text(fixture)).toContain('brands.registered.links.spellingOf');
    expect(detail(fixture).canonicalLink()).toEqual([
      '/',
      'brands',
      'br_deborah',
    ]);

    // Built by `ResourceRegistry.pathOf`, never from a literal segment.
    const link = linksBlock(fixture)?.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/brands/br_deborah');
  });

  it('lists what is linked to a brand, each a link of its own', async () => {
    const fixture = await boot('/brands/br_deborah');

    expect(text(fixture)).toContain('brands.registered.links.heading');

    const links = [
      ...(linksBlock(fixture)?.querySelectorAll('.links a') ?? []),
    ] as HTMLAnchorElement[];

    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'DEBORAH 48H',
    ]);
    expect(links[0].getAttribute('href')).toBe('/brands/br_deborah48h');
  });

  /** Most brands are neither, and the honest block for that is no block. */
  it('draws nothing for a brand that is neither', async () => {
    const fixture = await boot('/brands/br_campofrio');

    expect(linksBlock(fixture)).toBeNull();
    expect(text(fixture)).not.toContain('brands.registered.links.heading');
  });

  it('shows a failed links read in that block alone', async () => {
    const fixture = await boot('/brands/br_deborah', () => {
      jest
        .spyOn(TestBed.inject(BrandsGateway), 'links')
        .mockRejectedValue(
          new GatewayError({ code: 'conflict', status: 409, correlationId: '' })
        );
    });

    expect(
      linksBlock(fixture)?.querySelector('[role="alert"]')?.textContent
    ).toContain('resource.error.conflict');

    // The brand above it is still there, still editable.
    expect(
      (
        fixture.nativeElement.querySelector(
          'input#field-label'
        ) as HTMLInputElement
      ).disabled
    ).toBe(false);
  });
});

/**
 * Deleting a spelling (backend plan 0124).
 *
 * Only a linked brand can be deleted, so only a linked brand offers it. The
 * control is here rather than on the list because the list cannot say which
 * rows are legal without a button refused on most of them.
 */
describe('deleting a spelling', () => {
  it('offers the control for a spelling and for nothing else', async () => {
    expect(deleteButton(await boot('/brands/br_deborah48h'))).not.toBeNull();
    expect(deleteButton(await boot('/brands/br_deborah'))).toBeNull();
    expect(deleteButton(await boot('/brands/br_campofrio'))).toBeNull();
  });

  it('asks first, and deletes on the answer', async () => {
    const spies: jest.SpyInstance[] = [];
    const fixture = await boot('/brands/br_deborah48h', () => {
      spies.push(
        jest
          .spyOn(TestBed.inject(BrandsGateway), 'remove')
          .mockResolvedValue(undefined)
      );
    });

    deleteButton(fixture)?.click();
    await settle(fixture);

    const dialog = fixture.nativeElement.querySelector('lib-confirm-dialog');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('brands.registered.links.deleteBody');
    expect(spies[0]).not.toHaveBeenCalled();

    await detail(fixture).remove();
    await settle(fixture);

    expect(spies[0]).toHaveBeenCalledWith('br_deborah48h');

    // The row is gone, so the list is where the operator goes next, and the
    // path comes from the registry rather than from a literal segment.
    expect(TestBed.inject(Router).url).toBe('/brands');
  });

  it('says why when the gateway refuses, and stays put', async () => {
    const fixture = await boot('/brands/br_deborah48h', () => {
      jest.spyOn(TestBed.inject(BrandsGateway), 'remove').mockRejectedValue(
        new GatewayError({
          code: 'brand_not_linked',
          status: 409,
          correlationId: '',
        })
      );
    });

    await detail(fixture).remove();
    await settle(fixture);

    expect(linksBlock(fixture)?.textContent).toContain(
      'resource.error.brandNotLinked'
    );
    expect(TestBed.inject(Router).url).toBe('/brands/br_deborah48h');
  });
});
