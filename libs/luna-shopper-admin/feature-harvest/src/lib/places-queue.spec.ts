import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  HARVEST_SERVICE,
  HarvestMemory,
  ServerReachability,
  type HarvestServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  LOCATIONS,
  PRICE_SCOPES,
  SUPERMARKETS,
} from '@portfolio/luna-shopper-admin/feature-catalog';
import { provideResources } from '@portfolio/luna-shopper-admin/feature-resource';
import { ReferencePicker } from '@portfolio/luna-shopper-admin/ui';
import { PlacesQueuePage } from './places-queue-page';

/**
 * Admin plan 0034, section 1: the places queue against backend plans 0152 and
 * 0153, through the in memory harvester.
 *
 * The memory harvester refuses the way the server does: the Libertador
 * Mercadona answers 409 `place_matches_location` with the catalog seed's shop
 * as its candidate, an unbranded OpenStreetMap place with no chain named
 * answers a plain conflict, and an imported place refuses a reject. So every
 * path here is the screen reading a real refusal, not a mock's call list.
 */

const LIBERTADOR = 'place-mercadona-libertador';
const UNBRANDED = 'place-osm-unbranded';
const MERCADONA = 'sm_mercadona';

const drain = async () => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};

/** Lets the catalog reads behind the duplicates panel settle, then redraws. */
async function settle(fixture: ComponentFixture<PlacesQueuePage>) {
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await drain();
  fixture.detectChanges();
}

interface Call {
  readonly name: string;
  readonly args: unknown[];
}

function recorded(): { service: HarvestServiceI; calls: Call[] } {
  const inner = new HarvestMemory();
  const calls: Call[] = [];

  const service = new Proxy(inner, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || typeof property !== 'string') {
        return value;
      }
      return (...args: unknown[]) => {
        calls.push({ name: property, args });
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as unknown as HarvestServiceI;

  return { service, calls };
}

async function render(focus?: string) {
  const { service, calls } = recorded();

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [PlacesQueuePage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      provideRouter([]),
      provideLocationMocks(),
      // The chain picker, the scope picker and the duplicates panel all read
      // through these descriptors.
      provideResources(SUPERMARKETS, PRICE_SCOPES, LOCATIONS),
      { provide: HARVEST_SERVICE, useValue: service },
      {
        provide: DEPLOYMENT_SERVICE,
        useValue: {
          read: async () => ({
            deployment: 'development',
            devAutologin: false,
          }),
        },
      },
      DeploymentStore,
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(PlacesQueuePage);
  fixture.detectChanges();
  await drain();
  if (focus !== undefined) {
    fixture.componentInstance.open(focus);
  }
  await settle(fixture);

  return { fixture, page: fixture.componentInstance, service, calls };
}

const named = (calls: readonly Call[], name: string): unknown[][] =>
  calls.filter((call) => call.name === name).map((call) => call.args);

/** The place in front, which every test here expects there to be. */
function front(page: PlacesQueuePage) {
  const place = page.queue.current();
  if (place === null) {
    throw new Error('the queue is empty');
  }
  return place;
}

const text = (fixture: ComponentFixture<PlacesQueuePage>): string =>
  fixture.nativeElement.textContent;

describe('the places queue, importing under a scope', () => {
  it('shows the scope the run declared for the place', async () => {
    const { fixture, page } = await render(LIBERTADOR);

    expect(page.queue.current()?.scopeKey).toBe('4661');
    expect(text(fixture)).toContain('harvest.places.scope.declared');
  });

  it('says so when the run declared none', async () => {
    const { fixture } = await render();

    expect(text(fixture)).toContain('harvest.places.scope.none');
  });

  it('offers the scopes of the picked chain, and no other chain', async () => {
    const { fixture, page } = await render();

    expect(text(fixture)).toContain('harvest.places.scope.chainFirst');

    page.chooseChain(MERCADONA);
    fixture.detectChanges();

    const scopes = fixture.debugElement
      .queryAll(By.directive(ReferencePicker))
      .map((node) => node.componentInstance as ReferencePicker)
      .find((picker) => picker.resource() === 'price-scopes');
    expect(scopes?.scope()).toEqual({ supermarketId: MERCADONA });
  });

  it('sends a picked scope beside the picked chain', async () => {
    const { page, calls } = await render();

    page.chooseChain(MERCADONA);
    page.priceScopeId.set('ps_mercadona_4661');
    await page.importPlace();

    expect(named(calls, 'importPlace')[0][1]).toEqual({
      supermarketId: MERCADONA,
      priceScopeId: 'ps_mercadona_4661',
    });
    expect(page.priceScopeId()).toBe('');
  });

  it('forgets a picked scope when the chain changes', async () => {
    const { page } = await render();

    page.chooseChain(MERCADONA);
    page.priceScopeId.set('ps_mercadona_4661');
    page.chooseChain('sm_consum');

    expect(page.priceScopeId()).toBe('');
  });
});

describe('the places queue, when the catalog may already hold the shop', () => {
  async function refused() {
    const rendered = await render(LIBERTADOR);
    await rendered.page.importPlace();
    await settle(rendered.fixture);
    return rendered;
  }

  it('keeps the place in front, writes nothing, and lists the candidates', async () => {
    const { fixture, page, calls } = await refused();

    expect(page.queue.current()?.id).toBe(LIBERTADOR);
    expect(page.queue.decided()).toBe(0);
    expect(named(calls, 'linkPlace')).toHaveLength(0);
    expect(page.candidates()).toEqual([
      {
        supermarketLocationId: 'loc_cordoba_centro',
        title: 'Avenida del Gran Capitán 12',
        address: 'Avenida del Gran Capitán 12',
        postalCode: '14001',
        rung: 'NEARBY',
      },
    ]);
    // The panel is the answer, so no sentence sits above it as well.
    expect(page.errorKey()).toBeNull();
    const panel = fixture.nativeElement.querySelector('.matches');
    expect(panel.textContent).toContain('harvest.places.match.rung.NEARBY');
    expect(panel.textContent).toContain('harvest.places.match.link');
    expect(panel.textContent).toContain('harvest.places.match.force');
  });

  it('links the place to the candidate its button names', async () => {
    const { fixture, page, calls } = await refused();

    fixture.nativeElement.querySelector('.matches li button').click();
    await drain();

    expect(named(calls, 'linkPlace')).toEqual([
      [LIBERTADOR, { supermarketLocationId: 'loc_cordoba_centro' }],
    ]);
    expect(page.queue.items().some((place) => place.id === LIBERTADOR)).toBe(
      false
    );
    expect(page.candidates()).toBeNull();
  });

  it('creates a new shop anyway, with force and nothing else changed', async () => {
    const { page, calls } = await refused();

    await page.forceImport();

    expect(named(calls, 'importPlace')).toEqual([
      [LIBERTADOR, {}],
      [LIBERTADOR, { force: true }],
    ]);
    expect(page.queue.items().some((place) => place.id === LIBERTADOR)).toBe(
      false
    );
  });

  it('does not carry the candidates onto the next place', async () => {
    const { page } = await refused();

    page.queue.skip();

    expect(page.queue.current()?.id).not.toBe(LIBERTADOR);
    expect(page.candidates()).toBeNull();
  });

  it('lists the catalog shops of the chain near the place', async () => {
    const { fixture, page } = await render(LIBERTADOR);

    expect(page.catalogNear().map((shop) => shop.id)).toContain(
      'loc_cordoba_centro'
    );
    expect(
      fixture.nativeElement.querySelector('.near .catalog').textContent
    ).toContain('Avenida del Gran Capitán 12');
  });
});

describe('the places queue, with an OpenStreetMap place and no chain', () => {
  it('offers to create a chain for an OpenStreetMap place only', async () => {
    const osm = await render(UNBRANDED);
    expect(osm.page.offersNewChain()).toBe(true);

    const chain = await render(LIBERTADOR);
    expect(chain.page.offersNewChain()).toBe(false);
  });

  it('opens the chain form with the brand when the import is refused', async () => {
    const { fixture, page } = await render(UNBRANDED);

    await page.importPlace();
    await settle(fixture);

    expect(page.queue.current()?.id).toBe(UNBRANDED);
    expect(page.creatingChain()).toBe(true);
    expect(page.newChainName()).toBe('Deza');
    expect(page.errorKey()).toBe('harvest.places.error.needsChain');
    expect(
      fixture.nativeElement.querySelector('#places-new-chain-name')
    ).not.toBeNull();
  });

  it('creates the chain with the name and the language given', async () => {
    const { fixture, page, calls } = await render(UNBRANDED);

    page.startNewChain(front(page));
    page.newChainName.set('Supermercados Deza');
    page.newChainLocale.set('es');
    fixture.detectChanges();
    await page.importPlace();

    expect(named(calls, 'importPlace')[0][1]).toEqual({
      newChain: { name: 'Supermercados Deza', locale: 'es' },
    });
    expect(page.queue.items().some((place) => place.id === UNBRANDED)).toBe(
      false
    );
    expect(page.creatingChain()).toBe(false);
  });

  it('never sends a picked chain beside a new one', async () => {
    const { page, calls } = await render(UNBRANDED);

    page.chooseChain(MERCADONA);
    page.startNewChain(front(page));
    await page.importPlace();

    expect(named(calls, 'importPlace')[0][1]).toEqual({
      newChain: { name: 'Deza', locale: 'es' },
    });
  });
});

describe('the places queue, and its groups view', () => {
  it('links to the queue read by chain', async () => {
    const { fixture } = await render();

    expect(
      fixture.nativeElement.querySelector('.views-link a').getAttribute('href')
    ).toBe('/harvest/places/groups');
  });
});

describe('the places queue, rejecting a place already imported', () => {
  it('shows the reason the harvester gives and keeps the place', async () => {
    const { fixture, page, service } = await render(LIBERTADOR);
    // Imported behind the screen's back, as a second tab or a run would.
    await service.importPlace(LIBERTADOR, { force: true });

    page.reject();
    await drain();
    fixture.detectChanges();

    expect(page.queue.current()?.id).toBe(LIBERTADOR);
    expect(page.errorKey()).toBe('harvest.places.error.alreadyImported');
    expect(text(fixture)).toContain('harvest.places.error.alreadyImported');
  });
});

describe('the places queue, bulk import beside a candidate', () => {
  it('leaves a place the catalog may hold in the queue and reports it', async () => {
    const { page, calls } = await render();

    page.queue.toggle(LIBERTADOR);
    page.queue.toggle('place-dia-1');
    await page.askImport();
    const pending = page.pending();
    if (pending === null) {
      throw new Error('no bulk action is waiting');
    }
    page.go(pending);
    await drain();

    expect(named(calls, 'linkPlace')).toHaveLength(0);
    expect(named(calls, 'importPlace').map((args) => args[1])).toEqual([
      {},
      {},
    ]);
    expect(page.queue.items().some((place) => place.id === LIBERTADOR)).toBe(
      true
    );
    expect(page.report()).toMatchObject({
      succeeded: 1,
      failed: [
        {
          name: 'Mercadona Libertador',
          reasonKey: 'harvest.places.error.matchesLocation',
        },
      ],
    });
  });
});
