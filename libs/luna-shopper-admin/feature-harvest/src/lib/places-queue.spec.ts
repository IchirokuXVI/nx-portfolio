import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DASHBOARD_SERVICE,
  DashboardMemory,
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
import { ReviewChain } from './review-chain';

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

/** How many times the dashboard was read, which is where the counts come from. */
let dashboardReads = 0;

async function render(focus?: string, url?: string) {
  const { service, calls } = recorded();
  dashboardReads = 0;

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
      // The seeded dashboard, with its reads counted: a decision reads the
      // counts again (admin plan 0044, target 2).
      {
        provide: DASHBOARD_SERVICE,
        useFactory: () => {
          const memory = new DashboardMemory();
          return {
            read: () => {
              dashboardReads += 1;
              return memory.read();
            },
          };
        },
      },
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

  if (url !== undefined) {
    await TestBed.inject(Router).navigateByUrl(url);
  }

  const fixture = TestBed.createComponent(PlacesQueuePage);
  fixture.detectChanges();
  await drain();
  // The chain filter is read first, and its answer builds the queue.
  await new Promise((resolve) => setTimeout(resolve, 0));
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

/**
 * Admin plan 0049. The picked chain, the scope and the chain form are answers
 * about one place. Left in the panel when another place comes up, they file
 * that one under the wrong chain in one press.
 */
describe('the places queue, the panel when another place comes up', () => {
  it('clears the picked chain and scope when another line is opened', async () => {
    const { page } = await render();
    const other = page.queue.items()[1];

    page.chooseChain(MERCADONA);
    page.priceScopeId.set('ps_mercadona_4661');
    page.open(other.id);

    expect(page.queue.current()?.id).toBe(other.id);
    expect(page.supermarketId()).toBe('');
    expect(page.priceScopeId()).toBe('');
  });

  it('clears the picked chain and the chain form on a skip', async () => {
    const { page } = await render();
    const first = front(page);

    page.chooseChain(MERCADONA);
    page.startNewChain(first);
    page.skip();

    expect(page.queue.current()?.id).not.toBe(first.id);
    expect(page.supermarketId()).toBe('');
    expect(page.creatingChain()).toBe(false);
    expect(page.newChainName()).toBe('');
  });

  it('keeps the panel when the line that is pressed is the open one', async () => {
    const { page } = await render();

    page.chooseChain(MERCADONA);
    page.open(front(page).id);

    expect(page.supermarketId()).toBe(MERCADONA);
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
    expect(page.queue.items().some((place) => place.id === LIBERTADOR)).toBe(
      true
    );
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

/**
 * Admin plan 0044, target 4: "Grouped by chain" is a view of this queue, and
 * not a page. It is an entry of the queue's own view switch.
 */
describe('the places queue, and its groups view', () => {
  const groupsButton = (fixture: ComponentFixture<PlacesQueuePage>) =>
    fixture.nativeElement.querySelector(
      'lib-queue-frame .views [data-view="groups"]'
    ) as HTMLButtonElement | null;

  it('offers the grouped view in the switch, and links to no page', async () => {
    const { fixture, page } = await render();

    expect(page.extraViews).toEqual([
      { id: 'groups', labelKey: 'harvest.places.groups.view' },
    ]);
    expect(groupsButton(fixture)?.textContent).toContain(
      'harvest.places.groups.view'
    );
    expect(fixture.nativeElement.querySelector('.views-link')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('a[href*="places/groups"]')
    ).toBeNull();
  });

  /** Built when it is first opened and not before, so it reads nothing until then. */
  it('does not build the grouped view, or read the groups, until it is opened', async () => {
    const { fixture, page, calls } = await render();

    expect(page.grouped()).toBe(false);
    expect(fixture.nativeElement.querySelector('lib-place-groups')).toBeNull();
    expect(named(calls, 'placeGroups')).toHaveLength(0);
  });

  it('builds the grouped view when its entry is pressed, and reads the groups', async () => {
    const { fixture, page, calls } = await render();

    groupsButton(fixture)?.click();
    await settle(fixture);
    await settle(fixture);

    expect(page.grouped()).toBe(true);
    expect(
      fixture.nativeElement.querySelector('lib-place-groups')
    ).not.toBeNull();
    expect(named(calls, 'placeGroups')).toHaveLength(1);
    expect(groupsButton(fixture)?.getAttribute('aria-pressed')).toBe('true');
    expect(TestBed.inject(Router).url).toBe('/?view=groups');
  });

  /** Where the old page's address lands: the queue, on its grouped view. */
  it('opens on the grouped view when the address names it', async () => {
    const { fixture, page, calls } = await render(undefined, '/?view=groups');
    await settle(fixture);

    expect(page.grouped()).toBe(true);
    expect(
      fixture.nativeElement.querySelector('lib-place-groups')
    ).not.toBeNull();
    expect(named(calls, 'placeGroups')).toHaveLength(1);
  });

  it('takes the grouped view away again when another view is chosen', async () => {
    const { fixture, page } = await render(undefined, '/?view=groups');
    await settle(fixture);

    (
      fixture.nativeElement.querySelector(
        'lib-queue-frame .views [data-view="review"]'
      ) as HTMLButtonElement
    ).click();
    await settle(fixture);

    expect(page.grouped()).toBe(false);
    expect(fixture.nativeElement.querySelector('lib-place-groups')).toBeNull();
  });
});

/**
 * Admin plan 0044, target 4: one chain filter for the four queues. A place
 * names a brand and never a chain, so this queue is narrowed through the brand
 * key the chosen chain is known by.
 */
describe('the places queue, narrowed to the chain the four queues share', () => {
  /** Mercadona's brand key in the catalog seed, and the Libertador place's. */
  const MERCADONA_KEY = 'Q1888874';

  it('reads every place while no chain is chosen', async () => {
    const { page, calls, fixture } = await render();

    expect(named(calls, 'listPlaces')[0][0]).toMatchObject({ status: 'NEW' });
    expect(
      (named(calls, 'listPlaces')[0][0] as { brandKey?: string }).brandKey
    ).toBeUndefined();
    expect(page.unnarrowed()).toBe(false);
    expect(fixture.nativeElement.querySelector('.unnarrowed')).toBeNull();
  });

  it('asks for the places of the chain the address names, by its brand key', async () => {
    const { page, calls } = await render(undefined, `/?chain=${MERCADONA}`);

    expect(named(calls, 'listPlaces')).toHaveLength(1);
    expect(named(calls, 'listPlaces')[0][0]).toMatchObject({
      status: 'NEW',
      brandKey: MERCADONA_KEY,
    });
    expect(page.queue.items().length).toBeGreaterThan(0);
    for (const place of page.queue.items()) {
      expect(place.brandKey).toBe(MERCADONA_KEY);
    }
    expect(page.unnarrowed()).toBe(false);
  });

  /**
   * The queue is behind a signal, because each change of the filter builds a
   * new store and a computed that had read the old one would never hear.
   */
  it('builds the queue again when the chain changes, and what reads it follows', async () => {
    const { fixture, page, calls } = await render();
    const first = page.queue;
    const every = first.items().length;

    TestBed.inject(ReviewChain).choose(MERCADONA);
    await settle(fixture);
    await settle(fixture);

    expect(page.queue).not.toBe(first);
    expect(named(calls, 'listPlaces')).toHaveLength(2);
    expect(page.queue.items().length).toBeLessThan(every);
    expect(page.lines().length).toBeGreaterThan(0);
    expect(front(page).brandKey).toBe(MERCADONA_KEY);

    TestBed.inject(ReviewChain).choose('');
    await settle(fixture);
    await settle(fixture);

    expect(page.queue.items().length).toBe(every);
  });

  /**
   * A chain with no brand key cannot be asked for. The queue stays whole and
   * says so, which is better than a filter that looks on and narrows nothing.
   */
  it('shows every place, and says so, for a chain with no brand key', async () => {
    const { fixture, page, calls } = await render(
      undefined,
      '/?chain=a-chain-with-no-key'
    );

    expect(
      (named(calls, 'listPlaces')[0][0] as { brandKey?: string }).brandKey
    ).toBeUndefined();
    expect(page.unnarrowed()).toBe(true);
    expect(
      fixture.nativeElement.querySelector('.unnarrowed')?.textContent
    ).toContain('harvest.places.chainHasNoKey');
  });

  /** The Review page above the queue draws the header (admin plan 0044). */
  it('draws no page header of its own', async () => {
    const { fixture } = await render();

    expect(fixture.nativeElement.querySelector('lib-page-header')).toBeNull();
    expect(fixture.nativeElement.querySelector('h1')).toBeNull();
  });

  it('marks the place in front in the column of a split', async () => {
    const { fixture, page } = await render(LIBERTADOR);
    const frame = fixture.debugElement.query(
      (node) => node.name === 'lib-queue-frame'
    ).componentInstance as { currentId(): string | null };

    expect(frame.currentId()).toBe(front(page).id);
  });
});

/**
 * Admin plan 0044, target 2. A decision takes a place out of the queue, and
 * the count on the rail is the queue's length, so the counts are read again.
 */
describe('the counts, after a decision on a place', () => {
  it('reads the counts again after a place is rejected', async () => {
    const { fixture, page } = await render(UNBRANDED);
    const before = dashboardReads;

    page.reject();
    await settle(fixture);

    expect(dashboardReads).toBe(before + 1);
  });

  it('reads the counts again after a place is imported', async () => {
    const { fixture, page } = await render(LIBERTADOR);
    page.chooseChain(MERCADONA);
    const before = dashboardReads;

    await page.forceImport();
    await settle(fixture);

    expect(page.queue.error()).toBeNull();
    expect(dashboardReads).toBe(before + 1);
  });

  it('does not read them again when the import is refused', async () => {
    const { fixture, page } = await render(LIBERTADOR);
    page.chooseChain(MERCADONA);
    const before = dashboardReads;

    await page.importPlace();
    await settle(fixture);

    expect(page.queue.error()?.code).toBe('place_matches_location');
    expect(dashboardReads).toBe(before);
  });

  it('does not read them again for opening the queue', async () => {
    await render(undefined, `/?chain=${MERCADONA}`);

    // The one read is the frame's own first read of the dashboard.
    expect(dashboardReads).toBe(1);
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
