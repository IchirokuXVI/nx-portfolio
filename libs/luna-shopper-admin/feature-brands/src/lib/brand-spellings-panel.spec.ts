import { provideLocationMocks } from '@angular/common/testing';
import { Component, inject } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
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
import { BRANDS } from './brands';
import { BrandsGateway } from './brands-gateway';

/**
 * The page of a brand, rendered: the record page over the `record` block of
 * `BRANDS`, with the table of what each chain's source calls the brand (admin
 * plan 0054, section 4).
 *
 * It took the cases of `brand-detail-page.spec.ts`. The ones about the table
 * are under `BrandSpellingsPanel`. The ones about the links and about
 * deleting a spelling are under the part of the record page that draws them
 * now.
 *
 * Everything runs against the in memory gateway, which is the default behind
 * `RESOURCE_GATEWAYS`, so there is no backend and no `HttpClient` here: the
 * rows are the ones `brand-seed.ts` describes.
 *
 * Assertions are on keys wherever a string is interpolated, because the
 * testing translator does not interpolate.
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
 * `supermarkets`, and the real one lives in `feature-catalog`. Declaring a
 * small one here keeps the table honest without making this library depend on
 * the catalog's, which it does not otherwise.
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
 * Both resources at the root and not under `/harvest`.
 *
 * This file is about the screen, not about where the app hangs it: the mount
 * is asserted in `shell-sections.spec.ts`, against the real sections.
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
 * Lets the reads settle, then redraws.
 *
 * Macrotasks and not a handful of microtasks, because a read goes through
 * several awaits and counting them would make this spec depend on how many.
 * `whenStable` is not an option in a zoneless spec: it hangs.
 */
async function settle(fixture: ComponentFixture<TestHost>) {
  for (let turn = 0; turn < 3; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  }
}

const root = (fixture: ComponentFixture<TestHost>) =>
  fixture.nativeElement as HTMLElement;
const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

/** The table's own rows, which is not the whole screen. */
const spellingRows = (fixture: ComponentFixture<TestHost>) =>
  Array.from(
    root(fixture).querySelectorAll<HTMLElement>(
      'lib-brand-spellings-panel tbody tr'
    )
  );

/** The panel "Other spellings": the brands that are spellings of this one. */
const spellingsPanel = (fixture: ComponentFixture<TestHost>) =>
  root(fixture).querySelector<HTMLElement>('lib-record-list-panel');

/** The label of each field row of the page, and what it reads. */
const fieldRow = (fixture: ComponentFixture<TestHost>, label: string) =>
  Array.from(root(fixture).querySelectorAll<HTMLElement>('lib-field-row')).find(
    (row) => text(row).includes(label)
  ) ?? null;

const menuItem = (fixture: ComponentFixture<TestHost>, name: string) =>
  root(fixture).querySelector<HTMLButtonElement>(`[data-action="${name}"]`);

describe('BrandSpellingsPanel', () => {
  it('is a panel of the record page, under the sections of the brand', async () => {
    const fixture = await boot('/brands/br_elpozo');

    // The page is the record page, reading: the name is a value and no input.
    expect(root(fixture).querySelector('lib-record-page')).not.toBeNull();
    expect(root(fixture).querySelector('lib-resource-form-page')).toBeNull();
    expect(root(fixture).querySelector('h1')?.textContent).toBe('El Pozo');
    expect(root(fixture).querySelector('input')).toBeNull();

    const panel = root(fixture).querySelector('lib-brand-spellings-panel');
    expect(text(panel?.querySelector('h2'))).toBe('brands.record.sources');
  });

  it('groups the spellings by chain, each chain named once', async () => {
    const fixture = await boot('/brands/br_elpozo');
    const rows = spellingRows(fixture);

    // Three rows: two Carrefour spellings and one Mercadona.
    expect(rows).toHaveLength(3);

    // The chain is a row header written once per chain, spanning its rows, so
    // the two Carrefour spellings sit under one name and not under two.
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

  /** Seeing `ELPOZO` beside `El Pozo` is the point of the table. */
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

    expect(
      text(
        root(fixture).querySelector('lib-brand-spellings-panel [data-empty]')
      )
    ).toBe('brands.registered.spellings.empty');
    expect(spellingRows(fixture)).toHaveLength(0);
  });

  /** The two are different questions, and only one of them is out. */
  it('fails alone, leaving the brand readable, and reads again on "Try again"', async () => {
    let spy: jest.SpyInstance | null = null;
    const fixture = await boot('/brands/br_elpozo', () => {
      spy = jest
        .spyOn(TestBed.inject(BrandsGateway), 'spellings')
        .mockRejectedValueOnce(
          new GatewayError({
            code: 'not_found',
            status: 404,
            correlationId: '',
          })
        );
    });

    const failure = root(fixture).querySelector<HTMLElement>(
      'lib-brand-spellings-panel [role="alert"]'
    );
    expect(text(failure)).toContain('record.collection.failed');

    // The brand above it is still there, and so is the panel beside it.
    expect(root(fixture).querySelector('h1')?.textContent).toBe('El Pozo');
    expect(fieldRow(fixture, 'brands.registered.field.label')).not.toBeNull();
    expect(spellingsPanel(fixture)).not.toBeNull();

    failure?.querySelector('button')?.click();
    await settle(fixture);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spellingRows(fixture)).toHaveLength(3);
  });
});

/**
 * What a brand is linked to, and what is linked to it (admin plan 0032,
 * section 2.2, and admin plan 0054, section 4.3).
 *
 * Three states, all three in the seed: `DEBORAH 48H` is a spelling of
 * `Deborah`, `Deborah` has one spelling, and every other brand is neither.
 */
describe('the links of a brand, on the record page', () => {
  it('names the brand a spelling belongs to, as a link to it', async () => {
    const fixture = await boot('/brands/br_deborah48h');

    const link = fieldRow(
      fixture,
      'brands.registered.field.canonicalBrandId'
    )?.querySelector('a');

    expect(text(link)).toBe('Deborah');
    // Built by the registry, never from a literal segment.
    expect(link?.getAttribute('href')).toBe('/brands/br_deborah');
  });

  it('lists the spellings of a brand in a panel, each a link of its own', async () => {
    const fixture = await boot('/brands/br_deborah');
    const panel = spellingsPanel(fixture);

    expect(text(panel?.querySelector('h2'))).toBe('brands.record.spellings');
    // `linkCount` is on the row, so the heading counts with no second read.
    expect(text(panel?.querySelector('[data-count]'))).toBe('1');

    const rows = Array.from(panel?.querySelectorAll('li a') ?? []);
    expect(rows.map((row) => text(row.querySelector('.title')))).toEqual([
      'DEBORAH 48H',
    ]);
    expect(rows[0].getAttribute('href')).toBe('/brands/br_deborah48h');
  });

  it('adds a spelling from the panel, with "Same brand as" filled in', async () => {
    const fixture = await boot('/brands/br_deborah');
    const add = spellingsPanel(fixture)?.querySelector('[data-add]');

    expect(text(add)).toBe('brands.record.addSpelling');
    expect(add?.getAttribute('href')).toBe(
      '/brands/new?canonicalBrandId=br_deborah'
    );
  });

  /** Most brands are neither, and the panel then says how to add one. */
  it('says how to add a spelling for a brand that has none', async () => {
    const fixture = await boot('/brands/br_campofrio');

    expect(
      text(spellingsPanel(fixture)?.querySelector('[data-collection-empty]'))
    ).toBe('brands.record.noSpellings');
  });

  it('shows a failed read of the spellings in that panel alone', async () => {
    const fixture = await boot('/brands/br_deborah', () => {
      const brands = TestBed.inject(BrandsGateway);
      jest
        .spyOn(brands, 'list')
        .mockRejectedValue(
          new GatewayError({ code: 'conflict', status: 409, correlationId: '' })
        );
    });

    expect(
      spellingsPanel(fixture)?.querySelector('[data-collection-error]')
    ).not.toBeNull();
    expect(root(fixture).querySelector('h1')?.textContent).toBe('Deborah');
    expect(
      root(fixture).querySelector('lib-brand-spellings-panel')
    ).not.toBeNull();
  });

  it('counts the products of the brand, and is no link while the list cannot be narrowed', async () => {
    const fixture = await boot('/brands/br_elpozo');
    const row = root(fixture).querySelector<HTMLElement>(
      '[data-links] lib-record-collection'
    );

    expect(text(row?.querySelector('.title'))).toBe('brands.record.products');
    // No `items` resource takes a `brandId`, so the count leads nowhere.
    expect(row?.querySelector('a')).toBeNull();
  });

  it('draws the Record block with the two dates and the ID', async () => {
    const fixture = await boot('/brands/br_elpozo');

    expect(root(fixture).querySelector('[data-fact="added"]')).not.toBeNull();
    expect(root(fixture).querySelector('[data-fact="changed"]')).not.toBeNull();
    expect(text(root(fixture).querySelector('[data-fact="id"] code'))).toBe(
      'br_elpozo'
    );
  });
});

/**
 * Deleting a spelling (backend plan 0124).
 *
 * Only a linked brand can be deleted, so only a linked brand is offered it:
 * a named action in the More menu, and not the Delete of the page.
 */
describe('deleting a spelling, on the record page', () => {
  it('offers the action for a spelling and for nothing else', async () => {
    expect(
      menuItem(await boot('/brands/br_deborah48h'), 'delete-spelling')
    ).not.toBeNull();
    expect(
      menuItem(await boot('/brands/br_deborah'), 'delete-spelling')
    ).toBeNull();
    expect(
      menuItem(await boot('/brands/br_campofrio'), 'delete-spelling')
    ).toBeNull();
  });

  it('never offers the Delete of the page', async () => {
    const fixture = await boot('/brands/br_deborah48h');

    expect(root(fixture).querySelector('[data-delete]')).toBeNull();
  });

  it('asks first, deletes on the answer, and goes to the list', async () => {
    let remove: jest.SpyInstance | null = null;
    const fixture = await boot('/brands/br_deborah48h', () => {
      remove = jest
        .spyOn(TestBed.inject(BrandsGateway), 'remove')
        .mockResolvedValue(undefined);
    });

    menuItem(fixture, 'delete-spelling')?.click();
    await settle(fixture);

    const dialog = root(fixture).querySelector<HTMLElement>(
      '[data-action-question]'
    );
    expect(text(dialog)).toContain('brands.registered.links.deleteBody');
    expect(remove).not.toHaveBeenCalled();

    dialog?.querySelector<HTMLElement>('[data-confirm]')?.click();
    await settle(fixture);

    expect(remove).toHaveBeenCalledWith('br_deborah48h');
    // The row is gone, so the list is where the operator goes next.
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

    menuItem(fixture, 'delete-spelling')?.click();
    await settle(fixture);
    root(fixture)
      .querySelector<HTMLElement>('[data-action-question] [data-confirm]')
      ?.click();
    await settle(fixture);

    expect(text(root(fixture).querySelector('[data-refusal]'))).toContain(
      'resource.error.brandNotLinked'
    );
    expect(TestBed.inject(Router).url).toBe('/brands/br_deborah48h');
  });
});

describe('the old addresses of a brand', () => {
  it('opens a new brand on the record page', async () => {
    const fixture = await boot('/brands/new');

    expect(root(fixture).querySelector('lib-record-page')).not.toBeNull();
    expect(root(fixture).querySelector('lib-save-bar')).not.toBeNull();
    // A brand that does not exist holds nothing.
    expect(root(fixture).querySelector('lib-record-children')).toBeNull();
  });
});
