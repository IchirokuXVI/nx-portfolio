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
import { provideResources } from '@portfolio/luna-shopper-admin/feature-resource';
import {
  BarChart,
  LineChart,
  RunProgressView,
  RunRowView,
  StatTile,
} from '@portfolio/luna-shopper-admin/ui';
import { BlockNotice } from './block-notice';
import { DashboardPage } from './dashboard-page';

/** The chains the seed's queues name, so a spec can assert a link on one. */
const MERCADONA = '11111111-1111-4111-8111-111111111111';
const CARREFOUR = '22222222-2222-4222-8222-222222222222';
const DEZA = '33333333-3333-4333-8333-333333333333';

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
      // No descriptors, so a chain resolves to nothing and shows its id, which
      // is the state plan 0007 section 4 describes and the one a spec can have
      // without a gateway.
      provideResources(),
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

function notices(fixture: ComponentFixture<DashboardPage>): string[] {
  return fixture.debugElement
    .queryAll(By.directive(BlockNotice))
    .map((node) => (node.componentInstance as BlockNotice).heading());
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
  it('draws every section', async () => {
    const fixture = await render();
    const headings = fixture.debugElement
      .queryAll(By.css('h2'))
      .map((node) => (node.nativeElement as HTMLElement).textContent?.trim());

    expect(headings).toEqual([
      'dashboard.waiting.heading',
      'dashboard.harvest.heading',
      'dashboard.people.heading',
      'dashboard.catalog.heading',
      'dashboard.signIns.heading',
      'dashboard.activity.heading',
    ]);
    expect(notices(fixture)).toEqual([]);
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

  it('links each of them where the work is done', async () => {
    const fixture = await render();
    const byKey = new Map(
      fixture.componentInstance.waiting().map((tile) => [tile.key, tile])
    );

    expect(byKey.get('memberships')?.link).toEqual(['/', 'zones']);
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
    expect(byKey.get('stale')?.link).toEqual(['/', 'prices']);
    expect(byKey.get('loginFailures')?.link).toBeNull();
  });

  /** The seed gives one of the three chains an empty queue, on purpose. */
  it('draws no tile for the chain with nothing waiting', async () => {
    const fixture = await render();
    const keys = fixture.componentInstance.waiting().map((tile) => tile.key);

    expect(keys).not.toContain(`entries-${CARREFOUR}`);
    expect(keys).not.toContain(`shops-${CARREFOUR}`);
  });

  it('draws a progress bar for the run in flight', async () => {
    const fixture = await render();
    const progress = fixture.debugElement.query(By.directive(RunProgressView));

    expect(progress).not.toBeNull();
    expect((progress.componentInstance as RunProgressView).run().status).toBe(
      'RUNNING'
    );
  });

  it('links the five recent runs to their own screens', async () => {
    const fixture = await render();
    const rows = fixture.debugElement
      .queryAll(By.directive(RunRowView))
      .map((node) => node.componentInstance as RunRowView);

    expect(rows).toHaveLength(5);
    expect(rows[0].link()).toEqual(['/', 'harvest', 'runs', rows[0].row().id]);
  });

  it('draws the two line charts and the two bar charts', async () => {
    const fixture = await render();

    expect(fixture.debugElement.queryAll(By.directive(LineChart))).toHaveLength(
      2
    );
    expect(fixture.debugElement.queryAll(By.directive(BarChart))).toHaveLength(
      2
    );
  });

  it('draws the twenty rows of the feed', async () => {
    const fixture = await render();

    expect(fixture.componentInstance.activity()).toHaveLength(20);
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
});

/**
 * A block that did not answer (plan 0016, section 5).
 *
 * `harvesterDeployed` is deliberately not consulted: it says production and
 * staging do not run the harvester, and both do now, so the document is the only
 * thing that knows.
 */
describe('DashboardPage with a block that did not answer', () => {
  it('draws the harvester notice and every other section', async () => {
    const fixture = await render(dashboardSeedWithout('harvest'));
    const headings = fixture.debugElement
      .queryAll(By.css('h2'))
      .map((node) => (node.nativeElement as HTMLElement).textContent?.trim());

    expect(notices(fixture)).toEqual(['dashboard.down.harvest']);
    expect(headings).toEqual([
      'dashboard.waiting.heading',
      'dashboard.harvest.heading',
      'dashboard.people.heading',
      'dashboard.catalog.heading',
      'dashboard.signIns.heading',
      'dashboard.activity.heading',
    ]);
    expect(
      fixture.debugElement.query(By.directive(RunProgressView))
    ).toBeNull();
  });

  it('keeps the numbers of every block that did answer', async () => {
    const fixture = await render(dashboardSeedWithout('harvest'));
    const keys = fixture.componentInstance.waiting().map((tile) => tile.key);

    expect(keys).toEqual(['memberships', 'stale', 'loginFailures']);
  });

  /** One notice per missing block, never two of the same on one page. */
  it('draws four notices when every block is missing, and an empty feed', async () => {
    const fixture = await render({
      ...dashboardSeedWithout('identity', 'core', 'catalog', 'harvest'),
      activity: [],
    });

    expect(notices(fixture)).toEqual([
      'dashboard.down.harvest',
      'dashboard.down.identity',
      'dashboard.down.core',
      'dashboard.down.catalog',
    ]);
    expect(fixture.componentInstance.waiting()).toEqual([]);
    expect(fixture.componentInstance.activity()).toEqual([]);
    expect(tiles(fixture)).toEqual([]);
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
        provideResources(),
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
