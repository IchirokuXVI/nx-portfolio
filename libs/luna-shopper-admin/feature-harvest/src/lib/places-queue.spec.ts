import { provideLocationMocks } from '@angular/common/testing';
import { signal } from '@angular/core';
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
  GatewayError,
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
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { ReferencePicker, Viewport } from '@portfolio/luna-shopper-admin/ui';
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
/** The place a shop was made from: `loc_cordoba_oeste` carries its reference. */
const OESTE = 'place-mercadona-oeste';
/** A place with a shop of its chain about 110 metres away, and no nearer. */
const TRASSIERRA = 'place-mercadona-trassierra';
/** A place that names Carrefour, a chain the catalog holds no shop of. */
const CARREFOUR = 'place-carrefour-1';
/** A place that names Dia, a chain the catalog does not hold. */
const DIA = 'place-dia-1';

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

/**
 * What a test puts in the place of one method of the memory harvester, for
 * the answers the seed cannot give: a gateway that fails, a skipped place.
 */
type Overrides = Partial<HarvestServiceI>;

function recorded(overrides: Overrides = {}): {
  service: HarvestServiceI;
  calls: Call[];
} {
  const inner = new HarvestMemory();
  const calls: Call[] = [];

  const service = new Proxy(inner, {
    get(target, property, receiver) {
      const replaced =
        typeof property === 'string'
          ? (overrides as Record<string, unknown>)[property]
          : undefined;
      const value = replaced ?? Reflect.get(target, property, receiver);
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

async function render(
  focus?: string,
  url?: string,
  options: { overrides?: Overrides; split?: boolean } = {}
) {
  const { service, calls } = recorded(options.overrides);
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
      // The column of the queue is drawn at the split width only, and jsdom
      // matches no media query.
      ...(options.split === true
        ? [
            {
              provide: Viewport,
              useValue: { split: signal(true), compact: signal(false) },
            },
          ]
        : []),
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
    expect(page.refused()).toBe(true);
    expect(page.candidates()).toEqual([
      {
        supermarketLocationId: 'loc_cordoba_centro',
        supermarketId: MERCADONA,
        title: 'Avenida del Gran Capitán 12',
        address: 'Avenida del Gran Capitán 12',
        city: 'Córdoba',
        postalCode: '14001',
        metres: 28,
        rung: 'NEARBY',
        hint: false,
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
    expect(page.refused()).toBe(false);
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
    const { fixture, page } = await refused();

    page.queue.skip();
    fixture.detectChanges();

    // The next place has a candidate of its own, from the list read. The
    // refusal, and the "Create a new shop anyway" that answers it, stay
    // with the place that was refused.
    expect(page.queue.current()?.id).toBe(OESTE);
    expect(page.refused()).toBe(false);
    expect(
      page.candidates()?.map((candidate) => candidate.supermarketLocationId)
    ).toEqual(['loc_cordoba_oeste']);
    expect(fixture.nativeElement.querySelector('.matches .force')).toBeNull();
  });

  /** Admin plan 0061, target 5: no shop is listed twice. */
  it('reads the catalog shops near the place, and lists the candidate once', async () => {
    const { fixture, page } = await render(LIBERTADOR);

    expect(page.catalogNear().map((shop) => shop.id)).toContain(
      'loc_cordoba_centro'
    );
    expect(page.catalogOthers()).toEqual([]);
    expect(fixture.nativeElement.querySelector('.near .catalog')).toBeNull();
    expect(fixture.nativeElement.querySelector('.near').textContent).toContain(
      'harvest.places.nearCatalog.above'
    );
    expect(
      fixture.nativeElement.querySelector('.matches').textContent
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

/**
 * Admin plan 0061, targets 1 to 3: the list read says which shop a place may
 * be, on the line and on the open place, with no import refused first.
 */
describe('the places queue, a place that says which shop it may be', () => {
  const lines = (fixture: ComponentFixture<PlacesQueuePage>) =>
    [
      ...(fixture.nativeElement.querySelectorAll(
        'lib-queue-frame .column .line'
      ) as NodeListOf<HTMLElement>),
    ].map((line) => ({
      text: line.textContent ?? '',
      mark: line.querySelector('.mark'),
    }));

  it('marks a line with a candidate in words, and no line without one', async () => {
    const { fixture } = await render(undefined, undefined, { split: true });
    const drawn = lines(fixture);
    const of = (name: string) =>
      drawn.find((line) => line.text.includes(name)) ?? null;

    expect(drawn.length).toBe(7);
    expect(of('Mercadona Libertador')?.mark?.textContent).toContain(
      'harvest.places.mark.probable'
    );
    expect(of('way/48821004')?.mark?.textContent).toContain(
      'harvest.places.mark.probable'
    );
    expect(of('Dia Market')?.mark).toBeNull();
    expect(of('Supermercado Deza')?.mark).toBeNull();
    expect(drawn.filter((line) => line.mark !== null)).toHaveLength(3);
  });

  /** A hint reads as a hint on the line too. */
  it('says only that a shop is near on the line of a place with a hint', async () => {
    const { fixture } = await render(undefined, undefined, { split: true });
    const line = lines(fixture).find((drawn) =>
      drawn.text.includes('Mercadona Trassierra')
    );

    expect(line?.mark?.textContent).toContain('harvest.places.mark.near');
    expect(line?.mark?.classList.contains('hint')).toBe(true);
  });

  it('leads the open place with its candidates, before any import', async () => {
    const { fixture, page, calls } = await render(OESTE);
    const panel = fixture.nativeElement.querySelector(
      '.matches'
    ) as HTMLElement;

    expect(named(calls, 'importPlace')).toHaveLength(0);
    expect(page.refused()).toBe(false);
    expect(panel.textContent).toContain('Calle Historiador Domínguez Ortiz 4');
    expect(panel.textContent).toContain('14005 Córdoba');
    expect(panel.textContent).toContain(
      'harvest.places.match.rung.EXTERNAL_REF'
    );
    expect(panel.textContent).toContain('harvest.places.match.metres');
    expect(panel.textContent).toContain('harvest.places.match.leadFound');
    expect(panel.textContent).toContain('harvest.places.match.link');
    // "Create a new shop anyway" answers a refused import, and none was.
    expect(panel.querySelector('.force')).toBeNull();

    // Above the chain picker.
    const chain = fixture.nativeElement.querySelector(
      '#places-chain'
    ) as HTMLElement | null;
    const picker =
      chain ??
      (fixture.debugElement
        .queryAll(By.directive(ReferencePicker))
        .find(
          (node) =>
            (node.componentInstance as ReferencePicker).controlId() ===
            'places-chain'
        )?.nativeElement as HTMLElement);
    expect(
      panel.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('says how far the shop is', async () => {
    const { page } = await render(OESTE);

    expect(page.candidates()?.[0].metres).toBeGreaterThan(0);
    expect(page.candidates()?.[0].metres).toBeLessThan(20);
  });

  it('draws a strict candidate with the filled button', async () => {
    const { fixture } = await render(OESTE);
    const button = fixture.nativeElement.querySelector(
      '.matches li button'
    ) as HTMLButtonElement;

    expect(button.classList.contains('primary')).toBe(true);
    expect(button.classList.contains('quiet')).toBe(false);
  });

  it('draws a hint with the quiet button and the sentence of a hint', async () => {
    const { fixture, page } = await render(TRASSIERRA);
    const panel = fixture.nativeElement.querySelector(
      '.matches'
    ) as HTMLElement;
    const button = panel.querySelector('li button') as HTMLButtonElement;

    expect(page.candidates()?.[0]).toEqual(
      expect.objectContaining({ rung: 'SAME_CHAIN_NEAR', hint: true })
    );
    expect(panel.textContent).toContain(
      'harvest.places.match.rung.SAME_CHAIN_NEAR'
    );
    expect(button.classList.contains('quiet')).toBe(true);
    expect(button.classList.contains('primary')).toBe(false);
  });

  /**
   * A panel of hints alone does not say that the catalog may hold the shop:
   * it says that a shop of the chain is near.
   */
  it('heads a panel of hints alone as a shop that is near', async () => {
    const hint = await render(TRASSIERRA);
    const hintPanel = hint.fixture.nativeElement.querySelector(
      '.matches'
    ) as HTMLElement;
    expect(hint.page.hintsOnly()).toBe(true);
    expect(hintPanel.classList.contains('hints')).toBe(true);
    expect(hintPanel.textContent).toContain('harvest.places.match.headingNear');
    expect(hintPanel.textContent).toContain('harvest.places.match.leadNear');

    const strict = await render(OESTE);
    const strictPanel = strict.fixture.nativeElement.querySelector(
      '.matches'
    ) as HTMLElement;
    expect(strict.page.hintsOnly()).toBe(false);
    expect(strictPanel.classList.contains('hints')).toBe(false);
    expect(strictPanel.textContent).toContain('harvest.places.match.heading');
  });

  it('draws no candidates panel for a place with none', async () => {
    const { fixture, page } = await render(DIA);

    expect(page.candidates()).toBeNull();
    expect(fixture.nativeElement.querySelector('.matches')).toBeNull();
  });

  it('links the place to the candidate, with no import first', async () => {
    const { fixture, page, calls } = await render(OESTE);

    fixture.nativeElement.querySelector('.matches li button').click();
    await drain();

    expect(named(calls, 'importPlace')).toHaveLength(0);
    expect(named(calls, 'linkPlace')).toEqual([
      [OESTE, { supermarketLocationId: 'loc_cordoba_oeste' }],
    ]);
    expect(page.queue.items().some((place) => place.id === OESTE)).toBe(false);
  });
});

/**
 * Admin plan 0061, target 4: "Link to an existing shop", with the shop picker
 * of one chain. Nothing is sent before the press on "Link".
 */
describe('the places queue, linking to a shop a person picks', () => {
  const pickers = (fixture: ComponentFixture<PlacesQueuePage>) =>
    fixture.debugElement
      .queryAll(By.directive(ReferencePicker))
      .map((node) => node.componentInstance as ReferencePicker);
  const picker = (fixture: ComponentFixture<PlacesQueuePage>, id: string) =>
    pickers(fixture).find((found) => found.controlId() === id) ?? null;

  it('offers the control on every open place, and opens no picker until it is pressed', async () => {
    const { fixture, page } = await render(DIA);

    expect(page.linking()).toBeNull();
    expect(picker(fixture, 'places-link-shop')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-link-start]').textContent
    ).toContain('harvest.places.link.start');
  });

  it('asks for a chain first when nothing names one', async () => {
    const { fixture, page } = await render(DIA);

    fixture.nativeElement.querySelector('[data-link-start]').click();
    fixture.detectChanges();

    expect(page.linkChain()).toBe('');
    expect(picker(fixture, 'places-link-chain')?.resource()).toBe(
      'supermarkets'
    );
    expect(picker(fixture, 'places-link-shop')).toBeNull();
    expect(text(fixture)).toContain('harvest.places.link.chainFirst');
  });

  it('opens the shop picker of the chain that is named, and no other chain', async () => {
    const { fixture, page } = await render(DIA);

    page.startLinking();
    page.chooseLinkChain(MERCADONA);
    fixture.detectChanges();

    const shops = picker(fixture, 'places-link-shop');
    expect(shops?.resource()).toBe('locations');
    expect(shops?.scope()).toEqual({ supermarketId: MERCADONA });
  });

  it('opens on the chain of the first candidate', async () => {
    const { fixture, page } = await render(OESTE);

    page.startLinking();
    fixture.detectChanges();

    expect(page.linkChain()).toBe(MERCADONA);
    expect(picker(fixture, 'places-link-shop')?.scope()).toEqual({
      supermarketId: MERCADONA,
    });
  });

  /**
   * A place of a chain the catalog holds, with no shop near it: the form
   * opens on that chain, found by the brand key the place carries.
   */
  it('opens on the chain whose brand key the place carries, with no candidate', async () => {
    const { fixture, page } = await render(CARREFOUR);
    expect(page.candidates()).toBeNull();

    page.startLinking();
    await settle(fixture);

    expect(page.linkChain()).toBe('sm_carrefour');
    expect(picker(fixture, 'places-link-shop')?.scope()).toEqual({
      supermarketId: 'sm_carrefour',
    });
  });

  it('opens on the chain the chain picker holds, before the candidate', async () => {
    const { page } = await render(OESTE);

    page.chooseChain('sm_consum');
    page.startLinking();

    expect(page.linkChain()).toBe('sm_consum');
  });

  it('shows the picked shop with its address, and sends nothing', async () => {
    const { fixture, page, calls } = await render(DIA);

    page.startLinking();
    page.chooseLinkChain(MERCADONA);
    await page.pickShop('loc_sierra');
    fixture.detectChanges();

    const picked = fixture.nativeElement.querySelector(
      '.picked'
    ) as HTMLElement;
    expect(picked.textContent).toContain('Carretera de Trassierra km 8');
    expect(picked.textContent).toContain('harvest.places.link.submit');
    expect(named(calls, 'linkPlace')).toHaveLength(0);
    expect(page.queue.current()?.id).toBe(DIA);
  });

  it('links to the picked shop when "Link" is pressed', async () => {
    const { fixture, page, calls } = await render(DIA);

    page.startLinking();
    page.chooseLinkChain(MERCADONA);
    await page.pickShop('loc_sierra');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-link-picked]').click();
    await drain();

    expect(named(calls, 'linkPlace')).toEqual([
      [DIA, { supermarketLocationId: 'loc_sierra' }],
    ]);
    expect(page.queue.items().some((place) => place.id === DIA)).toBe(false);
  });

  it('forgets the picked shop when the chain changes', async () => {
    const { page } = await render(DIA);

    page.startLinking();
    page.chooseLinkChain(MERCADONA);
    await page.pickShop('loc_sierra');
    page.chooseLinkChain('sm_consum');

    expect(page.linking()?.shop).toBeNull();
  });

  it('clears the link form when another place comes up', async () => {
    const { page } = await render(DIA);

    page.startLinking();
    page.chooseLinkChain(MERCADONA);
    await page.pickShop('loc_sierra');
    page.skip();

    expect(page.queue.current()?.id).not.toBe(DIA);
    expect(page.linking()).toBeNull();

    // And it is not the form of the place when it comes back in front.
    page.open(DIA);
    expect(page.linking()).toBeNull();
  });
});

/** Admin plan 0061, target 5: each shop of the nearby panel links. */
describe('the places queue, linking from the nearby panel', () => {
  /** A shop of the chain that is near and that no rule named above. */
  const NEAR_SHOP = {
    id: 'loc_consum_centro',
    title: 'Consum Centro',
    address: 'Calle Cruz Conde 20',
    city: 'Córdoba',
    postalCode: '14003',
    metres: 120,
  };

  it('draws a link button on each nearby shop, and links to that shop', async () => {
    const { fixture, page, calls } = await render(DIA);
    page.catalogNear.set([NEAR_SHOP]);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector(
      '.near .catalog li button'
    ) as HTMLButtonElement;
    expect(button.textContent).toContain('harvest.places.match.link');
    expect(button.classList.contains('quiet')).toBe(true);

    button.click();
    await drain();

    expect(named(calls, 'linkPlace')).toEqual([
      [DIA, { supermarketLocationId: 'loc_consum_centro' }],
    ]);
    expect(page.queue.items().some((place) => place.id === DIA)).toBe(false);
  });

  it('does not list a shop that is a candidate above', async () => {
    const { fixture, page } = await render(OESTE);
    page.catalogNear.set([
      { ...NEAR_SHOP, id: 'loc_cordoba_oeste', title: 'The candidate' },
      NEAR_SHOP,
    ]);
    fixture.detectChanges();

    expect(page.catalogOthers().map((shop) => shop.id)).toEqual([
      'loc_consum_centro',
    ]);
    expect(
      fixture.nativeElement.querySelector('.near .catalog').textContent
    ).not.toContain('The candidate');
  });
});

/**
 * Admin plan 0061, target 6: a place that names another chain than the shop
 * is asked about once, and `acrossChains` is sent only after "Link anyway".
 */
describe('the places queue, a place that names another chain', () => {
  async function asked() {
    const rendered = await render(CARREFOUR);
    const { fixture, page } = rendered;
    page.startLinking();
    page.chooseLinkChain(MERCADONA);
    await page.pickShop('loc_sierra');
    await page.linkPicked();
    fixture.detectChanges();
    return rendered;
  }

  it('keeps the place in front and asks, naming the chain', async () => {
    const { fixture, page, calls } = await asked();

    expect(page.queue.current()?.id).toBe(CARREFOUR);
    expect(page.queue.items().some((place) => place.id === CARREFOUR)).toBe(
      true
    );
    expect(named(calls, 'linkPlace')).toEqual([
      [CARREFOUR, { supermarketLocationId: 'loc_sierra' }],
    ]);
    expect(page.question()).toEqual({
      placeId: CARREFOUR,
      shop: { id: 'loc_sierra', title: 'Carretera de Trassierra km 8' },
      chain: 'Carrefour',
    });
    const ask = fixture.nativeElement.querySelector('.ask') as HTMLElement;
    expect(ask.getAttribute('role')).toBe('alert');
    expect(ask.textContent).toContain('harvest.places.otherChain.ask');
    expect(ask.textContent).toContain('harvest.places.otherChain.confirm');
    // The question is the answer, so no sentence sits above the queue too.
    expect(page.errorKey()).toBeNull();
    expect(page.notice()).toBeNull();
  });

  it('sends the same shop with acrossChains on "Link anyway", once', async () => {
    const { fixture, page, calls } = await asked();

    fixture.nativeElement.querySelector('[data-link-anyway]').click();
    await drain();
    fixture.detectChanges();

    expect(named(calls, 'linkPlace')).toEqual([
      [CARREFOUR, { supermarketLocationId: 'loc_sierra' }],
      [CARREFOUR, { supermarketLocationId: 'loc_sierra', acrossChains: true }],
    ]);
    expect(page.queue.items().some((place) => place.id === CARREFOUR)).toBe(
      false
    );
    expect(fixture.nativeElement.querySelector('.ask')).toBeNull();
    expect(page.notice()?.key).toBe('harvest.places.linked.filled');
  });

  it('sends nothing more on "Cancel", and says nothing above the queue', async () => {
    const { fixture, page, calls } = await asked();

    fixture.nativeElement.querySelector('[data-cancel-question]').click();
    fixture.detectChanges();

    expect(named(calls, 'linkPlace')).toHaveLength(1);
    expect(page.question()).toBeNull();
    expect(page.errorKey()).toBeNull();
    expect(page.queue.current()?.id).toBe(CARREFOUR);
    expect(fixture.nativeElement.querySelector('.ask')).toBeNull();
  });

  it('never sends acrossChains on a first link', async () => {
    const { page, calls } = await render(OESTE);

    await page.link(front(page).candidates[0] as never);

    expect(named(calls, 'linkPlace')[0][1]).not.toHaveProperty('acrossChains');
  });

  it('does not carry the question onto another place', async () => {
    const { page } = await asked();

    page.skip();

    expect(page.queue.current()?.id).not.toBe(CARREFOUR);
    expect(page.question()).toBeNull();
  });
});

/** Admin plan 0061, target 7: the link says what it filled. */
describe('the places queue, what a link filled', () => {
  it('names the fields the link filled, and the place and the shop', async () => {
    const { fixture, page } = await render(TRASSIERRA);
    const words = jest.spyOn(page, 'words');

    fixture.nativeElement.querySelector('.matches li button').click();
    await drain();
    fixture.detectChanges();

    expect(page.queue.current()?.id).not.toBe(TRASSIERRA);
    expect(page.notice()).toEqual(
      expect.objectContaining({
        key: 'harvest.places.linked.filled',
        args: expect.objectContaining({
          // The name and the street, since the name alone does not say
          // which place of a chain it was.
          place: 'Mercadona Trassierra (Carretera de Trassierra km 8)',
          shop: 'Carretera de Trassierra km 8',
        }),
      })
    );
    // The city and the postal code, in the order the sentence names them.
    expect(words).toHaveBeenCalledWith([
      'harvest.places.linked.field.CITY',
      'harvest.places.linked.field.POSTAL_CODE',
    ]);
    const said = fixture.nativeElement.querySelector('.linked') as HTMLElement;
    expect(said.getAttribute('role')).toBe('status');
    expect(said.textContent).toContain('harvest.places.linked.filled');
  });

  it('says so when the shop already held everything', async () => {
    const { fixture, page } = await render(LIBERTADOR);

    fixture.nativeElement.querySelector('.matches li button').click();
    await drain();
    fixture.detectChanges();

    expect(page.notice()?.key).toBe('harvest.places.linked.nothing');
    expect(
      fixture.nativeElement.querySelector('.linked').textContent
    ).toContain('harvest.places.linked.nothing');
  });

  it('joins one field, two fields and three in words', async () => {
    const { page } = await render();

    expect(page.words([])).toBe('');
    expect(page.words(['a'])).toBe('a');
    // The testing translator answers the key, so the joined sentence is its
    // key: the joining word is a translation and not a literal.
    expect(page.words(['a', 'b', 'c'])).toBe('harvest.places.linked.list');
  });

  it('takes the sentence away when another place comes up', async () => {
    const { fixture, page } = await render(TRASSIERRA);
    fixture.nativeElement.querySelector('.matches li button').click();
    await drain();
    expect(page.notice()).not.toBeNull();

    page.skip();
    fixture.detectChanges();

    expect(page.notice()).toBeNull();
    expect(fixture.nativeElement.querySelector('.linked')).toBeNull();
  });

  it('reads the counts again after a link', async () => {
    const { fixture, page } = await render(OESTE);
    const before = dashboardReads;

    fixture.nativeElement.querySelector('.matches li button').click();
    await settle(fixture);

    expect(page.queue.error()).toBeNull();
    expect(dashboardReads).toBe(before + 1);
  });
});

/** An error from the gateway is shown, and nothing is marked linked. */
describe('the places queue, a link the gateway refuses', () => {
  const broken = () =>
    Promise.reject(
      new GatewayError({ code: 'internal', status: 500, correlationId: 'c-1' })
    );

  it('keeps the place in front, shows the failure, and says nothing was linked', async () => {
    const { fixture, page } = await render(OESTE, undefined, {
      overrides: { linkPlace: broken },
    });
    const before = dashboardReads;

    fixture.nativeElement.querySelector('.matches li button').click();
    await drain();
    fixture.detectChanges();

    expect(page.queue.current()?.id).toBe(OESTE);
    expect(page.queue.items().some((place) => place.id === OESTE)).toBe(true);
    expect(page.notice()).toBeNull();
    expect(page.question()).toBeNull();
    expect(page.errorKey()).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('.failure[role="alert"]').textContent
    ).toContain(page.errorKey());
    expect(fixture.nativeElement.querySelector('.linked')).toBeNull();
    // The candidate is still offered, and the rail was not told otherwise.
    expect(fixture.nativeElement.querySelector('.matches')).not.toBeNull();
    expect(dashboardReads).toBe(before);
  });
});

/**
 * Admin plan 0061, target 8: the bulk act. The dry answer is on screen before
 * anything is linked, and `apply` is sent by the button under it and by
 * nothing else.
 */
describe('the places queue, linking the places that shops were made from', () => {
  const tool = (fixture: ComponentFixture<PlacesQueuePage>) =>
    fixture.nativeElement.querySelector(
      '[data-tool="by-ref"]'
    ) as HTMLButtonElement;
  const applyButton = (fixture: ComponentFixture<PlacesQueuePage>) =>
    fixture.nativeElement.querySelector(
      '[data-apply]'
    ) as HTMLButtonElement | null;

  async function previewed(overrides?: Overrides) {
    const rendered = await render(undefined, undefined, { overrides });
    tool(rendered.fixture).click();
    await drain();
    rendered.fixture.detectChanges();
    return rendered;
  }

  it('is a control in the header of the queue that asks nothing until pressed', async () => {
    const { fixture, page, calls } = await render();

    expect(tool(fixture).textContent).toContain('harvest.places.byRef.start');
    expect(
      fixture.nativeElement.querySelector('lib-queue-frame header .tools')
        .children
    ).toContain(tool(fixture));
    expect(named(calls, 'linkPlacesByRef')).toHaveLength(0);
    expect(page.byRefOpen()).toBe(false);
    expect(fixture.nativeElement.querySelector('.byref')).toBeNull();
  });

  it('shows the dry answer first: one line for each place with its shop', async () => {
    const { fixture, page, calls } = await previewed();

    // The one request so far carries no `apply`.
    expect(named(calls, 'linkPlacesByRef')).toEqual([[{}]]);
    expect(page.byRef()?.linked).toEqual([
      {
        placeId: OESTE,
        place: 'Mercadona',
        where: 'Calle Historiador Domínguez Ortiz 4, Córdoba',
        shop: 'Calle Historiador Domínguez Ortiz 4',
        filledKeys: ['harvest.places.linked.field.POSTAL_CODE'],
      },
    ]);
    const panel = fixture.nativeElement.querySelector('.byref') as HTMLElement;
    expect(panel.querySelectorAll('.pairs li')).toHaveLength(1);
    expect(panel.textContent).toContain('harvest.places.byRef.lead');
    expect(panel.textContent).toContain('harvest.places.byRef.fills');
    expect(applyButton(fixture)?.textContent).toContain(
      'harvest.places.byRef.apply'
    );
    // Nothing is linked yet.
    expect(page.queue.items().some((place) => place.id === OESTE)).toBe(true);
  });

  it('never applies without the preview on screen', async () => {
    const { page, calls } = await render();

    await page.applyByRef();

    expect(named(calls, 'linkPlacesByRef')).toHaveLength(0);
  });

  it('never applies once the preview is closed', async () => {
    const { fixture, page, calls } = await previewed();

    fixture.nativeElement.querySelector('[data-close]').click();
    await page.applyByRef();

    expect(named(calls, 'linkPlacesByRef')).toEqual([[{}]]);
    expect(page.byRefOpen()).toBe(false);
  });

  it('applies on the press under the preview, then reads the queue and the counts again', async () => {
    const { fixture, page, calls } = await previewed();
    const reads = named(calls, 'listPlaces').length;
    const counts = dashboardReads;

    applyButton(fixture)?.click();
    await settle(fixture);
    await settle(fixture);

    expect(named(calls, 'linkPlacesByRef')).toEqual([[{}], [{ apply: true }]]);
    expect(named(calls, 'listPlaces').length).toBe(reads + 1);
    expect(dashboardReads).toBe(counts + 1);
    expect(page.queue.items().some((place) => place.id === OESTE)).toBe(false);
    expect(page.queue.items()).toHaveLength(6);
    expect(page.byRefOpen()).toBe(false);
    expect(page.notice()).toEqual(
      expect.objectContaining({
        key: 'harvest.places.byRef.done',
        args: { count: 1 },
      })
    );
    expect(
      fixture.nativeElement.querySelector('.linked').textContent
    ).toContain('harvest.places.byRef.done');
  });

  it('says so, and offers no button, when there is nothing to link', async () => {
    const { fixture } = await previewed({
      linkPlacesByRef: async () => ({
        applied: false,
        linked: [],
        skipped: [],
      }),
    });

    const panel = fixture.nativeElement.querySelector('.byref') as HTMLElement;
    expect(panel.textContent).toContain('harvest.places.byRef.none');
    expect(applyButton(fixture)).toBeNull();
  });

  it('lists a skipped place with the reason', async () => {
    const answer = async (): Promise<Wire.HarvestLinkPlacesByRefResult> => {
      const memory = new HarvestMemory();
      const page = await memory.listPlaces({ status: 'NEW', limit: 100 });
      const place = page.items[0];
      return {
        applied: false,
        linked: [],
        skipped: [{ place, reason: 'PROVIDER_NOT_NAMED', shops: [] }],
      };
    };
    const { fixture } = await previewed({ linkPlacesByRef: answer });

    const panel = fixture.nativeElement.querySelector('.byref') as HTMLElement;
    expect(panel.textContent).toContain('harvest.places.byRef.skipped');
    expect(panel.textContent).toContain(
      'harvest.places.byRef.reason.PROVIDER_NOT_NAMED'
    );
    expect(panel.textContent).toContain('Dia Market');
    // A skipped place is not a place to link.
    expect(applyButton(fixture)).toBeNull();
  });

  it('shows a failed read of the preview, and offers no button', async () => {
    const { fixture, page } = await previewed({
      linkPlacesByRef: () =>
        Promise.reject(
          new GatewayError({ code: 'internal', status: 500, correlationId: '' })
        ),
    });

    expect(page.byRef()).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.byref .refused[role="alert"]')
    ).not.toBeNull();
    expect(applyButton(fixture)).toBeNull();
  });

  it('shows a failed apply, and says nothing was linked', async () => {
    const memory = new HarvestMemory();
    const { fixture, page } = await previewed({
      linkPlacesByRef: (input) =>
        input.apply === true
          ? Promise.reject(
              new GatewayError({
                code: 'internal',
                status: 500,
                correlationId: '',
              })
            )
          : memory.linkPlacesByRef(input),
    });

    applyButton(fixture)?.click();
    await settle(fixture);
    await settle(fixture);

    expect(page.byRefErrorKey()).toBe('harvest.places.byRef.failed');
    expect(page.notice()).toBeNull();
    expect(fixture.nativeElement.querySelector('.linked')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.byref .refused').textContent
    ).toContain('harvest.places.byRef.failed');
    expect(page.queue.items().some((place) => place.id === OESTE)).toBe(true);
  });
});
