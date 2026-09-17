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
  provideSections,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  defineResource,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { BRAND_SUGGESTION_SEED } from './brand-seed';
import { BrandSuggestionsPage } from './brand-suggestions-page';
import { BRANDS } from './brands';
import { BrandsGateway, type BrandCreated } from './brands-gateway';
import { brandsRoutes } from './routes';

/**
 * The suggested brands screen, rendered (admin plan 0027, section 7).
 *
 * The reads are spied rather than served from the memory table, because three of
 * the six properties below are about **what is asked for**: which query goes
 * out, which cursor the second page carries, and what the register posts. A
 * memory table answers all three the same way and proves none of them.
 *
 * Assertions are on keys wherever a string is interpolated, because the testing
 * translator does not interpolate: `{{count}}` never becomes a number.
 */

@Component({
  selector: 'lib-test-host',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class TestHost {}

/** A chains descriptor, local to this file (see `brand-detail-page.spec.ts`). */
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
        {
          id: 'sm_consum',
          name: { en: 'Consum', es: 'Consum' },
          logoUrl: null,
          websiteUrl: null,
          externalBrandKey: null,
          defaultPriceScopeId: null,
        },
      ],
    }),
});

/**
 * The real section, minus its segment.
 *
 * The screens and the resource are the section's own, so `pathOf('brands')`
 * answers where this app mounted the registered list and the 409's link is built
 * from a real answer. Where the app hangs the section is asserted in
 * `shell-sections.spec.ts`, against the real sections.
 */
const SECTION: AdminSection = {
  key: 'brands',
  label: '',
  resources: [BRANDS, SUPERMARKETS],
  screens: brandsRoutes(),
};

const page = (fixture: ComponentFixture<TestHost>) =>
  fixture.debugElement.query(By.directive(BrandSuggestionsPage))
    .componentInstance as BrandSuggestionsPage;

async function boot(before?: () => void) {
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

  before?.();

  const fixture = TestBed.createComponent(TestHost);
  fixture.detectChanges();

  await TestBed.inject(Router).navigateByUrl('/suggested-brands');
  await settle(fixture);

  return fixture;
}

/** Lets a read settle, then redraws. `whenStable` hangs in a zoneless spec. */
async function settle(fixture: ComponentFixture<TestHost>, ms = 0) {
  await new Promise((resolve) => setTimeout(resolve, ms));
  fixture.detectChanges();
}

const rows = (fixture: ComponentFixture<TestHost>) =>
  [...fixture.nativeElement.querySelectorAll('tbody tr')] as HTMLElement[];

/** The rows that are suggestions, which is not every row in the table. */
const brandRows = (fixture: ComponentFixture<TestHost>) =>
  rows(fixture).filter((row) => !row.classList.contains('panel-row'));

const registerButton = (fixture: ComponentFixture<TestHost>, key: string) =>
  fixture.nativeElement.querySelector(
    `[data-register="${key}"]`
  ) as HTMLButtonElement | null;

/**
 * The panel's own confirm, by its marker.
 *
 * Not "the first button in the panel": the private label picker draws buttons of
 * its own, and with a chain chosen they come first.
 */
const confirmButton = (fixture: ComponentFixture<TestHost>) =>
  fixture.nativeElement.querySelector('[data-confirm]') as HTMLButtonElement;

const text = (fixture: ComponentFixture<TestHost>) =>
  fixture.nativeElement.textContent as string;

/** Suggestions, as the gateway answers them. */
function answers(
  items: readonly Wire.HarvestBrandSuggestionView[],
  nextCursor: string | null = null
) {
  return { items, nextCursor };
}

function created(overrides: Partial<BrandCreated> = {}): BrandCreated {
  return {
    id: 'br_mahou',
    key: 'mahou',
    label: 'Mahou',
    privateLabelSupermarketId: null,
    itemCount: 58,
    createdAt: '2026-09-16T10:00:00.000Z',
    updatedAt: '2026-09-16T10:00:00.000Z',
    linkedItems: 58,
    ...overrides,
  };
}

/** Type a value into an input, the way a person would. */
function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('BrandSuggestionsPage', () => {
  it('draws the rows in the gateway order, with every chain', async () => {
    const fixture = await boot();
    const drawn = brandRows(fixture);

    expect(
      drawn.map((row) => row.querySelector('.spelling')?.textContent?.trim())
    ).toEqual(BRAND_SUGGESTION_SEED.map((row) => row.spelling));

    // The key under the spelling, which is what the products are filed under.
    expect(drawn[0].querySelector('.key')?.textContent?.trim()).toBe('mahou');

    // Every chain, never the first two and a count of the rest. The chip's own
    // text is a key here, because the testing translator does not interpolate,
    // so the names are asserted where they are resolved.
    expect(drawn[3].querySelectorAll('.chip')).toHaveLength(3);
    expect(
      BRAND_SUGGESTION_SEED[3].chains.map((chain) =>
        page(fixture).names.nameOf(chain.supermarketId)
      )
    ).toEqual(['Consum', 'Carrefour', 'Mercadona']);

    // The figure through `Intl`, and the date beside its age.
    const cells = drawn[0].querySelectorAll('td');
    expect(cells[0].textContent?.trim()).toBe('58');
    expect(cells[1].textContent).toContain('2026');
    expect(cells[1].querySelector('.muted')?.textContent?.trim()).not.toBe('');
  });

  /**
   * The cursor is a keyset over `(productCount, key)` and the counts move as the
   * queue is worked, so a row really can arrive on two pages.
   */
  it('appends the next page and drops a key it already has', async () => {
    const first = BRAND_SUGGESTION_SEED.slice(0, 2);
    const second = [
      BRAND_SUGGESTION_SEED[1],
      BRAND_SUGGESTION_SEED[2],
    ] as const;

    const spies: jest.SpyInstance[] = [];
    const fixture = await boot(() => {
      spies.push(
        jest
          .spyOn(TestBed.inject(BrandsGateway), 'suggestions')
          .mockResolvedValueOnce(answers(first, 'c1'))
          .mockResolvedValueOnce(answers([...second]))
      );
    });

    expect(brandRows(fixture)).toHaveLength(2);

    (fixture.nativeElement.querySelector('.more') as HTMLButtonElement).click();
    await settle(fixture);

    expect(spies[0]).toHaveBeenLastCalledWith('', 'c1');
    expect(
      brandRows(fixture).map((row) =>
        row.querySelector('.key')?.textContent?.trim()
      )
    ).toEqual(['mahou', 'gallo', 'pascual']);
  });

  it('sends what was typed as the query', async () => {
    const spies: jest.SpyInstance[] = [];
    const fixture = await boot(() => {
      spies.push(
        jest
          .spyOn(TestBed.inject(BrandsGateway), 'suggestions')
          .mockResolvedValue(answers(BRAND_SUGGESTION_SEED))
      );
    });

    type(
      fixture.nativeElement.querySelector('[data-search]') as HTMLInputElement,
      'el pozo'
    );
    // Past the typing settle, which is 250ms.
    await settle(fixture, 320);

    expect(spies[0]).toHaveBeenLastCalledWith('el pozo');
  });

  it('says nothing matched when a search finds none', async () => {
    const fixture = await boot(() => {
      jest
        .spyOn(TestBed.inject(BrandsGateway), 'suggestions')
        .mockResolvedValue(answers([]));
    });

    // With no search, the queue is genuinely finished, which is its own sentence.
    expect(text(fixture)).toContain('brands.suggested.empty');

    type(
      fixture.nativeElement.querySelector('[data-search]') as HTMLInputElement,
      'zzz'
    );
    await settle(fixture, 320);

    expect(text(fixture)).toContain('resource.list.noMatch');
  });

  it('opens a panel under the row with its spelling capitalized', async () => {
    const fixture = await boot();

    registerButton(fixture, 'mahou')?.click();
    await settle(fixture);

    const label = fixture.nativeElement.querySelector(
      '[data-label]'
    ) as HTMLInputElement;
    expect(label.value).toBe('Mahou');
    expect(text(fixture)).toContain('brands.suggested.register.makesKey');
  });

  it('reverts to the chain spelling and capitalizes it again', async () => {
    const fixture = await boot();

    registerButton(fixture, 'mahou')?.click();
    await settle(fixture);

    const label = () =>
      fixture.nativeElement.querySelector('[data-label]') as HTMLInputElement;
    const button = (marker: string) =>
      fixture.nativeElement.querySelector(
        `[data-${marker}]`
      ) as HTMLButtonElement;

    // Already capitalized, so only revert has something to do.
    expect(button('capitalize').disabled).toBe(true);
    expect(button('revert').disabled).toBe(false);

    button('revert').click();
    await settle(fixture);
    expect(label().value).toBe('MAHOU');
    expect(button('revert').disabled).toBe(true);
    expect(button('capitalize').disabled).toBe(false);

    type(label(), 'MAHOU cinco ESTRELLAS');
    await settle(fixture);
    button('capitalize').click();
    await settle(fixture);
    expect(label().value).toBe('Mahou Cinco Estrellas');
  });

  /**
   * `MAHOU` and `Mahou` make one key, so both link the products. `Mahou 5
   * Estrellas` does not, and the operator has to be told before they save.
   */
  it('warns only while the label would make a different key', async () => {
    const fixture = await boot();

    registerButton(fixture, 'mahou')?.click();
    await settle(fixture);

    const label = fixture.nativeElement.querySelector(
      '[data-label]'
    ) as HTMLInputElement;

    type(label, 'Mahou');
    await settle(fixture);
    expect(page(fixture).keyDiffers()).toBe(false);
    expect(text(fixture)).not.toContain('brands.suggested.register.keyDiffers');

    type(label, 'Mahou 5 Estrellas');
    await settle(fixture);
    expect(page(fixture).keyDiffers()).toBe(true);
    expect(text(fixture)).toContain('brands.suggested.register.keyDiffers');

    type(label, 'Mahou');
    await settle(fixture);
    expect(text(fixture)).not.toContain('brands.suggested.register.keyDiffers');
  });

  it('registers the row, takes it out of the list and moves on', async () => {
    const spies: jest.SpyInstance[] = [];
    const fixture = await boot(() => {
      spies.push(
        jest
          .spyOn(TestBed.inject(BrandsGateway), 'register')
          .mockResolvedValue(created())
      );
    });

    registerButton(fixture, 'mahou')?.click();
    await settle(fixture);

    type(
      fixture.nativeElement.querySelector('[data-label]') as HTMLInputElement,
      'Mahou'
    );
    await settle(fixture);

    page(fixture).chainId.set('sm_mercadona');
    await settle(fixture);

    confirmButton(fixture).click();
    await settle(fixture);

    expect(spies[0]).toHaveBeenCalledWith('Mahou', 'sm_mercadona');

    // The key is registered, so it is no longer a suggestion.
    expect(
      brandRows(fixture).map((row) =>
        row.querySelector('.key')?.textContent?.trim()
      )
    ).not.toContain('mahou');
    expect(text(fixture)).toContain('brands.suggested.register.done');

    // Focus lands on the next row's button, so the queue can be worked without
    // reaching for the mouse.
    expect(document.activeElement).toBe(registerButton(fixture, 'gallo'));
  });

  it('says so differently when the brand linked nothing', async () => {
    const fixture = await boot(() => {
      jest
        .spyOn(TestBed.inject(BrandsGateway), 'register')
        .mockResolvedValue(created({ linkedItems: 0 }));
    });

    registerButton(fixture, 'mahou')?.click();
    await settle(fixture);
    confirmButton(fixture).click();
    await settle(fixture);

    expect(text(fixture)).toContain('brands.suggested.register.doneNone');
  });

  /**
   * The panel stays open, holding everything typed: a refused register is a
   * decision to make again, not one to make from scratch.
   */
  it('keeps the panel open on a taken key, with a link to the brand holding it', async () => {
    const fixture = await boot(() => {
      jest.spyOn(TestBed.inject(BrandsGateway), 'register').mockRejectedValue(
        new GatewayError({
          code: 'brand_key_taken',
          status: 409,
          correlationId: '',
          details: { brandId: 'br_mahou' },
        })
      );
    });

    registerButton(fixture, 'mahou')?.click();
    await settle(fixture);
    confirmButton(fixture).click();
    await settle(fixture);

    expect(page(fixture).openKey()).toBe('mahou');
    expect(text(fixture)).toContain('resource.error.brandKeyTaken');

    // Built by `ResourceRegistry.pathOf`, never from a literal segment.
    expect(page(fixture).holderLink()).toEqual(['/', 'brands', 'br_mahou']);
    expect(
      (
        fixture.nativeElement.querySelector('.panel a') as HTMLAnchorElement
      ).getAttribute('href')
    ).toBe('/brands/br_mahou');
  });

  it('says what an empty label is, and offers no link', async () => {
    const fixture = await boot(() => {
      jest.spyOn(TestBed.inject(BrandsGateway), 'register').mockRejectedValue(
        new GatewayError({
          code: 'brand_label_empty',
          status: 400,
          correlationId: '',
        })
      );
    });

    registerButton(fixture, 'mahou')?.click();
    await settle(fixture);
    confirmButton(fixture).click();
    await settle(fixture);

    expect(text(fixture)).toContain('resource.error.brandLabelEmpty');
    expect(page(fixture).holderLink()).toBeNull();
  });

  /**
   * A label of punctuation makes no key and therefore no brand, and the button
   * is disabled rather than sending a request whose only answer is a refusal.
   */
  it('refuses to send a label that makes no key', async () => {
    const fixture = await boot();

    registerButton(fixture, 'mahou')?.click();
    await settle(fixture);

    type(
      fixture.nativeElement.querySelector('[data-label]') as HTMLInputElement,
      '---'
    );
    await settle(fixture);

    expect(text(fixture)).toContain('brands.suggested.register.noKey');
    expect(confirmButton(fixture).disabled).toBe(true);
  });

  it('closes the panel on cancel and gives the button its focus back', async () => {
    const fixture = await boot();

    registerButton(fixture, 'mahou')?.click();
    await settle(fixture);

    page(fixture).cancel();
    await settle(fixture);

    expect(page(fixture).openKey()).toBeNull();
    expect(document.activeElement).toBe(registerButton(fixture, 'mahou'));
  });
});
