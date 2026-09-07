import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
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
  StatTile,
} from '@portfolio/luna-shopper-admin/ui';
import { DashboardPage } from './dashboard-page';

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
    key: 'catalog',
    label: 'shell.sections.catalog',
    segment: 'catalog',
    resources: [descriptor('prices')],
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
  document: DashboardDocument = DASHBOARD_SEED
): Promise<ComponentFixture<DashboardPage>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [DashboardPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      provideLocationMocks(),
      // The sections are real and their gateways are not, so a chain resolves
      // to nothing and shows its id, which is the state plan 0007 section 4
      // describes and the one a spec can have without a backend.
      provideSections(...SECTIONS),
      { provide: DASHBOARD_SERVICE, useValue: { read: async () => document } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(DashboardPage);
  fixture.detectChanges();
  await settle(fixture);
  return fixture;
}

function tiles(fixture: ComponentFixture<DashboardPage>): StatTile[] {
  return fixture.debugElement
    .queryAll(By.directive(StatTile))
    .map((node) => node.componentInstance as StatTile);
}

afterEach(() => TestBed.resetTestingModule());

/**
 * The seeded dashboard, which is the one a screenshot is taken of and the one
 * anybody running this app with nothing listening sees.
 *
 * Every assertion here is on a component input rather than on rendered text: the
 * testing translator answers with the key and does not interpolate, so a tile's
 * count exists on `value()` and nowhere in the DOM.
 */
describe('DashboardPage against the seed', () => {
  /**
   * Three things, and each is a question about the whole tool rather than about
   * one part of it (admin plan 0022, section 6).
   */
  it('draws work waiting, the sign ins and the feed, and nothing else', async () => {
    const fixture = await render();
    const headings = fixture.debugElement
      .queryAll(By.css('h2'))
      .map((node) => (node.nativeElement as HTMLElement).textContent?.trim());

    expect(headings).toEqual([
      'dashboard.waiting.heading',
      'dashboard.signIns.heading',
      'dashboard.activity.heading',
    ]);
  });

  /**
   * The counts and the charts went to the section that owns them. A count of
   * users was here only because there was nowhere else for it.
   */
  it('draws no chart at all', async () => {
    const fixture = await render();

    expect(fixture.debugElement.queryAll(By.directive(LineChart))).toEqual([]);
    expect(fixture.debugElement.queryAll(By.directive(BarChart))).toEqual([]);
  });

  it('draws no run and no recent runs', async () => {
    const fixture = await render();

    expect(
      fixture.debugElement.query(By.directive(RunProgressView))
    ).toBeNull();
    expect(fixture.debugElement.queryAll(By.directive(RunRowView))).toEqual([]);
  });

  it('carries the seeded counts on the work waiting tiles', async () => {
    const fixture = await render();
    const waiting = fixture.componentInstance.waiting();
    const byKey = new Map(waiting.map((tile) => [tile.key, tile]));

    expect(byKey.get('memberships')?.value).toBe(3);
    expect(byKey.get(`entries-${MERCADONA}`)?.value).toBe(60);
    expect(byKey.get(`entries-${DEZA}`)?.value).toBe(6);
    expect(byKey.get(`shops-${MERCADONA}`)?.value).toBe(4);
    expect(byKey.get('places')?.value).toBe(7);
    expect(byKey.get('stale')?.value).toBe(623);
    expect(byKey.get('loginFailures')?.value).toBe(2);
  });

  /**
   * A resource tile goes wherever its section mounted the screen, and a hand
   * written screen keeps the segment constant it has always built from.
   */
  it('links each of them where the work is done', async () => {
    const fixture = await render();
    const byKey = new Map(
      fixture.componentInstance.waiting().map((tile) => [tile.key, tile])
    );

    expect(byKey.get('memberships')?.link).toEqual(['/', 'shoppers', 'zones']);
    expect(byKey.get(`entries-${MERCADONA}`)?.link).toEqual([
      '/',
      'harvest',
      'entries',
    ]);
    expect(byKey.get(`entries-${MERCADONA}`)?.query).toEqual({
      supermarketId: MERCADONA,
    });
    expect(byKey.get(`shops-${MERCADONA}`)?.link).toEqual([
      '/',
      'harvest',
      'shops',
    ]);
    expect(byKey.get('places')?.link).toEqual(['/', 'harvest', 'places']);
    expect(byKey.get('stale')?.link).toEqual(['/', 'catalog', 'prices']);
    expect(byKey.get('postalCodes')?.link).toEqual([
      '/',
      'harvest',
      'postal-codes',
    ]);
    expect(byKey.get('loginFailures')?.link).toBeNull();
  });

  /** The seed gives one of the three chains an empty queue, on purpose. */
  it('draws no tile for the chain with nothing waiting', async () => {
    const fixture = await render();
    const keys = fixture.componentInstance.waiting().map((tile) => tile.key);

    expect(keys).not.toContain(`entries-${CARREFOUR}`);
    expect(keys).not.toContain(`shops-${CARREFOUR}`);
  });

  it('draws the twenty rows of the feed', async () => {
    const fixture = await render();

    expect(fixture.componentInstance.activity()).toHaveLength(20);
  });

  /** A feed row opens at wherever its section mounted the screen. */
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
  });

  /** A chain the reference cannot name shows its id (plan 0007, section 4). */
  it('names a chain by its id when the reference cannot name it', async () => {
    const fixture = await render();

    expect(fixture.componentInstance.chainName(MERCADONA)).toBe(MERCADONA);
  });

  it('says when the numbers were taken', async () => {
    const fixture = await render();

    expect(fixture.componentInstance.measured()?.exact).not.toBe('');
  });

  /** Every tile is a link except the one whose rows are on this same page. */
  it('opens every tile that has somewhere to go', async () => {
    const fixture = await render();
    const anchors = tiles(fixture).filter((tile) => tile.link() !== undefined);

    expect(anchors.length).toBeGreaterThan(0);
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
 * A block that did not answer (plan 0016, section 5).
 *
 * The notice with its retry is on the section dashboard the block belongs to.
 * What the overview draws is a line naming the service, so a short row of tiles
 * is not read as "nothing is waiting".
 */
describe('DashboardPage with a block that did not answer', () => {
  it('names the service that did not answer beside the tiles', async () => {
    const fixture = await render(dashboardSeedWithout('harvest'));
    const missing = fixture.debugElement
      .queryAll(By.css('.missing li'))
      .map((node) => (node.nativeElement as HTMLElement).textContent?.trim());

    expect(missing).toEqual(['dashboard.down.harvest']);
  });

  /**
   * The postal code tile survives a missing harvest block, and that is right.
   *
   * It is not in the document at all (admin plan 0021, section 6): it is one
   * call of its own, and a call that answered is a number worth showing whatever
   * the dashboard route managed to assemble.
   */
  it('keeps the numbers of every block that did answer', async () => {
    const fixture = await render(dashboardSeedWithout('harvest'));
    const keys = fixture.componentInstance.waiting().map((tile) => tile.key);

    expect(keys).toEqual([
      'memberships',
      'stale',
      'loginFailures',
      'postalCodes',
    ]);
  });

  it('names all four when every block is missing, and draws an empty feed', async () => {
    const fixture = await render({
      ...dashboardSeedWithout('identity', 'core', 'catalog', 'harvest'),
      activity: [],
    });
    const missing = fixture.debugElement
      .queryAll(By.css('.missing li'))
      .map((node) => (node.nativeElement as HTMLElement).textContent?.trim());

    expect(missing).toEqual([
      'dashboard.down.identity',
      'dashboard.down.core',
      'dashboard.down.catalog',
      'dashboard.down.harvest',
    ]);
    // The postal code tile is the one thing left, because it is the one number
    // on this row that does not come out of the document.
    expect(fixture.componentInstance.waiting().map((tile) => tile.key)).toEqual(
      ['postalCodes']
    );
    expect(fixture.componentInstance.activity()).toEqual([]);
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
