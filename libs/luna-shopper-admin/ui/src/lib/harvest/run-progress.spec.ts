import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  runProgressLine,
  type HarvestRun,
  type RunProgress,
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
 * An approximate total from another run (decision 86 of the harvester round):
 * "824 of about 2,361", never a known total replaced by one.
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
      run({ status: 'RUNNING', totalPlanned: null, ...over })
    );
    fixture.componentRef.setInput('progress', progress);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const text = (page: HTMLElement, selector: string) =>
    (page.querySelector(selector)?.textContent ?? '').trim();

  it('says "of about" and that it is an estimate, beside a bar that says so too', async () => {
    const page = await draw({
      processed: 824,
      total: null,
      percent: 35,
      about: 2361,
      ended: false,
    });

    expect(text(page, '[data-progress-count]')).toBe(
      'harvest.run.progress.ofAbout'
    );
    expect(text(page, '[data-progress-approximate]')).toBe(
      'harvest.run.progress.approximate'
    );
    const bar = page.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('35');
    expect(bar?.getAttribute('aria-valuetext')).toBe(
      'harvest.run.progress.ofAbout'
    );
    expect(page.textContent).not.toContain('harvest.run.progress.unsized');
  });

  /** Owner decision 97b: an ended run keeps the line, in the past, no bar. */
  it('words an ended run in the past and draws no bar', async () => {
    const page = await draw(
      { processed: 824, total: null, percent: null, about: 2361, ended: true },
      { status: 'ABORTED' }
    );

    expect(text(page, '[data-progress-count]')).toBe(
      'harvest.run.progress.ofAboutEnded'
    );
    expect(text(page, '[data-progress-approximate]')).toBe(
      'harvest.run.progress.approximateEnded'
    );
    expect(page.querySelector('[role="progressbar"]')).toBeNull();
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

  /**
   * Owner decision 120b: a completed run with no total has nothing left to
   * learn, so it shows its count and no note at all.
   */
  it('draws a completed run with no total as its count alone', async () => {
    const page = await draw(
      { processed: 2100, total: null, percent: null },
      { status: 'COMPLETED' }
    );

    expect(text(page, '[data-progress-count]')).toBe(
      'harvest.run.progress.processed'
    );
    expect(page.querySelector('.unsized')).toBeNull();
    expect(page.querySelector('[role="progressbar"]')).toBeNull();
  });

  it.each(['RUNNING', 'PENDING'] as const)(
    'keeps the note on a %s run with no total and no estimate',
    async (status) => {
      const page = await draw(
        { processed: 824, total: null, percent: null },
        { status }
      );

      expect(page.textContent).toContain('harvest.run.progress.unsized');
    }
  );

  /**
   * Owner decision 131b: the note is for a run that can still learn its
   * size. Every ended run with no total and no estimate shows its count
   * alone, however it ended.
   */
  it.each(['ABORTED', 'FAILED', 'STALE'] as const)(
    'draws an ended %s run with no total and no estimate as its count alone',
    async (status) => {
      const page = await draw(
        { processed: 824, total: null, percent: null },
        { status }
      );

      expect(text(page, '[data-progress-count]')).toBe(
        'harvest.run.progress.processed'
      );
      expect(page.querySelector('.unsized')).toBeNull();
      expect(page.querySelector('[role="progressbar"]')).toBeNull();
    }
  );

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
 * The words themselves, through a real i18next on `en.json`, because the
 * testing translator answers the key and the wording is the point: every
 * estimate says "about" and "estimate", and a known total reads exactly as it
 * did before the estimate existed (owner decisions 97b and 99b).
 */
describe('the progress words in English', () => {
  let words: (key: string, values?: object) => string;

  beforeAll(async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const i18next = (await import('i18next')).default;
    const file = resolve(__dirname, '../../../assets/i18n/en.json');
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

  const say = (progress: RunProgress) => {
    const line = runProgressLine(progress, 'en');
    return words(line.key, line.args);
  };

  it('reads a running estimate with grouped numbers', () => {
    expect(
      say({
        processed: 1824,
        total: null,
        percent: 77,
        about: 2361,
        ended: false,
      })
    ).toBe('1,824 of about 2,361');
    expect(words('harvest.run.progress.approximate', { total: '2,361' })).toBe(
      'This run does not know its total. About 2,361 is an estimate taken from the latest completed run of the same kind.'
    );
  });

  it('reads an ended estimate in the past', () => {
    expect(
      say({
        processed: 824,
        total: null,
        percent: null,
        about: 2361,
        ended: true,
      })
    ).toBe('824 processed of about 2,361');
    expect(
      words('harvest.run.progress.approximateEnded', { total: '2,361' })
    ).toBe(
      'This run did not know its total. About 2,361 is an estimate taken from the latest completed run of the same kind.'
    );
  });

  it('reads a known total and a bare count raw, as before', () => {
    expect(say({ processed: 1907, total: 4383, percent: 44 })).toBe(
      '1907 of 4383'
    );
    expect(say({ processed: 2361, total: null, percent: null })).toBe(
      '2361 processed'
    );
  });

  it('gives the header link a label that says about and estimate', () => {
    expect(
      words('harvest.running.openAbout', {
        what: 'Deza, Catalog',
        processed: '824',
        total: '2,361',
      })
    ).toBe(
      'Open the run in progress: Deza, Catalog, 824 of about 2,361, an estimate'
    );
    expect(
      words('harvest.running.open', { what: 'Mercadona', processed: 1907 })
    ).toBe('Open the run in progress: Mercadona, 1907 processed');
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
