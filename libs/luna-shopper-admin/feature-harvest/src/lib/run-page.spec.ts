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
    failed: 16,
    stage: 'fetch-products',
    stageLabel: 'Fetching products',
    abortRequestedAt: null,
    error: null,
    correlationId: 'cid-1',
    requestedByUserId: null,
    ...over,
  };
}

async function render(answer: HarvestRun): Promise<ComponentFixture<RunPage>> {
  const service = {
    readRun: async () => answer,
    abortRun: async () => answer,
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

  /** The teardown is on the component, because a route injector is never destroyed. */
  it('stops watching when the screen goes away', async () => {
    const fixture = await render(run());
    const watch = fixture.componentInstance.watch;
    const stop = jest.spyOn(watch, 'stop');

    fixture.destroy();

    expect(stop).toHaveBeenCalled();
  });
});
