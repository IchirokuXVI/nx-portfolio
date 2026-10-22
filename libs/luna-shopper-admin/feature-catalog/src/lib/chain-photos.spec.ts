import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import {
  RokuTranslatorService,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  ApiUrl,
  ContentLocaleStore,
  DeploymentStore,
  RESOURCE_GATEWAYS,
  ResourceMemoryGateways,
  ServerReachability,
  SessionStorage,
  SessionStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  adminRoutes,
  provideSections,
  RecordPage,
  ResourceChanges,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  ADMIN_API_CONFIG,
  draftFor,
  toInput,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { itemSource } from './catalog-sources';
import {
  chainPhotoActions,
  ChainPhotos,
  photosHiddenLine,
  toPhotosHidden,
} from './chain-photos';
import { CHAIN_RESOURCES, chainsRoutes } from './chains/chains-routes';
import {
  SUPERMARKETS,
  SUPERMARKETS_PATH,
  type Supermarket,
} from './supermarkets';
import { SUPERMARKET_SEED } from './supermarkets-seed';

/**
 * The photo switch of a chain (admin plan 0066): which action is offered in
 * each state, the body each one sends, the line of the stop, and the reload
 * of products after a write.
 */

const GATEWAY = 'https://gateway.test';

const mercadona = SUPERMARKET_SEED[0] as Supermarket;

/** A product that shows a photo of Mercadona, and one of another chain. */
function chainImageItem(
  id: string,
  supermarketId: string
): Wire.CatalogItemView {
  const base = TestBed.inject(RESOURCE_GATEWAYS) as ResourceMemoryGateways;
  const template = base.tables().table(itemSource())[0];
  const url = `https://img.test/${id}.jpg`;
  return {
    ...template,
    id,
    imageUrl: url,
    imageSource: 'CHAIN',
    imageSupermarketId: supermarketId,
    images: [{ url, source: 'CHAIN', supermarketId }],
  };
}

describe('the actions of a chain photo', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RokuTranslatorTestingModule.forTesting()],
    });
  });

  const actions = () =>
    TestBed.runInInjectionContext(() =>
      chainPhotoActions(
        TestBed.inject(ChainPhotos),
        TestBed.inject(RokuTranslatorService)
      )
    );
  const offered = (row: Supermarket) =>
    actions()
      .filter((action) => action.available?.(row) ?? true)
      .map((action) => action.name);

  it('offers to show the photos of a chain that is off', () => {
    expect(offered({ ...mercadona, linkedImagesEnabled: false })).toEqual([
      'show-photos',
      'hide-every-chain-photos',
    ]);
  });

  it('offers to hide the photos of a chain that is on', () => {
    expect(offered({ ...mercadona, linkedImagesEnabled: true })).toEqual([
      'hide-photos',
      'hide-every-chain-photos',
    ]);
  });

  it('asks before each one, and draws only the stop in red', () => {
    const named = actions();

    expect(named.every((action) => action.confirm !== undefined)).toBe(true);
    expect(
      named.filter((action) => action.danger === true).map((a) => a.name)
    ).toEqual(['hide-every-chain-photos']);
    // Its answer is a line, which a list has nowhere to put.
    expect(
      named.filter((action) => action.recordOnly === true).map((a) => a.name)
    ).toEqual(['hide-every-chain-photos']);
  });

  it('never lets a save send the switch', () => {
    const row = { ...mercadona, linkedImagesEnabled: true };
    const draft = draftFor(SUPERMARKETS, row, 'edit');
    const input = toInput(
      SUPERMARKETS,
      { ...draft, linkedImagesEnabled: false },
      'edit',
      draft
    );

    expect(input).not.toHaveProperty('linkedImagesEnabled');
  });
});

describe('ChainPhotos over HTTP', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        ApiUrl,
        { provide: ADMIN_API_CONFIG, useValue: { gatewayBaseUrl: GATEWAY } },
        // Anything that is not the memory tables sends over HTTP.
        { provide: RESOURCE_GATEWAYS, useValue: { for: () => null } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it.each([true, false])(
    'sends { enabled: %s } as a JSON boolean',
    async (enabled) => {
      const done = TestBed.inject(ChainPhotos).set('sm_mercadona', enabled);

      const request = http.expectOne(
        `${GATEWAY}${SUPERMARKETS_PATH}/sm_mercadona/linked-images`
      );
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({ enabled });
      expect(typeof request.request.body.enabled).toBe('boolean');
      request.flush({ ...mercadona, linkedImagesEnabled: enabled });
      await done;
    }
  );

  it('stops every chain with a POST that has no body', async () => {
    const done = TestBed.inject(ChainPhotos).hideAll();

    const request = http.expectOne(
      `${GATEWAY}/v1/admin/catalog/linked-images/disable-all`
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toBeNull();
    request.flush({ supermarkets: 2, items: 3104 });

    expect(await done).toEqual({ supermarkets: 2, items: 3104 });
  });

  it('says that chains and products changed after each write', async () => {
    const changes = TestBed.inject(ResourceChanges);
    const done = TestBed.inject(ChainPhotos).set('sm_mercadona', false);
    http
      .expectOne(`${GATEWAY}${SUPERMARKETS_PATH}/sm_mercadona/linked-images`)
      .flush({});
    await done;

    expect(changes.version('supermarkets')).toBe(1);
    expect(changes.version('items')).toBe(1);
  });

  it('writes nothing it was refused', async () => {
    const changes = TestBed.inject(ResourceChanges);
    const done = TestBed.inject(ChainPhotos).set('sm_mercadona', true);
    http
      .expectOne(`${GATEWAY}${SUPERMARKETS_PATH}/sm_mercadona/linked-images`)
      .flush({}, { status: 404, statusText: 'Not Found' });

    await expect(done).rejects.toMatchObject({ status: 404 });
    expect(changes.version('items')).toBe(0);
  });
});

describe('ChainPhotos in memory', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  const chains = () =>
    (TestBed.inject(RESOURCE_GATEWAYS) as ResourceMemoryGateways)
      .tables()
      .table({ path: SUPERMARKETS_PATH, seed: SUPERMARKET_SEED });
  // The table itself, so that a spec can put a product with a chain photo
  // in it: no product of the seed has one.
  const items = () =>
    (TestBed.inject(RESOURCE_GATEWAYS) as ResourceMemoryGateways)
      .tables()
      .table(itemSource()) as Wire.CatalogItemView[];

  it('turns one chain on and off, and takes its photos out of products', async () => {
    const photos = TestBed.inject(ChainPhotos);
    items().push(
      chainImageItem('it_merc', 'sm_mercadona'),
      chainImageItem('it_carr', 'sm_carrefour')
    );

    await photos.set('sm_mercadona', true);
    expect(
      chains().find((c) => c.id === 'sm_mercadona')?.linkedImagesEnabled
    ).toBe(true);

    await photos.set('sm_mercadona', false);
    expect(
      chains().find((c) => c.id === 'sm_mercadona')?.linkedImagesEnabled
    ).toBe(false);

    const merc = items().find((item) => item.id === 'it_merc');
    expect(merc?.images).toEqual([]);
    expect(merc?.imageUrl).toBeNull();
    expect(merc?.imageSource).toBeNull();
    // Another chain's photo stays.
    expect(items().find((item) => item.id === 'it_carr')?.imageUrl).toBe(
      'https://img.test/it_carr.jpg'
    );
  });

  it('counts the chains and products the stop changed', async () => {
    const photos = TestBed.inject(ChainPhotos);
    items().push(
      chainImageItem('it_merc', 'sm_mercadona'),
      chainImageItem('it_carr', 'sm_carrefour')
    );
    await photos.set('sm_mercadona', true);
    await photos.set('sm_carrefour', true);

    expect(await photos.hideAll()).toEqual({ supermarkets: 2, items: 2 });
    expect(chains().some((chain) => chain.linkedImagesEnabled)).toBe(false);
    // A stop that changes nothing says so.
    expect(await photos.hideAll()).toEqual({ supermarkets: 0, items: 0 });
  });

  it('refuses a chain that does not exist', async () => {
    await expect(
      TestBed.inject(ChainPhotos).set('sm_nowhere', true)
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('the line of the stop', () => {
  /** A translator that writes the words the catalogue holds. */
  const words: Record<string, string> = {
    'catalog.supermarkets.photosHidden.chains_one': '{{n}} chain',
    'catalog.supermarkets.photosHidden.chains_other': '{{n}} chains',
    'catalog.supermarkets.photosHidden.products_one': '{{n}} product',
    'catalog.supermarkets.photosHidden.products_other': '{{n}} products',
  };
  const translator = {
    locale: () => 'en',
    t: (
      key: string,
      _ns?: string,
      _locale?: string,
      values?: { count: number; n: string }
    ) =>
      (words[`${key}_${values?.count === 1 ? 'one' : 'other'}`] ?? key).replace(
        '{{n}}',
        values?.n ?? ''
      ),
  } as unknown as RokuTranslatorService;

  it('names both counts, formatted for the reader', () => {
    expect(
      photosHiddenLine({ supermarkets: 2, items: 3104 }, translator)
    ).toEqual({
      kind: 'line',
      key: 'catalog.supermarkets.photosHidden.line',
      args: { chains: '2 chains', products: '3,104 products' },
    });
  });

  it('says one chain and one product in the singular', () => {
    expect(
      photosHiddenLine({ supermarkets: 1, items: 1 }, translator)
    ).toMatchObject({ args: { chains: '1 chain', products: '1 product' } });
  });

  it('reads the answer from unknown, and a missing count as none', () => {
    expect(toPhotosHidden({ supermarkets: 2, items: 3104 })).toEqual({
      supermarkets: 2,
      items: 3104,
    });
    expect(toPhotosHidden({ supermarkets: '2' })).toEqual({
      supermarkets: 0,
      items: 0,
    });
    expect(toPhotosHidden(null)).toEqual({ supermarkets: 0, items: 0 });
  });
});

@Component({
  selector: 'lib-test-host',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class TestHost {}

const CHAINS: AdminSection = {
  key: 'chains',
  label: '',
  held: CHAIN_RESOURCES,
  screens: chainsRoutes(),
};

async function boot(url: string): Promise<ComponentFixture<TestHost>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [TestHost, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      provideRouter(adminRoutes([CHAINS])),
      provideLocationMocks(),
      provideSections(CHAINS),
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

/** A macrotask, because `whenStable` hangs in a zoneless spec. */
async function settle(fixture: ComponentFixture<TestHost>) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

describe('the photos of a chain on its page', () => {
  const page = (fixture: ComponentFixture<TestHost>) =>
    fixture.debugElement.query(By.directive(RecordPage))
      .componentInstance as RecordPage;
  const names = (actions: readonly { name: string }[]) =>
    actions.map((action) => action.name);

  it('says on the row of the column which chains show their photos', async () => {
    const fixture = await boot('/chains');
    const shown = () =>
      (
        [
          ...fixture.nativeElement.querySelectorAll('[data-row]'),
        ] as HTMLElement[]
      )
        .filter((row) =>
          row.textContent?.includes('catalog.supermarkets.photosShown')
        )
        .map((row) => row.querySelector('.row-heading')?.textContent);

    expect(shown()).toEqual([]);

    await TestBed.inject(ChainPhotos).set('sm_mercadona', true);
    await settle(fixture);
    await settle(fixture);

    expect(shown()).toEqual(['Mercadona']);
  });

  it('reads the switch in a section of its own', async () => {
    const fixture = await boot('/chains/sm_mercadona/details');
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('catalog.supermarkets.section.photos');
    expect(text).toContain('catalog.supermarkets.linkedImagesEnabled');
    expect(text).toContain('catalog.supermarkets.linkedImagesEnabledHelp');
  });

  it('shows the photos after the question, then offers to hide them', async () => {
    const fixture = await boot('/chains/sm_mercadona/details');
    const items = TestBed.inject(ResourceChanges);

    expect(names(page(fixture).plainActions())).toEqual(['show-photos']);
    expect(names(page(fixture).dangerActions())).toEqual([
      'hide-every-chain-photos',
    ]);

    const show = page(fixture).plainActions()[0];
    await page(fixture).run(show);
    await settle(fixture);
    expect(
      fixture.nativeElement.querySelector('[data-action-question]')
    ).not.toBeNull();

    await page(fixture).confirmAction();
    await settle(fixture);

    expect(page(fixture).store().row()?.['linkedImagesEnabled']).toBe(true);
    expect(names(page(fixture).plainActions())).toEqual(['hide-photos']);
    // The products read again: what they show as a photo followed the switch.
    expect(items.version('items')).toBeGreaterThan(0);
  });

  it('answers the stop with a line and reads the chain again', async () => {
    const fixture = await boot('/chains/sm_mercadona/details');
    await TestBed.inject(ChainPhotos).set('sm_mercadona', true);
    await settle(fixture);
    await settle(fixture);

    const stop = page(fixture).dangerActions()[0];
    await page(fixture).run(stop);
    await page(fixture).confirmAction();
    await settle(fixture);

    expect(page(fixture).done()).toMatchObject({
      kind: 'line',
      key: 'catalog.supermarkets.photosHidden.line',
    });
    expect(page(fixture).store().row()?.['linkedImagesEnabled']).toBe(false);
    expect(
      fixture.nativeElement.querySelector('[data-action-done]')
    ).not.toBeNull();
  });
});
