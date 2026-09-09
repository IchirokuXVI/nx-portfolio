import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { HarvestRun } from '@portfolio/luna-shopper-admin/models';
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
