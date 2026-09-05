import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  HARVEST_SERVICE,
  ServerReachability,
  type HarvestServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import type { HarvestRun } from '@portfolio/luna-shopper-admin/models';
import { RunPage } from './run-page';

/**
 * Section 7's second test: **a run screen opened mid run renders correct state
 * without having observed the start.**
 *
 * A catalog discovery is eighteen minutes, so the common case is somebody
 * arriving in the middle. Nothing on this screen accumulates across polls, which
 * is what makes a late arrival indistinguishable from having watched the whole
 * thing.
 */

const drain = async () => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
};

function run(over: Partial<HarvestRun> = {}): HarvestRun {
  return {
    id: 'run-1',
    supermarketId: null,
    sourceId: null,
    mode: 'CATALOG_DISCOVERY',
    trigger: 'MANUAL',
    status: 'RUNNING',
    requestedAt: '2026-09-03T09:00:00.000Z',
    startedAt: '2026-09-03T09:00:01.000Z',
    finishedAt: null,
    heartbeatAt: '2026-09-03T09:12:00.000Z',
    totalPlanned: 4383,
    processed: 3000,
    created: 1200,
    updated: 900,
    unchanged: 800,
    notFound: 84,
    // What a rule dropped, which a crawl never does and a leaflet import does
    // six times over (backend plan 0081, section 7).
    skipped: 0,
    failed: 16,
    stage: 'fetch-products',
    stageLabel: 'Fetching products',
    warnings: [],
    documentSha256: null,
    abortRequestedAt: null,
    error: null,
    report: {},
    correlationId: 'cid-1',
    requestedByUserId: null,
    revertedAt: null,
    revertedByUserId: null,
    revertedPriceCount: null,
    ...over,
  };
}

/** A leaflet import that finished, with one warning of each shape. */
function leafletRun(over: Partial<HarvestRun> = {}): HarvestRun {
  return run({
    mode: 'LEAFLET_IMPORT',
    status: 'COMPLETED',
    supermarketId: 'sm_deza',
    totalPlanned: 48,
    processed: 48,
    notFound: 5,
    skipped: 6,
    failed: 0,
    stage: null,
    stageLabel: null,
    finishedAt: '2026-09-03T07:20:09.000Z',
    documentSha256: 'f62fa7ac367008e1',
    warnings: [
      {
        code: 'LOYALTY_REQUIRED',
        offerId: 'p36-o01',
        page: 36,
        name: 'Champu Elvive',
        message: 'Skipped: the price is for loyalty card holders.',
      },
      {
        // The extractor's own lost tile, carried through, so what it lost and
        // what the import dropped read in one table.
        code: 'EXTRACTOR',
        offerId: null,
        page: 2,
        name: null,
        message: 'tile has no readable price',
      },
    ],
    ...over,
  });
}

async function render(
  answer: HarvestRun,
  reverted?: HarvestRun
): Promise<ComponentFixture<RunPage>> {
  const service = {
    readRun: async () => answer,
    abortRun: async () => answer,
    revertRun: async () => reverted ?? answer,
  } as unknown as HarvestServiceI;

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [RunPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ServerReachability,
      provideRouter([]),
      provideLocationMocks(),
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
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: new Map([['id', 'run-1']]) } },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(RunPage);
  fixture.detectChanges();
  await drain();
  fixture.detectChanges();
  return fixture;
}

const text = (fixture: ComponentFixture<RunPage>): string =>
  fixture.nativeElement.textContent;

describe('RunPage, arriving mid run', () => {
  it('draws the progress from the first read alone', async () => {
    const fixture = await render(run());

    expect(fixture.componentInstance.watch.progress()).toEqual({
      processed: 3000,
      total: 4383,
      percent: 68,
    });
    fixture.componentInstance.watch.stop();
  });

  it('draws a bar it can measure', async () => {
    const fixture = await render(run());

    const bar = fixture.nativeElement.querySelector('[role="progressbar"]');
    expect(bar.getAttribute('aria-valuenow')).toBe('68');
    fixture.componentInstance.watch.stop();
  });

  /**
   * `totalPlanned` is null for the first minutes of a run, so a screen opened
   * then has to say how many rather than how far.
   */
  it('draws no bar before the run knows its own size', async () => {
    const fixture = await render(run({ totalPlanned: null, processed: 40 }));

    expect(
      fixture.nativeElement.querySelector('[role="progressbar"]')
    ).toBeNull();
    expect(text(fixture)).toContain('harvest.run.progress.unsized');
    fixture.componentInstance.watch.stop();
  });

  it('offers the abort on a run still going', async () => {
    const fixture = await render(run());

    expect(fixture.componentInstance.watch.canAbort()).toBe(true);
    fixture.componentInstance.watch.stop();
  });

  /**
   * The window between the abort landing and the run finalizing is long enough
   * to look like nothing happened, so the screen accounts for it.
   */
  it('says a run is stopping rather than offering a second abort', async () => {
    const fixture = await render(
      run({ abortRequestedAt: '2026-09-03T09:13:00.000Z' })
    );

    expect(text(fixture)).toContain('harvest.run.aborting');
    expect(fixture.componentInstance.watch.canAbort()).toBe(false);
    fixture.componentInstance.watch.stop();
  });

  /**
   * A failure naming one of the switches is translated into this app's own
   * explanation, rather than shown as the harvester's raw sentence.
   */
  it('explains a run that the service switch stopped', async () => {
    const fixture = await render(
      run({
        status: 'FAILED',
        error:
          'Harvesting is disabled on this deployment (HARVEST_ENABLED is false).',
      })
    );

    expect(fixture.componentInstance.blockedKey()).toBe(
      'harvest.blocked.service-off'
    );
    fixture.componentInstance.watch.stop();
  });

  it('shows a failure it cannot explain in the server own words', async () => {
    const fixture = await render(
      run({ status: 'FAILED', error: 'connection reset by peer' })
    );

    expect(fixture.componentInstance.blockedKey()).toBeNull();
    expect(text(fixture)).toContain('connection reset by peer');
    fixture.componentInstance.watch.stop();
  });

  /**
   * `notFound` is not a failure. A 404 from a detail call means the product is
   * not stocked at that store, which is a value, and folding it into `failed`
   * would make a healthy run look broken in the hundreds.
   */
  it('counts what was not stocked separately from what failed', async () => {
    const fixture = await render(run());
    const counters = fixture.componentInstance.watch.run();

    expect(counters?.notFound).toBe(84);
    expect(counters?.failed).toBe(16);
    expect(text(fixture)).toContain('harvest.run.counter.notFound');
    expect(text(fixture)).toContain('harvest.run.counter.failed');
    fixture.componentInstance.watch.stop();
  });

  /**
   * `skipped` is a counter of its own and not folded into `failed` (backend
   * plan 0081, section 7). A loyalty gated offer is dropped on purpose, and
   * reporting six of those as failures would report a working import as broken.
   */
  it('counts what a rule dropped separately from what failed', async () => {
    const fixture = await render(leafletRun());

    expect(text(fixture)).toContain('harvest.run.counter.skipped');
    expect(fixture.componentInstance.watch.run()?.skipped).toBe(6);
    fixture.componentInstance.watch.stop();
  });

  /** The teardown is on the component, because a route injector is never destroyed. */
  it('stops watching when the screen goes away', async () => {
    const fixture = await render(run());
    const watch = fixture.componentInstance.watch;
    const stop = jest.spyOn(watch, 'stop');

    fixture.destroy();

    expect(stop).toHaveBeenCalled();
  });
});

/**
 * The leaflet half of the run screen (admin plan 0010, sections 5 and 7).
 *
 * Everything here is drawn on the run's mode alone, so a catalog discovery
 * carries none of it. That guard is the test: a crawl's warnings list is empty,
 * so without it every catalog run anybody opened would show an empty table and
 * a link to a queue that has nothing to do with it.
 */
describe('RunPage, for a leaflet import', () => {
  it('lists the warnings, by offer and code', async () => {
    const fixture = await render(leafletRun());
    const page = fixture.componentInstance;

    expect(page.leaflet()).toBe(true);
    expect(page.warnings()).toEqual([
      {
        key: '0',
        code: 'LOYALTY_REQUIRED',
        offerId: 'p36-o01',
        page: '36',
        name: 'Champu Elvive',
        message: 'Skipped: the price is for loyalty card holders.',
      },
      {
        key: '1',
        code: 'EXTRACTOR',
        offerId: '',
        page: '2',
        name: '',
        message: 'tile has no readable price',
      },
    ]);
    expect(text(fixture)).toContain('harvest.warning.LOYALTY_REQUIRED');
    expect(text(fixture)).toContain('harvest.warning.EXTRACTOR');
    page.watch.stop();
  });

  /**
   * `notFound` on an import is offers put in front of a person, which is a
   * different number from the same counter on a crawl, where it means a product
   * the storefront no longer stocks.
   */
  it('links to the queue this run filled, for this run chain', async () => {
    const fixture = await render(leafletRun());
    const page = fixture.componentInstance;

    expect(page.queued()).toBe(5);
    expect(page.queueLink()).toEqual({
      path: ['/', 'harvest', 'leaflets', 'queue'],
      params: { supermarketId: 'sm_deza' },
    });
    expect(text(fixture)).toContain('harvest.run.queue.open');
    page.watch.stop();
  });

  it('draws none of it for a discovery run', async () => {
    const fixture = await render(run());
    const page = fixture.componentInstance;

    expect(page.leaflet()).toBe(false);
    expect(page.warnings()).toEqual([]);
    expect(page.queued()).toBe(0);
    expect(text(fixture)).not.toContain('harvest.run.warnings.heading');
    expect(text(fixture)).not.toContain('harvest.run.queue.open');
    page.watch.stop();
  });
});

/**
 * Taking a run's writes back (backend plan 0082, section 6).
 *
 * The control is drawn for a finished run of a price writing mode that has not
 * been reverted already, and for nothing else. It is a hard delete with no undo,
 * so a button that appeared where the server would refuse it would be teaching
 * an operator to press through a 409.
 */
describe('RunPage, reverting a run', () => {
  it('offers the revert on a finished run that wrote prices', async () => {
    const fixture = await render(
      run({ status: 'COMPLETED', finishedAt: '2026-09-03T09:20:00.000Z' })
    );

    expect(fixture.componentInstance.watch.canRevert()).toBe(true);
    expect(text(fixture)).toContain('harvest.run.revert.action');
    fixture.componentInstance.watch.stop();
  });

  it('offers nothing on a run still going: abort it first', async () => {
    const fixture = await render(run());

    expect(fixture.componentInstance.watch.canRevert()).toBe(false);
    expect(text(fixture)).not.toContain('harvest.run.revert.action');
    fixture.componentInstance.watch.stop();
  });

  it('offers nothing on a store discovery run, which wrote no price', async () => {
    const fixture = await render(
      run({ mode: 'STORE_DISCOVERY', status: 'COMPLETED' })
    );

    expect(fixture.componentInstance.watch.canRevert()).toBe(false);
    fixture.componentInstance.watch.stop();
  });

  /**
   * The counts are asserted as the dialog's inputs and not as rendered text:
   * the testing translator answers with the key and interpolates nothing, so a
   * sentence read off the DOM would prove only that a key was used.
   */
  it('confirms with the numbers the run itself reported', async () => {
    const fixture = await render(
      run({ status: 'COMPLETED', created: 214, notFound: 9 })
    );
    const page = fixture.componentInstance;

    expect(page.confirmCounts()).toEqual({ prices: 214, queued: 9 });
    // A crawl's `notFound` counts products the chain does not stock, which is
    // not a queue, so its sentence does not mention one.
    expect(page.confirmBodyKey()).toBe('harvest.run.revert.confirm');
    page.watch.stop();
  });

  it('names the queue as well, for the one mode that fills it', async () => {
    const fixture = await render(
      run({
        mode: 'LEAFLET_IMPORT',
        status: 'COMPLETED',
        created: 41,
        notFound: 6,
      })
    );
    const page = fixture.componentInstance;

    expect(page.confirmBodyKey()).toBe('harvest.run.revert.confirmLeaflet');
    expect(page.confirmCounts()).toEqual({ prices: 41, queued: 6 });
    page.watch.stop();
  });

  it('nothing is deleted until the confirmation is answered', async () => {
    const fixture = await render(run({ status: 'COMPLETED' }));
    const page = fixture.componentInstance;
    const revert = jest.spyOn(page.watch, 'revert');

    page.confirming.set(true);
    fixture.detectChanges();

    expect(revert).not.toHaveBeenCalled();
    expect(text(fixture)).toContain('harvest.run.revert.heading');
    page.watch.stop();
  });

  it('shows the state and the count the operation answered', async () => {
    const done = run({
      status: 'COMPLETED',
      revertedAt: '2026-09-05T10:00:00.000Z',
      revertedByUserId: 'owner-1',
      revertedPriceCount: 214,
    });
    const fixture = await render(run({ status: 'COMPLETED' }), done);
    const page = fixture.componentInstance;

    page.confirming.set(true);
    await page.revert();
    await drain();
    fixture.detectChanges();

    expect(page.confirming()).toBe(false);
    // The status is unchanged, and the chip is drawn beside it rather than in
    // place of it: how the run ended did not change.
    expect(page.watch.run()?.status).toBe('COMPLETED');
    expect(text(fixture)).toContain('harvest.run.reverted.chip');
    expect(text(fixture)).toContain('214');
    // And the control is gone, because there is nothing left to take back.
    expect(page.watch.canRevert()).toBe(false);
    page.watch.stop();
  });
});
