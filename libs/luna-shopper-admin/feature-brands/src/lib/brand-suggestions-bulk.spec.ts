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
  provideSections,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  defineResource,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { brandSource } from './brand-sources';
import { BRANDS } from './brands';
import {
  BrandsGateway,
  toBrandBatchResults,
  type Brand,
} from './brands-gateway';
import { brandsRoutes } from './routes';

/**
 * Registering several suggested brands at once, rendered (admin plan 0035,
 * section 1).
 *
 * The batch runs against the in memory brand table unless a case needs an
 * answer the table cannot give, and `registerMany` is spied either way, so a
 * spec can prove that ticking and editing send nothing and that only the review
 * sends.
 */

@Component({
  selector: 'lib-test-host',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class TestHost {}

/** A chains descriptor, so the section's pickers have something to resolve. */
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
      seed: [],
    }),
});

const SECTION: AdminSection = {
  key: 'brands',
  label: '',
  resources: [BRANDS, SUPERMARKETS],
  screens: brandsRoutes(),
};

async function boot() {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [TestHost, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      provideRouter(adminRoutes([SECTION])),
      provideLocationMocks(),
      provideSections(SECTION),
      SessionStorage,
      SessionStore,
      DeploymentStore,
    ],
  }).compileComponents();

  const registerMany = jest.spyOn(
    TestBed.inject(BrandsGateway),
    'registerMany'
  );
  const fixture = TestBed.createComponent(TestHost);
  fixture.detectChanges();

  await TestBed.inject(Router).navigateByUrl('/suggested-brands');
  await settle(fixture);

  return { fixture, registerMany };
}

/** Lets a read settle, then redraws. `whenStable` hangs in a zoneless spec. */
async function settle(fixture: ComponentFixture<TestHost>) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

const q = <T extends Element>(
  fixture: ComponentFixture<TestHost>,
  selector: string
) => fixture.nativeElement.querySelector(selector) as T | null;

const all = (fixture: ComponentFixture<TestHost>, selector: string) =>
  [...fixture.nativeElement.querySelectorAll(selector)] as HTMLElement[];

async function click(fixture: ComponentFixture<TestHost>, selector: string) {
  const button = q<HTMLButtonElement>(fixture, selector);
  expect(button).not.toBeNull();
  button?.click();
  await settle(fixture);
}

/** Tick the row whose key this is. */
async function pick(fixture: ComponentFixture<TestHost>, key: string) {
  const row = all(fixture, 'tbody tr').find(
    (tr) => tr.querySelector('.key')?.textContent?.trim() === key
  );
  const box = row?.querySelector('[data-pick]') as HTMLInputElement | null;
  expect(box).not.toBeNull();
  box?.dispatchEvent(new Event('change'));
  await settle(fixture);
}

/** The keys of the suggestion rows still listed. */
const listedKeys = (fixture: ComponentFixture<TestHost>) =>
  all(fixture, 'tbody tr .key').map((cell) => cell.textContent?.trim());

/** Type a value into an input, the way a person would. */
async function type(
  fixture: ComponentFixture<TestHost>,
  input: HTMLInputElement,
  value: string
) {
  input.value = value;
  input.dispatchEvent(new Event('input'));
  await settle(fixture);
}

/** A brand in the memory table, as if somebody registered it elsewhere. */
async function registered(label: string, key: string): Promise<Brand> {
  const now = '2026-09-20T10:00:00.000Z';
  return TestBed.inject(RESOURCE_GATEWAYS).for<Brand>(brandSource()).create({
    key,
    label,
    privateLabelSupermarketId: null,
    itemCount: 0,
    canonicalBrandId: null,
    canonicalLabel: null,
    linkCount: 0,
    createdAt: now,
    updatedAt: now,
  });
}

describe('BrandSuggestionsPage, selecting several', () => {
  it('draws no tick box until selecting starts', async () => {
    const { fixture } = await boot();
    expect(all(fixture, '[data-pick]')).toHaveLength(0);

    await click(fixture, '[data-select-mode]');
    expect(all(fixture, '[data-pick]').length).toBeGreaterThan(0);
  });

  it('sends nothing from a tick, and the review names every label', async () => {
    const { fixture, registerMany } = await boot();
    await click(fixture, '[data-select-mode]');
    await pick(fixture, 'mahou');
    await pick(fixture, 'borges');

    expect(registerMany).not.toHaveBeenCalled();

    await click(fixture, '[data-review]');
    const labels = all(fixture, '[data-batch-label]') as HTMLInputElement[];
    // Capitalized, as the single panel starts.
    expect(labels.map((input) => input.value)).toEqual(['Mahou', 'Borges']);
    // The list waits while the review is open.
    expect(listedKeys(fixture)).toEqual([]);
    expect(registerMany).not.toHaveBeenCalled();
  });

  it('registers the reviewed names against the memory table, created and existing', async () => {
    const { fixture, registerMany } = await boot();
    await click(fixture, '[data-select-mode]');
    await pick(fixture, 'mahou');
    await pick(fixture, 'gallo');

    // Somebody registered Gallo while this list was open.
    const gallo = await registered('Gallo', 'gallo');

    await click(fixture, '[data-review]');
    const labels = all(fixture, '[data-batch-label]') as HTMLInputElement[];
    await type(fixture, labels[0], 'Mahou Cerveza');
    // A label that makes another key is held back rather than sent.
    expect(fixture.nativeElement.textContent).toContain(
      'brands.suggested.bulk.keyDiffers'
    );
    expect(q(fixture, '[data-send]')?.hasAttribute('disabled')).toBe(true);
    await type(fixture, labels[0], 'Mahou');
    expect(q(fixture, '[data-send]')?.hasAttribute('disabled')).toBe(false);

    await click(fixture, '[data-send]');

    expect(registerMany).toHaveBeenCalledTimes(1);
    expect(registerMany).toHaveBeenCalledWith([
      { label: 'Mahou' },
      { label: 'Gallo' },
    ]);
    const outcomes = all(fixture, '[data-batch-result] li').map((li) =>
      li.getAttribute('data-outcome')
    );
    expect(outcomes).toEqual(['CREATED', 'EXISTS']);
    // The one that existed links to the brand holding its key.
    const link = q<HTMLAnchorElement>(fixture, '[data-outcome="EXISTS"] a');
    expect(link?.getAttribute('href')).toBe(`/brands/${gallo.id}`);

    // Both keys are held now, so both rows left the list and the selection.
    expect(listedKeys(fixture)).not.toContain('mahou');
    expect(listedKeys(fixture)).not.toContain('gallo');
    expect(all(fixture, '[data-pick]')).toHaveLength(0);
  });

  it('keeps a refused name ticked beside a created one', async () => {
    const { fixture, registerMany } = await boot();
    registerMany.mockResolvedValueOnce([
      {
        label: 'Mahou',
        outcome: 'CREATED',
        brandId: 'br_new',
        linkedItems: 58,
        reasonCode: null,
        reasonDetail: null,
      },
      {
        label: 'Borges',
        outcome: 'REFUSED',
        brandId: null,
        linkedItems: null,
        reasonCode: 'brand_label_empty',
        reasonDetail: 'The label makes no brand key.',
      },
    ]);

    await click(fixture, '[data-select-mode]');
    await pick(fixture, 'mahou');
    await pick(fixture, 'borges');
    await click(fixture, '[data-review]');
    await click(fixture, '[data-send]');

    const refused = q(fixture, '[data-outcome="REFUSED"]');
    expect(refused?.textContent).toContain('resource.error.brandLabelEmpty');
    expect(refused?.textContent).toContain('The label makes no brand key.');
    expect(fixture.nativeElement.textContent).toContain(
      'brands.suggested.bulk.refusedKept'
    );

    // Mahou left; Borges is still listed, still ticked, still selecting.
    expect(listedKeys(fixture)).not.toContain('mahou');
    expect(listedKeys(fixture)).toContain('borges');
    const ticked = all(fixture, '[data-pick]').filter(
      (box) => (box as HTMLInputElement).checked
    );
    expect(ticked).toHaveLength(1);
  });

  it('keeps the review open when the request is refused as a whole', async () => {
    const { fixture, registerMany } = await boot();
    registerMany.mockRejectedValueOnce(
      new GatewayError({ code: '', status: 0, correlationId: '' })
    );

    await click(fixture, '[data-select-mode]');
    await pick(fixture, 'pascual');
    await click(fixture, '[data-review]');
    await click(fixture, '[data-send]');

    expect(q(fixture, '[data-review-panel]')).not.toBeNull();
    expect(
      q(fixture, '[data-review-panel] [role="alert"]')?.textContent
    ).toContain('resource.error.unreachable');
    expect(q(fixture, '[data-batch-result]')).toBeNull();
    expect(
      (all(fixture, '[data-batch-label]') as HTMLInputElement[]).map(
        (input) => input.value
      )
    ).toEqual(['Pascual']);
  });

  it('goes back to the list with every tick kept', async () => {
    const { fixture, registerMany } = await boot();
    await click(fixture, '[data-select-mode]');
    await pick(fixture, 'danone');
    await click(fixture, '[data-review]');
    await click(fixture, '[data-back]');

    expect(q(fixture, '[data-review-panel]')).toBeNull();
    expect(
      all(fixture, '[data-pick]').filter(
        (box) => (box as HTMLInputElement).checked
      )
    ).toHaveLength(1);
    expect(registerMany).not.toHaveBeenCalled();
  });
});

describe('toBrandBatchResults', () => {
  it('reads the answer by position, and anything unknown as refused', () => {
    const results = toBrandBatchResults(
      {
        results: [
          {
            label: 'Mahou',
            outcome: 'CREATED',
            brandId: 'b1',
            linkedItems: 3,
            reason: null,
          },
          {
            label: 'Gallo',
            outcome: 'SOMETHING_NEW',
            brandId: null,
            linkedItems: null,
            reason: { code: 'x', detail: 'y' },
          },
        ],
      },
      [{ label: 'Mahou' }, { label: 'Gallo' }, { label: 'Borges' }]
    );

    expect(results.map((result) => result.outcome)).toEqual([
      'CREATED',
      'REFUSED',
      'REFUSED',
    ]);
    expect(results[0].linkedItems).toBe(3);
    expect(results[1].reasonCode).toBe('x');
    expect(results[2]).toEqual({
      label: 'Borges',
      outcome: 'REFUSED',
      brandId: null,
      linkedItems: null,
      reasonCode: null,
      reasonDetail: null,
    });
  });
});
