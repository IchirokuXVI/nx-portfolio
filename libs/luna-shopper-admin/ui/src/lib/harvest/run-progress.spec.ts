import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type {
  HarvestRun,
  RunProgress,
} from '@portfolio/luna-shopper-admin/models';
import { RunProgressView } from './run-progress';

function run(over: Partial<HarvestRun> = {}): HarvestRun {
  return {
    id: 'run-1',
    supermarketId: null,
    sourceId: null,
    mode: 'CATALOG_DISCOVERY',
    trigger: 'MANUAL',
    status: 'COMPLETED',
    requestedAt: '2026-09-09T19:41:00.000Z',
    startedAt: '2026-09-09T19:41:08.000Z',
    finishedAt: '2026-09-09T19:59:00.000Z',
    heartbeatAt: null,
    totalPlanned: 189,
    processed: 188,
    created: 188,
    updated: 0,
    unchanged: 0,
    notFound: 0,
    skipped: 0,
    failed: 1,
    stage: null,
    stageLabel: null,
    warnings: [],
    documentSha256: null,
    abortRequestedAt: null,
    error: null,
    report: {},
    correlationId: null,
    requestedByUserId: null,
    revertedAt: null,
    revertedByUserId: null,
    revertedPriceCount: null,
    ...over,
  };
}

async function render(view: HarvestRun) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [RunProgressView, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(RunProgressView);
  fixture.componentRef.setInput('run', view);
  fixture.componentRef.setInput('progress', {
    processed: view.processed,
    total: view.totalPlanned,
    percent: 99,
  });
  fixture.detectChanges();
  return fixture;
}

/** The label of every counter drawn, in the order the screen draws them. */
function labels(fixture: { nativeElement: HTMLElement }): string[] {
  return [...fixture.nativeElement.querySelectorAll('dt')].map((each) =>
    (each.textContent ?? '').trim()
  );
}

/**
 * What a run says it did.
 *
 * The counters keep their neutral words on every mode. Two of them used to be
 * renamed prices on a run that writes any, and the LIDL walk of 2026-09-09 is
 * what that cost: 188 products nobody had matched yet, so `updated` was zero and
 * the screen read "prices written: 0" while the source rows carried 8,154
 * prices. The real numbers come from the run's own report.
 */
describe('RunProgressView', () => {
  it('never calls a run counter a price', async () => {
    const fixture = await render(run());

    expect(labels(fixture)).toEqual([
      'harvest.run.counter.created',
      'harvest.run.counter.updated',
      'harvest.run.counter.unchanged',
      'harvest.run.counter.notFound',
      'harvest.run.counter.skipped',
      'harvest.run.counter.failed',
    ]);
  });

  it('draws what the run recorded beside what it published', async () => {
    const fixture = await render(
      run({
        report: {
          pricesRecorded: 8154,
          pricesPublished: 0,
          pricesConfirmed: 0,
        },
      })
    );

    const values = [
      ...fixture.nativeElement.querySelectorAll('.prices dd'),
    ].map((each: Element) => (each.textContent ?? '').trim());

    expect(labels(fixture)).toContain('harvest.run.counter.pricesRecorded');
    // Zero published beside 8,154 recorded is the honest answer for a chain
    // still in the queue, and the note beneath says why.
    expect(values).toEqual(['8154', '0', '0']);
    expect(fixture.nativeElement.querySelector('.note')).not.toBeNull();
  });

  /**
   * A store discovery writes no price, and a run that finished before the
   * harvester reported them has nothing to say. Three zeros would read as a run
   * that found nothing.
   */
  it('draws no price row for a run whose report names none', async () => {
    const fixture = await render(run({ mode: 'STORE_DISCOVERY' }));

    expect(fixture.nativeElement.querySelector('.prices')).toBeNull();
  });
});

/**
 * An approximate total from an earlier run (decision 86 of the harvester
 * round): "824 of about 2,361", never a known total replaced by one.
 */
describe('RunProgressView with an approximate total', () => {
  async function draw(progress: RunProgress, over: Partial<HarvestRun> = {}) {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [RunProgressView, RokuTranslatorTestingModule.forTesting()],
    }).compileComponents();

    const fixture = TestBed.createComponent(RunProgressView);
    fixture.componentRef.setInput(
      'run',
      run({ status: 'ABORTED', totalPlanned: null, ...over })
    );
    fixture.componentRef.setInput('progress', progress);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const text = (page: HTMLElement, selector: string) =>
    (page.querySelector(selector)?.textContent ?? '').trim();

  it('says "of about" and why, beside a bar that says so too', async () => {
    const page = await draw({
      processed: 824,
      total: null,
      percent: 35,
      about: 2361,
    });

    expect(text(page, '[data-progress-count]')).toBe(
      'harvest.run.progress.ofAbout'
    );
    expect(page.querySelector('[data-progress-approximate]')).not.toBeNull();
    const bar = page.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('35');
    expect(bar?.getAttribute('aria-valuetext')).toBe(
      'harvest.run.progress.ofAbout'
    );
    expect(page.textContent).not.toContain('harvest.run.progress.unsized');
  });

  it('keeps the unknown form when there is no estimate', async () => {
    const page = await draw({ processed: 824, total: null, percent: null });

    expect(text(page, '[data-progress-count]')).toBe(
      'harvest.run.progress.processed'
    );
    expect(page.querySelector('[role="progressbar"]')).toBeNull();
    expect(page.querySelector('[data-progress-approximate]')).toBeNull();
    expect(page.textContent).toContain('harvest.run.progress.unsized');
  });

  it('draws a known total as it always did', async () => {
    const page = await draw(
      { processed: 1907, total: 4383, percent: 44, about: null },
      { status: 'RUNNING', totalPlanned: 4383 }
    );

    expect(text(page, '[data-progress-count]')).toBe('harvest.run.progress.of');
    expect(
      page.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext')
    ).toBeNull();
    expect(page.querySelector('[data-progress-approximate]')).toBeNull();
  });
});

/**
 * Which run shows its phase (admin plan 0074, section 1b).
 *
 * The harvester leaves the last phase on a run when it ends. A completed run
 * and a reverted run hide it. A run that stopped short keeps it, because it
 * says where the run stopped.
 */
describe('RunProgressView phase', () => {
  const REVERTED = {
    revertedAt: '2026-09-10T08:00:00.000Z',
    revertedByUserId: 'admin-1',
    revertedPriceCount: 3,
  };

  function stage(fixture: { nativeElement: HTMLElement }): string | null {
    const element = fixture.nativeElement.querySelector('.stage');
    return element === null ? null : (element.textContent ?? '').trim();
  }

  it('hides the phase of a completed run', async () => {
    const fixture = await render(
      run({ status: 'COMPLETED', stageLabel: 'Fetching products' })
    );

    expect(stage(fixture)).toBeNull();
  });

  it.each(['COMPLETED', 'FAILED', 'ABORTED', 'STALE'] as const)(
    'hides the phase of a reverted %s run',
    async (status) => {
      const fixture = await render(
        run({ status, stageLabel: 'Fetching products', ...REVERTED })
      );

      expect(stage(fixture)).toBeNull();
    }
  );

  it.each(['FAILED', 'ABORTED', 'STALE', 'RUNNING', 'PENDING'] as const)(
    'draws the phase of a %s run that is not reverted',
    async (status) => {
      const fixture = await render(
        run({ status, stageLabel: 'Fetching products' })
      );

      expect(stage(fixture)).toBe('Fetching products');
    }
  );
});
