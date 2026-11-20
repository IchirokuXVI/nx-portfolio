import { provideLocationMocks } from '@angular/common/testing';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import {
  RokuTranslatorService,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  HARVEST_SERVICE,
  RESOURCE_GATEWAYS,
  ServerReachability,
  type HarvestServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import { ResourceReferences } from '@portfolio/luna-shopper-admin/feature-resource';
import type { HarvestRun } from '@portfolio/luna-shopper-admin/models';
import { Viewport } from '@portfolio/luna-shopper-admin/ui';
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
    // A walk of the whole chain, so its chain and mode are a fair reference
    // for an estimate (owner decision 112b).
    input: { mode: 'CATALOG_DISCOVERY' },
    ...over,
  };
}

/** The harvester's sentence for `DUPLICATE_KEY` (`file-import.runner.ts`). */
const DUPLICATE_SENTENCE =
  'Two products in this document have the same name and size, so ' +
  'neither wrote a price.';

/** A file import that finished, with one warning of each shape. */
function importRun(over: Partial<HarvestRun> = {}): HarvestRun {
  return run({
    mode: 'FILE_IMPORT',
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
        code: 'DUPLICATE_KEY',
        offerId: 'p36-o01',
        page: 36,
        name: 'Champu Elvive',
        message: DUPLICATE_SENTENCE,
      },
      {
        // The producer's own lost tile, carried through, so what it lost and
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

/** A gateway whose one list is the admins, or a refusal. */
function gatewaysAnswering(admins: readonly unknown[] | 'fail') {
  return {
    for: () => ({
      list: async () => {
        if (admins === 'fail') {
          throw new Error('refused');
        }
        return { items: admins, nextCursor: null };
      },
    }),
  };
}

/** What the last export answered with, so a spec can assert on the file. */
let exported: Readonly<Record<string, unknown>> = {};

/** The screen around the run: its width, and the admins the gateway lists. */
interface Around {
  readonly compact?: boolean;
  /** The rows of `GET /v1/admin/admins`, or `'fail'` for a refused read. */
  readonly admins?: readonly unknown[] | 'fail';
  /**
   * Writes the words for a key, for a case about the copy itself. The testing
   * translator answers the key and ignores the values.
   */
  readonly words?: (key: string, values?: Record<string, unknown>) => string;
  /** What the runs list answers, which the approximate total is read from. */
  readonly earlier?: readonly HarvestRun[];
  /** Called on every read of the runs list, to count the lookups. */
  readonly onList?: () => void;
}

async function render(
  answer: HarvestRun,
  reverted?: HarvestRun,
  around: Around = {}
): Promise<ComponentFixture<RunPage>> {
  const service = {
    readRun: async () => answer,
    abortRun: async () => answer,
    revertRun: async () => reverted ?? answer,
    exportRun: async () => exported,
    listRuns: async () => {
      around.onList?.();
      return { items: around.earlier ?? [], nextCursor: null };
    },
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
        // The directory, so the export's file name reads as words rather than
        // as three uuids. `resolve` is the only method this screen asks for.
        provide: ResourceReferences,
        useValue: {
          resolve: async (resource: string, id: string) =>
            id === 'sm_deza'
              ? { id, title: 'Deza' }
              : id === 'scope-national'
                ? { id, title: 'NATIONAL' }
                : null,
        },
      },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: new Map([['id', 'run-1']]) } },
      },
      {
        provide: Viewport,
        useValue: {
          compact: signal(around.compact ?? false),
          split: signal(false),
        },
      },
      ...(around.words === undefined
        ? []
        : [
            {
              provide: RokuTranslatorService,
              useValue: {
                loaded: signal(true),
                locale: signal('en'),
                t: (
                  key: string,
                  _ns?: string,
                  _locale?: string,
                  values?: Record<string, unknown>
                ) => around.words?.(key, values) ?? key,
              },
            },
          ]),
      ...(around.admins === undefined
        ? []
        : [
            {
              provide: RESOURCE_GATEWAYS,
              useValue: gatewaysAnswering(around.admins),
            },
          ]),
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

  /**
   * A walk that does not know its total yet reads one from the last completed
   * walk of the chain (decision 86 of the harvester round), when its adapter's
   * totals compare (owner decision 127b) and the earlier walk ran under the
   * same config (owner decision 130b). An El Jamón walk qualifies.
   */
  describe('a walk that does not know its total', () => {
    const going = run({
      supermarketId: 'sm_eljamon',
      adapterKey: 'eljamon-web',
      configFingerprint: 'fp-eljamon',
      status: 'ABORTED',
      totalPlanned: null,
      processed: 824,
    });
    const whole = run({
      id: 'run-0',
      supermarketId: 'sm_eljamon',
      adapterKey: 'eljamon-web',
      configFingerprint: 'fp-eljamon',
      status: 'COMPLETED',
      totalPlanned: null,
      processed: 2361,
    });
    // The earlier run is read once the run has arrived, so one more pass.
    async function open(answer: HarvestRun, earlier: readonly HarvestRun[]) {
      const fixture = await render(answer, undefined, { earlier });
      await drain();
      fixture.detectChanges();
      return fixture;
    }
    const count = (fixture: ComponentFixture<RunPage>) =>
      (
        fixture.nativeElement.querySelector('[data-progress-count]')
          ?.textContent ?? ''
      ).trim();

    it('says "of about" the earlier walk while it runs, against a bar short of full', async () => {
      const fixture = await open({ ...going, status: 'RUNNING' }, [whole]);

      expect(fixture.componentInstance.progress()).toEqual({
        processed: 824,
        total: null,
        percent: 35,
        about: 2361,
        ended: false,
      });
      expect(count(fixture)).toBe('harvest.run.progress.ofAbout');
      const bar = fixture.nativeElement.querySelector('[role="progressbar"]');
      expect(bar?.getAttribute('aria-valuenow')).toBe('35');
      expect(bar?.getAttribute('aria-valuetext')).toBe(
        'harvest.run.progress.ofAbout'
      );
      expect(text(fixture)).toContain('harvest.run.progress.approximate');
      expect(text(fixture)).not.toContain('harvest.run.progress.unsized');
      fixture.componentInstance.watch.stop();
    });

    /** Owner decision 97b: the number stays, in the past, and no bar. */
    it('keeps the estimate on an ended walk, in the past tense, with no bar', async () => {
      const fixture = await open(going, [whole]);

      expect(count(fixture)).toBe('harvest.run.progress.ofAboutEnded');
      expect(
        fixture.nativeElement.querySelector('[role="progressbar"]')
      ).toBeNull();
      expect(
        fixture.nativeElement
          .querySelector('[data-progress-approximate]')
          ?.textContent.trim()
      ).toBe('harvest.run.progress.approximateEnded');
      expect(text(fixture)).not.toContain('harvest.run.progress.unsized');
      fixture.componentInstance.watch.stop();
    });

    /**
     * Owner decision 111c: a completed walk did the whole walk, so it shows
     * its count as before the estimate existed, and nothing is read for one.
     */
    it('shows a completed walk its count alone and reads nothing for it', async () => {
      let reads = 0;
      const fixture = await render(
        { ...going, status: 'COMPLETED' },
        undefined,
        {
          earlier: [whole],
          onList: () => (reads += 1),
        }
      );
      await drain();
      fixture.detectChanges();

      expect(reads).toBe(0);
      expect(fixture.componentInstance.progress()).toEqual({
        processed: 824,
        total: null,
        percent: null,
      });
      expect(count(fixture)).toBe('harvest.run.progress.processed');
      expect(
        fixture.nativeElement.querySelector('[data-progress-approximate]')
      ).toBeNull();
      expect(
        fixture.nativeElement.querySelector('[role="progressbar"]')
      ).toBeNull();
      // Owner decision 120b: no note either, only the count.
      expect(text(fixture)).not.toContain('harvest.run.progress.unsized');
      fixture.componentInstance.watch.stop();
    });

    /**
     * Owner decision 113b: the page reads the estimate again each time it
     * opens, so a reference run reverted since is not still quoted, while a
     * poll of the open page reads nothing.
     */
    it('reads the estimate again when the page opens again, never on a poll', async () => {
      let reads = 0;
      let earlier: readonly HarvestRun[] = [whole];
      const fixture = await render({ ...going, status: 'RUNNING' }, undefined, {
        get earlier() {
          return earlier;
        },
        onList: () => (reads += 1),
      });
      await drain();
      fixture.detectChanges();
      const perOpen = reads;
      expect(perOpen).toBeGreaterThan(0);
      expect(count(fixture)).toBe('harvest.run.progress.ofAbout');

      // Two polls: a new run object each, and no new lookup.
      await fixture.componentInstance.watch.refresh();
      await fixture.componentInstance.watch.refresh();
      await drain();
      fixture.detectChanges();
      expect(reads).toBe(perOpen);

      // The reference walk is reverted meanwhile, and the page opens again.
      earlier = [{ ...whole, revertedAt: '2026-09-01T11:20:00.000Z' }];
      fixture.componentInstance.watch.stop();
      fixture.destroy();
      const again = TestBed.createComponent(RunPage);
      again.detectChanges();
      await drain();
      again.detectChanges();
      await drain();
      again.detectChanges();

      expect(reads).toBe(perOpen * 2);
      expect(
        (
          again.nativeElement.querySelector('[data-progress-count]')
            ?.textContent ?? ''
        ).trim()
      ).toBe('harvest.run.progress.processed');
      again.componentInstance.watch.stop();
    });

    it('keeps the form it had before for a walk that processed nothing', async () => {
      const fixture = await open(
        { ...going, status: 'RUNNING', processed: 0 },
        [whole]
      );

      expect(count(fixture)).toBe('harvest.run.progress.processed');
      expect(text(fixture)).toContain('harvest.run.progress.unsized');
      expect(
        fixture.nativeElement.querySelector('[data-progress-approximate]')
      ).toBeNull();
      fixture.componentInstance.watch.stop();
    });

    /**
     * Owner decision 112b: a store discovery of two postal codes is not "of
     * about" the chain's whole discovery, and reads nothing for one.
     */
    it('draws no estimate for a narrowed run with no preset, and reads nothing', async () => {
      let reads = 0;
      const postal = run({
        supermarketId: 'sm_deza',
        mode: 'STORE_DISCOVERY',
        status: 'RUNNING',
        totalPlanned: null,
        processed: 14,
        input: { mode: 'STORE_DISCOVERY', postalCodes: ['15001', '15002'] },
      });
      const fixture = await render(postal, undefined, {
        earlier: [
          {
            ...whole,
            mode: 'STORE_DISCOVERY',
            input: { mode: 'STORE_DISCOVERY' },
          },
        ],
        onList: () => (reads += 1),
      });
      await drain();
      fixture.detectChanges();

      expect(reads).toBe(0);
      expect(count(fixture)).toBe('harvest.run.progress.processed');
      expect(
        fixture.nativeElement.querySelector('[data-progress-approximate]')
      ).toBeNull();
      fixture.componentInstance.watch.stop();
    });

    it('keeps the unknown form with no earlier walk', async () => {
      const fixture = await open({ ...going, status: 'RUNNING' }, []);

      expect(count(fixture)).toBe('harvest.run.progress.processed');
      expect(text(fixture)).toContain('harvest.run.progress.unsized');
      fixture.componentInstance.watch.stop();
    });

    /**
     * Owner decision 131b: the note is for a run still going. An ended run
     * with no total and no estimate shows its count alone, however it ended.
     */
    it.each(['ABORTED', 'FAILED', 'STALE'] as const)(
      'shows an ended %s walk with no estimate its count alone, no note',
      async (status) => {
        const fixture = await open({ ...going, status }, []);

        expect(count(fixture)).toBe('harvest.run.progress.processed');
        expect(text(fixture)).not.toContain('harvest.run.progress.unsized');
        expect(
          fixture.nativeElement.querySelector('[role="progressbar"]')
        ).toBeNull();
        fixture.componentInstance.watch.stop();
      }
    );

    /**
     * Owner decision 127b: a DEZA walk shows "4,000 processed" and never "of
     * about 15,115", and reads nothing for it. So does a run that names no
     * adapter.
     */
    it.each([
      ['deza-web', 'RUNNING'],
      ['deza-web', 'ABORTED'],
      [null, 'RUNNING'],
    ] as const)(
      'draws no estimate for a %s walk that is %s, and reads nothing',
      async (adapterKey, status) => {
        let reads = 0;
        const fixture = await render(
          { ...going, adapterKey, status, presetId: 'preset-1' },
          undefined,
          {
            earlier: [{ ...whole, presetId: 'preset-1', adapterKey }],
            onList: () => (reads += 1),
          }
        );
        await drain();
        fixture.detectChanges();

        expect(reads).toBe(0);
        expect(count(fixture)).toBe('harvest.run.progress.processed');
        expect(
          fixture.nativeElement.querySelector('[data-progress-approximate]')
        ).toBeNull();
        fixture.componentInstance.watch.stop();
      }
    );

    /**
     * Owner decision 130b: an earlier walk under another config, or one from
     * before the fingerprint, is no reference.
     */
    it.each([
      ['another config', 'fp-other'],
      ['no fingerprint', null],
    ])(
      'draws no estimate from an earlier walk of %s',
      async (_name, configFingerprint) => {
        const fixture = await open({ ...going, status: 'RUNNING' }, [
          { ...whole, configFingerprint },
        ]);

        expect(count(fixture)).toBe('harvest.run.progress.processed');
        expect(text(fixture)).toContain('harvest.run.progress.unsized');
        expect(
          fixture.nativeElement.querySelector('[data-progress-approximate]')
        ).toBeNull();
        fixture.componentInstance.watch.stop();
      }
    );

    it('keeps the unknown form when the run has passed the estimate', async () => {
      const fixture = await open({ ...going, processed: 2400 }, [whole]);

      expect(count(fixture)).toBe('harvest.run.progress.processed');
      expect(
        fixture.nativeElement.querySelector('[role="progressbar"]')
      ).toBeNull();
      fixture.componentInstance.watch.stop();
    });

    it.each([
      ['reverted', { revertedAt: '2026-09-01T11:20:00.000Z' }],
      ['failed', { status: 'FAILED' as const }],
    ])('takes nothing from a %s earlier walk', async (_name, over) => {
      const fixture = await open(going, [{ ...whole, ...over }]);

      expect(count(fixture)).toBe('harvest.run.progress.processed');
      fixture.componentInstance.watch.stop();
    });

    it('never replaces a known total', async () => {
      const fixture = await open(
        { ...going, status: 'RUNNING', totalPlanned: 4383 },
        [whole]
      );

      expect(count(fixture)).toBe('harvest.run.progress.of');
      fixture.componentInstance.watch.stop();
    });
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
    const fixture = await render(importRun());

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
 * The file import half of the run screen (admin plan 0010, sections 5 and 7).
 *
 * Everything here is drawn on the run's mode alone, so a catalog discovery
 * carries none of it. That guard is the test: a crawl's warnings list is empty,
 * so without it every catalog run anybody opened would show an empty table and
 * a link to a queue that has nothing to do with it.
 */
describe('RunPage, for a file import', () => {
  it('lists the warnings, by product and code', async () => {
    const fixture = await render(importRun());
    const page = fixture.componentInstance;

    expect(page.fileImport()).toBe(true);
    expect(page.warnings()).toEqual([
      {
        key: '0',
        code: 'DUPLICATE_KEY',
        offerId: 'p36-o01',
        page: '36',
        name: 'Champu Elvive',
        message: DUPLICATE_SENTENCE,
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
    expect(text(fixture)).toContain('harvest.warning.DUPLICATE_KEY');
    expect(text(fixture)).toContain('harvest.warning.EXTRACTOR');
    page.watch.stop();
  });

  /**
   * `notFound` on an import is offers put in front of a person, which is a
   * different number from the same counter on a crawl, where it means a product
   * the storefront no longer stocks.
   */
  it('links to the queue this run filled, for this run chain', async () => {
    const fixture = await render(importRun());
    const page = fixture.componentInstance;

    expect(page.queued()).toBe(5);
    // The one queue, not the leaflet one it replaced (admin plan 0014). It
    // is the products queue of Review now, on the chain the four queues share
    // (admin plan 0044).
    expect(page.queueLink()).toEqual({
      path: ['/', 'harvest', 'review', 'products'],
      params: { chain: 'sm_deza' },
    });
    expect(text(fixture)).toContain('harvest.run.queue.open');
    page.watch.stop();
  });

  it('draws none of it for a discovery run', async () => {
    const fixture = await render(run());
    const page = fixture.componentInstance;

    expect(page.fileImport()).toBe(false);
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

  it('offers no revert on a store discovery run, which wrote no price', async () => {
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
        mode: 'FILE_IMPORT',
        status: 'COMPLETED',
        created: 41,
        notFound: 6,
      })
    );
    const page = fixture.componentInstance;

    expect(page.confirmBodyKey()).toBe('harvest.run.revert.confirmImport');
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

/**
 * Carrying a run's rows to another cluster (admin plan 0014, section 2).
 *
 * The whole reason this control exists is the arrangement backend plan 0086
 * section 6.2 describes: a walk runs on the machine that has room for 4,383
 * requests, and its result is uploaded to a cluster that is not allowed to
 * crawl. So it is offered on the two modes that hold rows and on nothing else,
 * and it is **not** gated by whether this deployment may start runs.
 */
describe('RunPage, exporting a run', () => {
  it('offers the export on a finished walk', async () => {
    const fixture = await render(run({ status: 'COMPLETED' }));

    expect(fixture.componentInstance.canExport()).toBe(true);
    expect(text(fixture)).toContain('harvest.run.export.action');
    fixture.componentInstance.watch.stop();
  });

  it('offers the export on a finished import', async () => {
    const fixture = await render(importRun());

    expect(fixture.componentInstance.canExport()).toBe(true);
    fixture.componentInstance.watch.stop();
  });

  /** Half written rows are not a document anybody should carry anywhere. */
  it('offers nothing on a run still going', async () => {
    const fixture = await render(run());

    expect(fixture.componentInstance.canExport()).toBe(false);
    expect(text(fixture)).not.toContain('harvest.run.export.action');
    fixture.componentInstance.watch.stop();
  });

  /** A store discovery found shops. There are no products in it to export. */
  it('offers nothing on a store discovery', async () => {
    const fixture = await render(
      run({ mode: 'STORE_DISCOVERY', status: 'COMPLETED' })
    );

    expect(fixture.componentInstance.canExport()).toBe(false);
    fixture.componentInstance.watch.stop();
  });

  /**
   * The name is the chain, the scope and the day, and the scope comes off the
   * document rather than off the run, because the run does not carry one.
   */
  it('names the file after the chain, the scope and the day', async () => {
    exported = { hints: { price_scope_id: 'scope-national' } };
    const fixture = await render(
      importRun({ finishedAt: '2026-09-05T07:20:09.000Z' })
    );
    const page = fixture.componentInstance;

    await expect(page.exportName(exported)).resolves.toBe(
      'harvest-deza-national-2026-09-05.json'
    );
    page.watch.stop();
  });

  /** A uuid is still a name somebody can find, and it is the honest fallback. */
  it('falls back to the ids the directory could not answer for', async () => {
    exported = { hints: { price_scope_id: 'scope-gone' } };
    const fixture = await render(
      importRun({
        supermarketId: 'sm_unknown',
        finishedAt: '2026-09-05T07:20:09.000Z',
      })
    );
    const page = fixture.componentInstance;

    await expect(page.exportName(exported)).resolves.toBe(
      'harvest-sm-unknown-scope-gone-2026-09-05.json'
    );
    page.watch.stop();
  });

  it('asks the gateway for the document when the button is pressed', async () => {
    exported = { schema_version: 1, products: [] };
    const fixture = await render(importRun());
    const page = fixture.componentInstance;

    await page.exportRun();

    expect(page.exportFailed()).toBe(false);
    page.watch.stop();
  });
});

/** A walk's copies and detail phase (admin plan 0029, section 6). */
describe('RunPage, what a walk wrote and fetched', () => {
  const targets = ['t1', 't2', 't3', 't4', 't5', 't6', 't7'];

  function walk(over: Partial<HarvestRun> = {}): HarvestRun {
    return run({
      status: 'COMPLETED',
      finishedAt: '2026-09-03T09:30:00.000Z',
      report: {
        warehouses: ['4661'],
        productsListed: 4232,
        productsDetailed: 12,
        productsDetailSkipped: 4180,
        productsWithoutEan: 3,
        writes: 'PRICES',
        details: 'NEW',
        copies: [
          {
            from: 'scope-national',
            to: targets,
            pricesCopied: 29624,
            availabilityCopied: 0,
          },
        ],
      },
      ...over,
    });
  }

  it('draws the resolved settings and the detail counts', async () => {
    const fixture = await render(walk());
    const page = fixture.componentInstance;

    expect(page.report().details).toEqual({
      requested: 12,
      skipped: 4180,
      withoutEan: 3,
    });
    expect(text(fixture)).toContain('harvest.runs.start.writes.PRICES');
    expect(text(fixture)).toContain('harvest.runs.start.details.NEW');
    expect(text(fixture)).toContain('4180');
    expect(text(fixture)).toContain('harvest.run.report.detailWithoutEan');
    page.watch.stop();
  });

  it('draws each copy by name, with its counts, and collapses after five targets', async () => {
    const fixture = await render(walk());
    const page = fixture.componentInstance;
    await drain();
    fixture.detectChanges();

    const row: HTMLElement = fixture.nativeElement.querySelector(
      'table.copies tbody tr'
    );
    // Named through the scope lookup, and the raw id where it finds nothing,
    // which is what a scope deleted since the run is.
    expect(row.querySelector('th')?.textContent?.trim()).toBe('NATIONAL');
    expect(row.textContent).toContain('t1, t2, t3, t4, t5');
    expect(row.textContent).not.toContain('t6');
    expect(row.textContent).toContain('29624');
    expect(page.hiddenTargets('scope-national', targets)).toBe(2);

    row.querySelector<HTMLButtonElement>('button.more')!.click();
    fixture.detectChanges();
    expect(row.textContent).toContain('t6, t7');
    expect(row.querySelector('button.more')).toBeNull();
    page.watch.stop();
  });

  it('draws a copy warning on a walk, not only on an import', async () => {
    const fixture = await render(
      walk({
        warnings: [
          {
            code: 'COPY_TARGET_GONE',
            offerId: null,
            page: null,
            name: null,
            message: 'The price scope t9 no longer exists.',
          },
        ],
      })
    );

    expect(text(fixture)).toContain('harvest.warning.COPY_TARGET_GONE');
    expect(text(fixture)).toContain('The price scope t9 no longer exists.');
    fixture.componentInstance.watch.stop();
  });

  it('draws no report for a run whose report says none of it', async () => {
    const fixture = await render(run());

    expect(fixture.componentInstance.hasReport()).toBe(false);
    expect(text(fixture)).not.toContain('harvest.run.report.heading');
    fixture.componentInstance.watch.stop();
  });
});

describe('RunPage, its two views', () => {
  it('opens on the overview and switches to the prices written', async () => {
    const fixture = await render(run({ status: 'COMPLETED' }));

    expect(
      fixture.nativeElement.querySelector('lib-run-prices-tab')
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('lib-run-progress')
    ).not.toBeNull();

    const tab = [
      ...fixture.nativeElement.querySelectorAll('[role="tab"]'),
    ].find((button) =>
      (button as HTMLElement).textContent?.includes('harvest.run.tabs.prices')
    ) as HTMLButtonElement;
    tab.click();
    fixture.detectChanges();

    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(
      fixture.nativeElement.querySelector('lib-run-prices-tab')
    ).not.toBeNull();
    // The counters give way to the rows, rather than sitting above them.
    expect(fixture.nativeElement.querySelector('lib-run-progress')).toBeNull();
    fixture.componentInstance.watch.stop();
  });
});

/** Admin plan 0067, target 10: a run a schedule started says so. */
describe('RunPage, who started it', () => {
  it('says Scheduled for a run a schedule started', async () => {
    const fixture = await render(
      run({ status: 'COMPLETED', trigger: 'SCHEDULED', scheduleId: 'sched-1' })
    );

    expect(
      fixture.nativeElement.querySelector('[data-scheduled]')?.textContent
    ).toContain('harvest.schedules.runs.scheduled');
    expect(fixture.componentInstance.scheduled()).not.toBeNull();
    fixture.componentInstance.watch.stop();
  });

  it('says nothing for a run a person started', async () => {
    const fixture = await render(run({ status: 'COMPLETED' }));

    expect(fixture.nativeElement.querySelector('[data-scheduled]')).toBeNull();
    fixture.componentInstance.watch.stop();
  });
});

/** What a walk did not read, by the runner that says so (admin plan 0071). */
describe('RunPage, what a walk did not read', () => {
  function walk(report: Record<string, unknown>): HarvestRun {
    return run({
      status: 'COMPLETED',
      finishedAt: '2026-09-03T09:30:00.000Z',
      report,
    });
  }

  const part = (fixture: ComponentFixture<RunPage>, selector: string) =>
    fixture.nativeElement.querySelector(selector) as HTMLElement | null;

  /** A part the case expects drawn, so a missing one fails by its selector. */
  function drawn(fixture: ComponentFixture<RunPage>, selector: string) {
    const found = part(fixture, selector);
    if (found === null) {
      throw new Error(`Nothing drawn at ${selector}`);
    }
    return found;
  }

  it('draws a Carrefour run: the unread, the asked again and the stop', async () => {
    const fixture = await render(
      walk({
        unreadableCategories: ['/supermercado/congelados/cat21449123/c'],
        askedAgain: [
          { id: 'cat1', name: 'Lácteos', read: true },
          { id: 'cat2', name: 'Congelados', read: false },
        ],
        blockedAfter: 'HTTP 403 on 4 categories in a row',
      })
    );

    expect(part(fixture, '[data-unreadable]')?.textContent).toContain(
      '/supermercado/congelados/cat21449123/c'
    );
    const asked = drawn(fixture, '[data-asked-again]');
    expect(asked.querySelectorAll('li')[0].textContent).toContain(
      'harvest.run.report.askedAgainRead'
    );
    expect(asked.querySelector('li.lost')?.textContent).toContain(
      'harvest.run.report.askedAgainLost'
    );
    expect(part(fixture, '[data-blocked-after]')?.textContent).toContain(
      'HTTP 403 on 4 categories in a row'
    );
    fixture.componentInstance.watch.stop();
  });

  it('draws a DEZA run: its sections, the unfinished first, and the open queries of a GROWTH one', async () => {
    const fixture = await render(
      walk({
        incompleteSections: [{ code: 'S2', name: 'Bebidas' }],
        sections: [
          {
            code: 'S1',
            name: 'Droguería',
            products: 412,
            queries: 14,
            stoppedBy: 'GROWTH',
            openQueries: ['champú', 'gel'],
          },
          {
            code: 'S2',
            name: 'Bebidas',
            products: 900,
            queries: 25,
            stoppedBy: 'BUDGET',
            openQueries: [],
          },
        ],
      })
    );

    const rows = drawn(fixture, '[data-sections]').querySelectorAll('tbody tr');
    expect(rows[0].textContent).toContain('Bebidas');
    expect(rows[0].textContent).toContain(
      'harvest.run.report.stoppedBy.BUDGET'
    );
    expect(rows[1].textContent).toContain(
      'harvest.run.report.stoppedBy.GROWTH'
    );
    expect(rows[1].textContent).toContain('champú, gel');
    fixture.componentInstance.watch.stop();
  });

  it('draws a DEZA section that threw as failed, and keeps the other words', async () => {
    const fixture = await render(
      walk({
        // As `deza-catalog.runner.ts` records a section that threw: null
        // queries and stop, the error in its `incompleteSections` entry.
        incompleteSections: [
          {
            code: 'S2',
            name: 'Bebidas',
            queries: 25,
            stoppedBy: 'BUDGET',
            openQueries: [],
          },
          {
            code: 'S3',
            name: 'Congelados',
            queries: null,
            stoppedBy: null,
            openQueries: ['Error: socket hang up'],
          },
        ],
        sections: [
          {
            code: 'S1',
            name: 'Droguería',
            products: 412,
            queries: 14,
            stoppedBy: 'LATER',
            openQueries: [],
          },
          {
            code: 'S2',
            name: 'Bebidas',
            products: 900,
            queries: 25,
            stoppedBy: 'BUDGET',
            openQueries: [],
          },
          {
            code: 'S3',
            name: 'Congelados',
            products: 0,
            queries: null,
            stoppedBy: null,
            openQueries: [],
          },
        ],
      })
    );

    const rows = drawn(fixture, '[data-sections]').querySelectorAll('tbody tr');
    const stops = [...rows].map((row) =>
      row.querySelectorAll('td')[2].textContent?.trim()
    );
    expect(rows[1].textContent).toContain('Congelados');
    expect(stops).toEqual([
      'harvest.run.report.stoppedBy.BUDGET',
      'harvest.run.report.stoppedBy.FAILED',
      '',
    ]);
    fixture.componentInstance.watch.stop();
  });

  it('draws a dash, never a 0, for the queries of a section that threw', async () => {
    const fixture = await render(
      walk({
        incompleteSections: [
          { code: 'S3', name: 'Mascotas', queries: null, stoppedBy: null },
        ],
        sections: [
          {
            code: 'S1',
            name: 'Droguería',
            products: 412,
            queries: 0,
            stoppedBy: 'COMPLETE',
            openQueries: [],
          },
          {
            code: 'S3',
            name: 'Mascotas',
            products: 259,
            queries: null,
            stoppedBy: null,
            openQueries: [],
          },
        ],
      })
    );

    const cells = [
      ...drawn(fixture, '[data-sections]').querySelectorAll('[data-queries]'),
    ];
    // Mascotas first, as the unfinished one.
    expect(cells[0].querySelector('[aria-hidden="true"]')?.textContent).toBe(
      '–'
    );
    expect(cells[0].textContent).toContain(
      'harvest.run.report.sections.queriesNotStated'
    );
    expect(cells[0].textContent).not.toContain('0');
    // A section that stated 0 queries still reads 0.
    expect(cells[1].textContent?.trim()).toBe('0');
    fixture.componentInstance.watch.stop();
  });

  it('draws a part that was not read alike, whether the runner named it or not', async () => {
    const fixture = await render(
      run({
        status: 'COMPLETED',
        finishedAt: '2026-09-03T09:30:00.000Z',
        warnings: [
          {
            // The runner set a name the sentence does not quote as it came:
            // the code alone hides it.
            code: 'LISTING_UNREAD',
            offerId: null,
            page: null,
            name: 'Mascotas y animales',
            message: 'Section 07 Mascotas failed: Error: socket hang up',
          },
          {
            code: 'LISTING_UNREAD',
            offerId: null,
            page: null,
            name: null,
            message:
              'Category cat21449123 Congelados was refused twice and was not read.',
          },
        ],
      })
    );

    const items = [
      ...fixture.nativeElement.querySelectorAll('.warnings li'),
    ] as HTMLElement[];
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.querySelector('strong'))).toEqual([
      null,
      null,
    ]);
    expect(items[0].textContent).toContain('Section 07 Mascotas failed');
    expect(items[0].textContent).not.toContain('Mascotas y animales');
    fixture.componentInstance.watch.stop();
  });

  it('draws the bold product name of an import warning whose sentence quotes it', async () => {
    const fixture = await render(
      importRun({
        warnings: [
          {
            code: 'NO_MATCH',
            offerId: 'p04-o02',
            page: 4,
            name: 'Yogur natural',
            message:
              '"Yogur natural" matched nothing, so it is queued for a person.',
          },
        ],
      })
    );

    const [item] = [
      ...fixture.nativeElement.querySelectorAll('.warnings li'),
    ] as HTMLElement[];
    expect(item.querySelector('strong')?.textContent).toBe('Yogur natural');
    fixture.componentInstance.watch.stop();
  });

  it('draws an El Jamón run: the categories that read short, and the detail sentence', async () => {
    const fixture = await render(
      walk({
        categories: [
          {
            code: '01',
            name: 'DESPENSA',
            printedCount: 1200,
            rowsRead: 1188,
            rowsRepeated: 12,
          },
          {
            code: '02',
            name: 'BEBIDAS',
            printedCount: 300,
            rowsRead: 300,
            rowsRepeated: 0,
          },
        ],
        detail: { pages: 800, failed: 3, timeouts: 2, silentAttempts: 1 },
      })
    );

    const rows = drawn(fixture, '[data-categories]').querySelectorAll(
      'tbody tr'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('1188');
    expect(part(fixture, '[data-detail-stage]')?.textContent).toContain(
      'harvest.run.report.detail'
    );
    fixture.componentInstance.watch.stop();
  });

  it('draws the sizes a walk found disproved, the pack count as a guess', async () => {
    const fixture = await render(
      walk({
        sizesDisproved: 2,
        probablePackCounts: 1,
        sizesDisprovedExamples: [
          {
            entryId: 'entry-1',
            name: 'Yogur natural',
            stated: 125,
            implied: 333.333,
            unit: 'GRAM',
            label: '1,20 €/kg',
          },
        ],
      })
    );

    const sizes = drawn(fixture, '[data-sizes]');
    expect(sizes.textContent).toContain('harvest.run.report.sizesDisproved');
    expect(sizes.textContent).toContain(
      'harvest.run.report.probablePackCounts'
    );
    const row = drawn(fixture, '[data-sizes] tbody tr');
    expect(row.textContent).toContain('Yogur natural');
    expect(row.textContent).toContain('333.3');
    expect(row.textContent).toContain('harvest.unit.GRAM');
    fixture.componentInstance.watch.stop();
  });

  it('links a size example that names its entry to that entry on the run chain, and draws the name alone otherwise (admin plan 0073)', async () => {
    const entryId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01';
    const fixture = await render(
      run({
        status: 'COMPLETED',
        finishedAt: '2026-09-03T09:30:00.000Z',
        supermarketId: 'sm_carrefour',
        report: {
          sizesDisproved: 2,
          probablePackCounts: 0,
          sizesDisprovedExamples: [
            {
              entryId,
              name: 'Yogur natural',
              stated: 125,
              implied: 500,
              unit: 'GRAM',
              label: '2,36 €/kg',
            },
            {
              name: 'Aceite de oliva',
              stated: 1000,
              implied: 750,
              unit: 'MILLILITER',
              label: '9,99 €/l',
            },
          ],
        },
      })
    );

    const rows = [
      ...fixture.nativeElement.querySelectorAll('[data-sizes] tbody tr'),
    ] as HTMLElement[];
    const link = rows[0].querySelector(
      'a[data-size-entry]'
    ) as HTMLAnchorElement | null;
    expect(link?.textContent?.trim()).toBe('Yogur natural');
    const href = new URL(link?.getAttribute('href') ?? '', 'http://admin');
    expect(href.pathname).toBe('/harvest/review/products');
    expect(href.searchParams.get('entry')).toBe(entryId);
    expect(href.searchParams.get('chain')).toBe('sm_carrefour');

    expect(rows[1].querySelector('a')).toBeNull();
    expect(rows[1].querySelector('th')?.textContent?.trim()).toBe(
      'Aceite de oliva'
    );
    fixture.componentInstance.watch.stop();
  });

  it('draws the size doubts of an import, and none of the chain parts', async () => {
    // The harvester writes the two counts for an imported run, with no
    // examples (run-executor.service.ts, plan 0249). The owner chose on
    // 2026-11-11 that an import shows them.
    const fixture = await render(
      importRun({ report: { sizesDisproved: 3, probablePackCounts: 1 } })
    );

    expect(fixture.componentInstance.hasReport()).toBe(true);
    const sizes = drawn(fixture, '[data-sizes]');
    expect(sizes.textContent).toContain('harvest.run.report.sizesDisproved');
    expect(sizes.textContent).toContain(
      'harvest.run.report.probablePackCounts'
    );
    expect(part(fixture, '[data-sizes] tbody tr')).toBeNull();
    for (const selector of [
      '[data-unreadable]',
      '[data-asked-again]',
      '[data-blocked-after]',
      '[data-sections]',
      '[data-categories]',
      '[data-detail-stage]',
    ]) {
      expect(part(fixture, selector)).toBeNull();
    }
    fixture.componentInstance.watch.stop();
  });

  it('draws none of it for an import with an empty report', async () => {
    const fixture = await render(importRun());

    expect(fixture.componentInstance.hasReport()).toBe(false);
    for (const selector of [
      '[data-unreadable]',
      '[data-asked-again]',
      '[data-blocked-after]',
      '[data-sections]',
      '[data-categories]',
      '[data-detail-stage]',
      '[data-sizes]',
      '[data-unslotted-only]',
    ]) {
      expect(part(fixture, selector)).toBeNull();
    }
    fixture.componentInstance.watch.stop();
  });
});

/**
 * The DIA products whose every leaf has no category of ours (backend plan
 * 0268, section 5), drawn in the report section (admin plan 0071, section 2).
 * The copy goes through a real i18next on `en.json`, because the testing
 * translator answers the key and the plural is the point.
 */
describe('RunPage, the DIA products only in leaves with no slug', () => {
  let words: (key: string, values?: Record<string, unknown>) => string;

  beforeAll(async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const i18next = (await import('i18next')).default;
    const file = resolve(__dirname, '../../../ui/assets/i18n/en.json');
    const instance = i18next.createInstance();
    await instance.init({
      lng: 'en',
      interpolation: { escapeValue: false },
      resources: {
        en: { translation: JSON.parse(readFileSync(file, 'utf8')) },
      },
    });
    words = (key, values) => instance.t(key, values ?? {});
  });

  function walk(report: Record<string, unknown>): HarvestRun {
    return run({
      status: 'COMPLETED',
      finishedAt: '2026-09-03T09:30:00.000Z',
      report,
    });
  }

  const block = (fixture: ComponentFixture<RunPage>) =>
    fixture.nativeElement.querySelector(
      '[data-unslotted-only]'
    ) as HTMLElement | null;

  const said = (element: Element | null | undefined) =>
    (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

  const EXAMPLES = [
    'Paleta de cebo ibérica loncheada',
    'Queso curado de oveja cuña',
    'Lomo ibérico de bellota',
    'Tabla de quesos variados',
    'Chorizo ibérico cular',
  ];

  it('draws the count, one line a leaf and its examples', async () => {
    const fixture = await render(
      walk({
        unslottedOnly: {
          products: 9,
          leaves: [
            {
              id: 'L2222',
              rootName: 'Especial Navidad',
              name: 'Ibéricos y quesos',
              products: 7,
              examples: EXAMPLES.map((name, i) => ({
                externalId: `28000${i}`,
                name,
              })),
            },
            {
              id: 'L2255',
              rootName: 'Especial Navidad',
              name: 'Platos especiales',
              products: 2,
              examples: [],
            },
          ],
        },
      }),
      undefined,
      { words: (key, values) => words(key, values) }
    );

    const drawn = block(fixture);
    expect(fixture.componentInstance.hasReport()).toBe(true);
    expect(said(drawn?.querySelector('h3'))).toBe(
      'Products only in chain categories we do not map'
    );
    expect(said(drawn?.querySelector('p'))).toBe(
      '9 products sit only in chain categories with no category of ours. They wait as uncategorised.'
    );
    const leaves = [
      ...(drawn?.querySelectorAll('[data-unslotted-leaf]') ?? []),
    ];
    expect(leaves).toHaveLength(2);
    expect(said(leaves[0])).toContain(
      'Especial Navidad / Ibéricos y quesos: 7 products'
    );
    expect(said(leaves[0].querySelector('[data-unslotted-examples]'))).toBe(
      `For example: ${EXAMPLES.join(', ')}`
    );
    expect(said(leaves[1])).toBe(
      'Especial Navidad / Platos especiales: 2 products'
    );
    expect(leaves[1].querySelector('[data-unslotted-examples]')).toBeNull();
    fixture.componentInstance.watch.stop();
  });

  it('reads one product in the singular', async () => {
    const fixture = await render(
      walk({
        unslottedOnly: {
          products: 1,
          leaves: [
            {
              id: 'L2255',
              rootName: 'Especial Navidad',
              name: 'Platos especiales',
              products: 1,
              examples: [{ externalId: '282840', name: 'Cordero asado' }],
            },
          ],
        },
      }),
      undefined,
      { words: (key, values) => words(key, values) }
    );

    const drawn = block(fixture);
    expect(said(drawn?.querySelector('p'))).toBe(
      '1 product sits only in chain categories with no category of ours. It waits as uncategorised.'
    );
    expect(said(drawn?.querySelector('[data-unslotted-leaf]'))).toBe(
      'Especial Navidad / Platos especiales: 1 product For example: Cordero asado'
    );
    fixture.componentInstance.watch.stop();
  });

  it.each([
    ['absent', {}],
    ['not an object', { unslottedOnly: 'nine' }],
    ['a count that is not a number', { unslottedOnly: { products: '9' } }],
    ['zero products', { unslottedOnly: { products: 0, leaves: [] } }],
  ])('draws nothing for a block that is %s', async (_case, report) => {
    const fixture = await render(walk(report), undefined, {
      words: (key, values) => words(key, values),
    });

    expect(block(fixture)).toBeNull();
    expect(fixture.componentInstance.hasReport()).toBe(false);
    fixture.componentInstance.watch.stop();
  });
});

/**
 * The run page on a phone, who reverted a run, and the report tables (admin
 * plan 0074).
 */
describe('RunPage, on a phone and after a revert', () => {
  const REVERTED = {
    status: 'COMPLETED' as const,
    finishedAt: '2026-09-03T09:30:00.000Z',
    revertedAt: '2026-09-05T10:00:00.000Z',
    revertedByUserId: 'admin-1',
    revertedPriceCount: 214,
  };

  const ADMINS = [
    {
      adminId: 'admin-1',
      username: 'ichiroku',
      displayName: 'Ichiroku',
      lastLoginAt: null,
      disabledAt: null,
    },
    {
      adminId: 'admin-2',
      username: 'retired',
      displayName: null,
      lastLoginAt: null,
      disabledAt: null,
    },
  ];

  const one = (fixture: ComponentFixture<RunPage>, selector: string) =>
    fixture.nativeElement.querySelector(selector) as HTMLElement | null;

  async function settled(fixture: ComponentFixture<RunPage>) {
    await drain();
    fixture.detectChanges();
    return fixture;
  }

  const revertedBy = (fixture: ComponentFixture<RunPage>) =>
    one(fixture, '[data-fact="revertedBy"] dd');

  it('draws the chips in the overview and not in the header on a phone', async () => {
    const fixture = await render(run(REVERTED), undefined, {
      compact: true,
      admins: ADMINS,
    });

    const line = one(fixture, '[data-run-chips]');
    expect(line?.textContent).toContain('harvest.status.COMPLETED');
    expect(line?.textContent).toContain('harvest.run.reverted.chip');
    expect(one(fixture, 'lib-page-header .status')).toBeNull();
    expect(one(fixture, 'lib-page-header .reverted')).toBeNull();
    fixture.componentInstance.watch.stop();
  });

  it('draws the chips in the header and not in the overview when wide', async () => {
    const fixture = await render(run(REVERTED), undefined, { admins: ADMINS });

    expect(one(fixture, '[data-run-chips]')).toBeNull();
    expect(one(fixture, 'lib-page-header .status')?.textContent).toContain(
      'harvest.status.COMPLETED'
    );
    expect(one(fixture, 'lib-page-header .reverted')).not.toBeNull();
    fixture.componentInstance.watch.stop();
  });

  it('names the admin who reverted it, with the id in the hover', async () => {
    const fixture = await settled(
      await render(run(REVERTED), undefined, { admins: ADMINS })
    );

    expect(revertedBy(fixture)?.textContent?.trim()).toBe('Ichiroku');
    expect(revertedBy(fixture)?.getAttribute('title')).toBe('admin-1');
    fixture.componentInstance.watch.stop();
  });

  it('names the admin by username when the display name is null', async () => {
    const fixture = await settled(
      await render(
        run({ ...REVERTED, revertedByUserId: 'admin-2' }),
        undefined,
        { admins: ADMINS }
      )
    );

    expect(revertedBy(fixture)?.textContent?.trim()).toBe('retired');
    fixture.componentInstance.watch.stop();
  });

  it('says an admin is no longer listed, and never shows the id alone', async () => {
    const fixture = await settled(
      await render(
        run({ ...REVERTED, revertedByUserId: 'admin-gone' }),
        undefined,
        { admins: ADMINS }
      )
    );

    expect(revertedBy(fixture)?.textContent?.trim()).toBe(
      'harvest.run.revertedByUnknown'
    );
    expect(revertedBy(fixture)?.getAttribute('title')).toBe('admin-gone');
    fixture.componentInstance.watch.stop();
  });

  it('says the list could not be read, not that the admin is gone', async () => {
    const fixture = await settled(
      await render(run(REVERTED), undefined, { admins: 'fail' })
    );

    expect(revertedBy(fixture)?.textContent?.trim()).toBe(
      'harvest.run.revertedByUnread'
    );
    expect(revertedBy(fixture)?.getAttribute('title')).toBe('admin-1');
    fixture.componentInstance.watch.stop();
  });

  it('puts every report table inside a scroll box', async () => {
    const fixture = await render(
      run({
        status: 'COMPLETED',
        finishedAt: '2026-09-03T09:30:00.000Z',
        report: {
          writes: 'PRICES',
          copies: [
            {
              from: 'scope-national',
              to: ['t1'],
              pricesCopied: 3,
              availabilityCopied: 0,
            },
          ],
          sections: [
            {
              code: 'S1',
              name: 'Droguería',
              products: 412,
              queries: 14,
              stoppedBy: 'GROWTH',
              openQueries: [],
            },
          ],
          categories: [
            {
              code: '01',
              name: 'DESPENSA',
              printedCount: 1200,
              rowsRead: 1188,
              rowsRepeated: 12,
            },
          ],
          sizesDisproved: 1,
          sizesDisprovedExamples: [
            {
              entryId: '',
              name: 'Yogur natural',
              stated: 125,
              implied: 333.333,
              unit: 'GRAM',
              label: '1,20 €/kg',
            },
          ],
        },
      })
    );

    const tables = [
      ...fixture.nativeElement.querySelectorAll('.report table'),
    ] as HTMLElement[];
    expect(tables).toHaveLength(4);
    for (const table of tables) {
      expect(table.parentElement?.classList.contains('scroll')).toBe(true);
    }
    fixture.componentInstance.watch.stop();
  });
});
