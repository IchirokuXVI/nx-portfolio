import { provideLocationMocks } from '@angular/common/testing';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DASHBOARD_SEED,
  DASHBOARD_SERVICE,
  dashboardSeedWithout,
  type DashboardDocument,
} from '@portfolio/luna-shopper-admin/data-access';
import { provideSections } from '@portfolio/luna-shopper-admin/feature-resource';
import {
  defineResource,
  type AnyResourceDescriptor,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import {
  BarChart,
  LineChart,
  RunProgressView,
  RunRowView,
  Viewport,
} from '@portfolio/luna-shopper-admin/ui';
import { DashboardPage, FEED_ROWS_ON_A_PHONE } from './dashboard-page';

/** The chains the seed's queues name, so a spec can assert a link on one. */
const MERCADONA = '11111111-1111-4111-8111-111111111111';
const CARREFOUR = '22222222-2222-4222-8222-222222222222';
const DEZA = '33333333-3333-4333-8333-333333333333';

interface Row extends ResourceRow {
  id: string;
}

/**
 * A descriptor with nothing behind it.
 *
 * The tiles ask the registry where a resource is mounted, so the sections have
 * to be real even though no gateway is ever called: a resolver that answered
 * `null` everywhere would prove the tiles draw and prove nothing about where
 * they go.
 */
function descriptor(name: string): AnyResourceDescriptor {
  return defineResource<Row>({
    name,
    segment: name,
    labels: { one: `${name}.one`, many: `${name}.many` },
    title: (row) => row.id,
    fields: [],
    list: { columns: [], compact: [] },
    gateway: () => {
      throw new Error('not used');
    },
  });
}

/** The mount of admin plan 0022, as far as the overview's links reach into it. */
const SECTIONS = [
  {
    key: 'products',
    label: 'shell.sections.products',
    segment: 'catalog',
    resources: [descriptor('items')],
  },
  {
    key: 'shoppers',
    label: 'shell.sections.shoppers',
    segment: 'shoppers',
    resources: [descriptor('zones')],
  },
  {
    key: 'harvest',
    label: 'shell.sections.harvest',
    segment: 'harvest',
    resources: [descriptor('postal-codes')],
  },
];

/** Let every pending microtask settle. `whenStable` hangs on a polling store. */
async function settle(fixture: ComponentFixture<DashboardPage>): Promise<void> {
  for (let pass = 0; pass < 4; pass += 1) {
    await Promise.resolve();
  }
  fixture.detectChanges();
}

async function render(
  document: DashboardDocument = DASHBOARD_SEED,
  compact = false
): Promise<ComponentFixture<DashboardPage>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [DashboardPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      provideRouter([]),
      provideLocationMocks(),
      // The sections are real and their gateways are not, so a chain resolves
      // to nothing and shows its id, which is the state plan 0007 section 4
      // describes and the one a spec can have without a backend.
      provideSections(...SECTIONS),
      { provide: DASHBOARD_SERVICE, useValue: { read: async () => document } },
      // jsdom matches no media query, so a phone is said and not measured.
      {
        provide: Viewport,
        useValue: { compact: signal(compact), split: signal(!compact) },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(DashboardPage);
  fixture.detectChanges();
  await settle(fixture);
  return fixture;
}

function texts(
  fixture: ComponentFixture<DashboardPage>,
  selector: string
): (string | undefined)[] {
  return fixture.debugElement
    .queryAll(By.css(selector))
    .map((node) => (node.nativeElement as HTMLElement).textContent?.trim());
}

function element(
  fixture: ComponentFixture<DashboardPage>,
  selector: string
): HTMLElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector(selector);
}

afterEach(() => TestBed.resetTestingModule());

/**
 * The seeded dashboard, which is the one a screenshot is taken of and the one
 * anybody running this app with nothing listening sees.
 *
 * A count is asserted on the view model rather than on rendered text wherever
 * a sentence carries it: the testing translator answers with the key and does
 * not interpolate.
 */
describe('DashboardPage against the seed', () => {
  /**
   * Admin plan 0046, targets 1 to 3: what waits, then the numbers of each
   * area, then what changed. The failed sign ins are a tab of Admins (target
   * 5), so no part of this page is theirs.
   */
  it('draws what waits, the three panels and the feed, and nothing else', async () => {
    const fixture = await render();

    expect(texts(fixture, 'h2')).toEqual([
      'dashboard.waiting.heading',
      'dashboard.catalog.heading',
      'dashboard.shoppers.heading',
      'dashboard.harvest.heading',
      'dashboard.activity.heading',
    ]);
  });

  /** The page has the one header, with when the numbers were read and Refresh. */
  it('says when the numbers were read, in the header', async () => {
    const fixture = await render();

    expect(fixture.componentInstance.measured()?.exact).not.toBe('');
    expect(element(fixture, 'lib-page-header .taken')?.textContent).toContain(
      'dashboard.measuredAt'
    );
    expect(
      element(fixture, 'lib-page-header button[pageAction]')?.textContent
    ).toContain('dashboard.refresh');
  });

  /** Target 1: the tiles that exist, each once, in the order of the mock. */
  it('draws the seven tiles of what waits', async () => {
    const fixture = await render();

    expect(fixture.componentInstance.waiting().map((tile) => tile.key)).toEqual(
      [
        'entries',
        'shops',
        'places',
        'memberships',
        'postalCodes',
        'stale',
        'loginFailures',
      ]
    );
    expect(
      fixture.debugElement
        .queryAll(By.css('.tiles [data-tile]'))
        .map((node) => node.attributes['data-tile'])
    ).toEqual([
      'entries',
      'shops',
      'places',
      'memberships',
      'postalCodes',
      'stale',
      'loginFailures',
    ]);
  });

  it('carries the seeded counts on the tiles', async () => {
    const fixture = await render();
    const byKey = new Map(
      fixture.componentInstance.waiting().map((tile) => [tile.key, tile])
    );

    // The two per chain queues are one tile each: the sum of their chains.
    expect(byKey.get('entries')?.value).toBe(66);
    expect(byKey.get('shops')?.value).toBe(4);
    expect(byKey.get('places')?.value).toBe(7);
    expect(byKey.get('memberships')?.value).toBe(3);
    expect(byKey.get('stale')?.value).toBe(623);
    expect(byKey.get('loginFailures')?.value).toBe(2);
  });

  /**
   * The chains and their counts are the second line of the tile. The seed
   * gives one of the three chains an empty queue, on purpose, and that chain
   * is not named. A chain the reference cannot name shows its id (plan 0007,
   * section 4).
   */
  it('names the chains of a per chain queue on its second line', async () => {
    const fixture = await render();
    const entries = fixture.componentInstance
      .waiting()
      .find((tile) => tile.key === 'entries');

    expect(entries?.caption).toBe(`${MERCADONA} 60, ${DEZA} 6`);
    expect(entries?.caption).not.toContain(CARREFOUR);
    expect(element(fixture, '[data-tile="entries"] .tile-caption')).not.toBe(
      null
    );
    expect(fixture.componentInstance.chainName(MERCADONA)).toBe(MERCADONA);
  });

  /** A tile with a count above zero takes the waiting wash. One at zero stays, plain. */
  it('puts the waiting wash on a tile only when something waits', async () => {
    const fixture = await render({
      ...DASHBOARD_SEED,
      core:
        DASHBOARD_SEED.core === null
          ? null
          : { ...DASHBOARD_SEED.core, memberships: { pending: 0 } },
    });

    expect(
      element(fixture, '[data-tile="memberships"]')?.classList.contains('wait')
    ).toBe(false);
    expect(
      element(fixture, '[data-tile="entries"]')?.classList.contains('wait')
    ).toBe(true);
  });

  /**
   * Each tile links to its place: the Review queues, the Zones with a request,
   * the postal codes, the products, and the failed sign ins of Admins.
   */
  it('links each tile where the work is done', async () => {
    const fixture = await render();
    const href = (key: string) =>
      element(fixture, `a[data-tile="${key}"]`)?.getAttribute('href');

    expect(href('entries')).toBe('/harvest/review/products');
    expect(href('shops')).toBe('/harvest/review/shops');
    expect(href('places')).toBe('/harvest/review/places');
    expect(href('memberships')).toBe('/shoppers/zones?hasPending=true');
    expect(href('postalCodes')).toBe('/harvest/postal-codes');
    expect(href('stale')).toBe('/catalog/items');
    expect(href('loginFailures')).toBe('/admins/failed-sign-ins');
  });

  /** Target 2: chains, shops, products, groups, priced, and one chart. */
  it('draws the catalog panel, with its numbers and its one chart', async () => {
    const fixture = await render();
    const panel = fixture.debugElement.query(By.css('[data-catalog-block]'));

    expect(fixture.componentInstance.catalog().map((stat) => stat.key)).toEqual(
      ['supermarkets', 'locations', 'items', 'productGroups', 'priced']
    );
    expect(
      panel
        .queryAll(By.css('[data-stat]'))
        .map((node) => node.attributes['data-stat'])
    ).toEqual([
      'supermarkets',
      'locations',
      'items',
      'productGroups',
      'priced',
    ]);
    expect(panel.queryAll(By.directive(LineChart))).toEqual([]);
    expect(panel.queryAll(By.directive(BarChart))).toHaveLength(1);
    expect(
      fixture.componentInstance.pricesWritten().bars.length
    ).toBeGreaterThan(0);
  });

  /** A number links to its list, where the app mounted one. */
  it('links a number to its list', async () => {
    const fixture = await render();

    expect(
      element(fixture, '[data-stat="items"] a')?.getAttribute('href')
    ).toBe('/catalog/items');
    // A resource this spec's sections did not mount is a number with no link.
    expect(element(fixture, '[data-stat="supermarkets"] a')).toBeNull();
    expect(element(fixture, '[data-stat="supermarkets"] dd')).not.toBeNull();
  });

  /** Target 2: people, zones, lists, being shopped, and the chart of sign ups. */
  it('draws the shoppers panel, with its numbers and the chart of sign ups', async () => {
    const fixture = await render();
    const panel = fixture.debugElement.query(By.css('[data-shoppers-block]'));

    expect(
      fixture.componentInstance.shoppers().map((stat) => stat.key)
    ).toEqual(['users', 'zones', 'lists', 'beingShopped']);
    expect(panel.queryAll(By.directive(LineChart))).toHaveLength(1);
    expect(panel.queryAll(By.directive(BarChart))).toEqual([]);
  });

  /**
   * Target 2: runs in the window, running, failed, and how many chains may be
   * fetched. The window is the gateway's: thirty days in the seed.
   */
  it('draws the harvest panel, with four numbers and no chart', async () => {
    const fixture = await render();
    const panel = fixture.debugElement.query(By.css('[data-harvest-block]'));

    expect(fixture.componentInstance.days()).toBe(30);
    expect(
      fixture.componentInstance
        .harvest()
        .map((stat) => [stat.key, stat.value, stat.of])
    ).toEqual([
      ['inWindow', 14, null],
      ['running', 1, null],
      ['failed', 6, null],
      ['sources', 3, 4],
    ]);
    expect(panel.queryAll(By.directive(BarChart))).toEqual([]);
    expect(
      element(fixture, '[data-stat="failed"] dd')?.classList.contains('danger')
    ).toBe(true);
    expect(
      element(fixture, '[data-stat="inWindow"] a')?.getAttribute('href')
    ).toBe('/harvest/runs');
  });

  /** A chart is a chart component of the ui library, and a tile is drawn here. */
  it('draws two charts and no run', async () => {
    const fixture = await render();

    expect(fixture.debugElement.queryAll(By.directive(BarChart))).toHaveLength(
      1
    );
    expect(fixture.debugElement.queryAll(By.directive(LineChart))).toHaveLength(
      1
    );
    expect(
      fixture.debugElement.query(By.directive(RunProgressView))
    ).toBeNull();
    expect(fixture.debugElement.queryAll(By.directive(RunRowView))).toEqual([]);
  });

  /** Target 3: the feed as a list, each row when and who did what. */
  it('draws the twenty rows of the feed as a list', async () => {
    const fixture = await render();

    expect(fixture.componentInstance.activity()).toHaveLength(20);
    expect(
      fixture.debugElement.queryAll(By.css('.feed li [data-change]'))
    ).toHaveLength(20);
    expect(fixture.debugElement.query(By.css('.feed table'))).toBeNull();
  });

  /** A feed row opens at wherever its section mounted the screen, when it can. */
  it('opens a feed row through the section that holds it', async () => {
    const fixture = await render();
    const opened = fixture.componentInstance
      .activity()
      .map((row) => row.link)
      .filter((link): link is readonly string[] => link !== null);

    expect(opened.length).toBeGreaterThan(0);
    for (const link of opened) {
      expect(['catalog', 'shoppers']).toContain(link[1]);
    }
    expect(
      fixture.debugElement.queryAll(By.css('.feed a[data-change]'))
    ).toHaveLength(opened.length);
    expect(
      fixture.debugElement.queryAll(By.css('.feed p[data-change]'))
    ).toHaveLength(20 - opened.length);
  });

  /**
   * The overview does not draw the run in flight, so it does not ask for the
   * fast poll. A run that started at midnight used to make every screen in the
   * app re-read four times a minute.
   */
  it('leaves the store on the slow interval', async () => {
    const fixture = await render();

    expect(fixture.componentInstance.store.runInFlight()).toBe(true);
    expect(fixture.componentInstance.store.interval()).toBe(60_000);
  });
});

/**
 * On a phone (admin plan 0046, target 2 and the `Phone-Overview` board): the
 * feed comes before the numbers, and each numbers panel is a row that opens.
 */
describe('DashboardPage on a phone', () => {
  it('draws each numbers panel as a row that opens', async () => {
    const fixture = await render(DASHBOARD_SEED, true);
    const panels = fixture.debugElement.queryAll(By.css('details.panel'));

    expect(texts(fixture, 'details.panel > summary')).toEqual([
      'dashboard.catalog.numbers',
      'dashboard.shoppers.numbers',
      'dashboard.harvest.numbers',
    ]);
    expect(
      panels.map((panel) => (panel.nativeElement as HTMLDetailsElement).open)
    ).toEqual([false, false, false]);
    // The numbers are in the row, for when it opens.
    expect(
      panels[0]
        .queryAll(By.css('[data-stat]'))
        .map((node) => node.attributes['data-stat'])
    ).toEqual([
      'supermarkets',
      'locations',
      'items',
      'productGroups',
      'priced',
    ]);
  });

  it('puts what changed before the numbers', async () => {
    const fixture = await render(DASHBOARD_SEED, true);
    const columns = element(fixture, '.columns');

    expect(columns?.firstElementChild?.classList.contains('feed')).toBe(true);
    expect(columns?.lastElementChild?.classList.contains('numbers')).toBe(true);
  });

  it('shows the first rows of the feed, and all of them when asked', async () => {
    const fixture = await render(DASHBOARD_SEED, true);
    const rows = () =>
      fixture.debugElement.queryAll(By.css('.feed [data-change]')).length;
    const all = element(fixture, '.feed button.all');

    expect(rows()).toBe(FEED_ROWS_ON_A_PHONE);
    expect(all?.getAttribute('aria-expanded')).toBe('false');

    all?.click();
    fixture.detectChanges();

    expect(rows()).toBe(20);
    expect(all?.getAttribute('aria-expanded')).toBe('true');
  });

  it('offers no "Show all" on a wide screen, where the whole feed is drawn', async () => {
    const fixture = await render();

    expect(element(fixture, '.feed button.all')).toBeNull();
  });
});

/**
 * A block that did not answer (plan 0016, section 5; admin plan 0046, target
 * 4): its panel says so and offers "Try again". Nothing else changes.
 */
describe('DashboardPage with a block that did not answer', () => {
  it('says so in the panel of that block, with a way to ask again', async () => {
    const fixture = await render(dashboardSeedWithout('harvest'));
    const notice = element(fixture, '[data-harvest-block] [data-down]');

    expect(notice?.getAttribute('data-down')).toBe('harvest');
    expect(notice?.textContent).toContain('dashboard.down.harvest');
    expect(notice?.querySelector('button')?.textContent).toContain(
      'dashboard.down.retry'
    );
    expect(fixture.componentInstance.harvest()).toEqual([]);
    // One block missing costs one block: the catalog's chart is still there.
    expect(fixture.debugElement.queryAll(By.directive(BarChart))).toHaveLength(
      1
    );
    expect(element(fixture, '[data-catalog-block] [data-down]')).toBeNull();
  });

  it('asks again when "Try again" is pressed', async () => {
    const fixture = await render(dashboardSeedWithout('catalog'));
    const read = jest.spyOn(fixture.componentInstance.store, 'load');

    element(fixture, '[data-catalog-block] [data-down] button')?.click();

    expect(read).toHaveBeenCalledTimes(1);
    expect(fixture.debugElement.queryAll(By.directive(BarChart))).toEqual([]);
  });

  /** People come from auth and the rest from core, and either can be down. */
  it('keeps the half of the shoppers panel whose service answered', async () => {
    const withoutCore = await render(dashboardSeedWithout('core'));
    expect(
      withoutCore.componentInstance.shoppers().map((stat) => stat.key)
    ).toEqual(['users']);
    expect(
      element(withoutCore, '[data-shoppers-block] [data-down]')?.getAttribute(
        'data-down'
      )
    ).toBe('core');
    expect(
      withoutCore.debugElement.queryAll(By.directive(LineChart))
    ).toHaveLength(1);

    const withoutAuth = await render(dashboardSeedWithout('identity'));
    expect(
      withoutAuth.componentInstance.shoppers().map((stat) => stat.key)
    ).toEqual(['zones', 'lists', 'beingShopped']);
    expect(withoutAuth.componentInstance.signUps()).toBeNull();
    expect(
      element(withoutAuth, '[data-shoppers-block] [data-down]')?.getAttribute(
        'data-down'
      )
    ).toBe('identity');
  });

  /**
   * The postal code tile survives a missing harvest block, and that is right.
   *
   * It is not in the document at all (admin plan 0021, section 6): it is one
   * call of its own, and a call that answered is a number worth showing whatever
   * the dashboard route managed to assemble.
   */
  it('keeps the tiles of every block that did answer', async () => {
    const fixture = await render(dashboardSeedWithout('harvest'));

    expect(fixture.componentInstance.waiting().map((tile) => tile.key)).toEqual(
      ['memberships', 'postalCodes', 'stale', 'loginFailures']
    );
  });

  it('names all four when every block is missing, and draws an empty feed', async () => {
    const fixture = await render({
      ...dashboardSeedWithout('identity', 'core', 'catalog', 'harvest'),
      activity: [],
    });

    expect(
      fixture.debugElement
        .queryAll(By.css('[data-down]'))
        .map((node) => node.attributes['data-down'])
    ).toEqual(['catalog', 'identity', 'core', 'harvest']);
    // The postal code tile is the one thing left, because it is the one number
    // on this row that does not come out of the document.
    expect(fixture.componentInstance.waiting().map((tile) => tile.key)).toEqual(
      ['postalCodes']
    );
    expect(fixture.componentInstance.activity()).toEqual([]);
    expect(element(fixture, '.feed .none')?.textContent).toContain(
      'dashboard.activity.none'
    );
  });
});

/**
 * A refresh that failed while there are numbers to keep (admin plan 0046,
 * target 4): one line says that the numbers are older than the time shown.
 */
describe('DashboardPage after a refresh that failed', () => {
  it('keeps the numbers and says in one line that they are old', async () => {
    let fail = false;
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [DashboardPage, RokuTranslatorTestingModule.forTesting()],
      providers: [
        ContentLocaleStore,
        provideRouter([]),
        provideLocationMocks(),
        provideSections(...SECTIONS),
        {
          provide: DASHBOARD_SERVICE,
          useValue: {
            read: async () => {
              if (fail) {
                throw new Error('nothing answered');
              }
              return DASHBOARD_SEED;
            },
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    await settle(fixture);
    expect(element(fixture, '.stale')).toBeNull();

    fail = true;
    fixture.componentInstance.refresh();
    await settle(fixture);

    expect(element(fixture, '.stale')?.textContent).toContain(
      'dashboard.stale'
    );
    expect(element(fixture, '.failed')).toBeNull();
    expect(fixture.componentInstance.waiting().length).toBeGreaterThan(0);
    fixture.componentInstance.store.stop();
  });
});

/**
 * A read that failed with nothing to keep, which is the one failure that takes
 * the screen over.
 */
describe('DashboardPage with nothing to draw', () => {
  it('draws the error state and the retry', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [DashboardPage, RokuTranslatorTestingModule.forTesting()],
      providers: [
        ContentLocaleStore,
        provideRouter([]),
        provideLocationMocks(),
        provideSections(...SECTIONS),
        {
          provide: DASHBOARD_SERVICE,
          useValue: {
            read: async () => {
              throw new Error('nothing answered');
            },
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    await settle(fixture);

    expect(fixture.debugElement.query(By.css('.failed'))).not.toBeNull();
    expect(fixture.componentInstance.store.empty()).toBe(true);
    fixture.componentInstance.store.stop();
  });
});
