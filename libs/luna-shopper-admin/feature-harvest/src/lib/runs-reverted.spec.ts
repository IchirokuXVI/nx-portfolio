import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  HARVEST_SERVICE,
  ServerReachability,
  type HarvestServiceI,
  type RunQuery,
} from '@portfolio/luna-shopper-admin/data-access';
import type { HarvestRun } from '@portfolio/luna-shopper-admin/models';
import { RunsPage } from './runs-page';

/**
 * A reverted run on the runs list (backend plan 0082, section 6).
 *
 * Two claims, and the first is the one that is easy to get wrong: **a reverted
 * run keeps its status chip**. The status says how the run ended, and reverting
 * it did not change that, so the row carries two chips rather than one that
 * replaced the other. A list that showed `reverted` instead of `COMPLETED`
 * would lose the only place a person can see that the run itself finished.
 *
 * The second is that the filter is a server side one: it goes out as a query
 * and comes back as a page, rather than hiding rows the screen already has.
 * Absent means both, which is what the screen opens on.
 *
 * Zoneless, so the load promise is drained by hand rather than with
 * `whenStable`, which hangs. The translator double answers with the key, which
 * is why the assertions read as key names.
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
    status: 'COMPLETED',
    requestedAt: '2026-09-03T09:00:00.000Z',
    startedAt: '2026-09-03T09:00:01.000Z',
    finishedAt: '2026-09-03T09:18:00.000Z',
    heartbeatAt: '2026-09-03T09:18:00.000Z',
    totalPlanned: 1204,
    processed: 1204,
    created: 214,
    updated: 0,
    unchanged: 981,
    notFound: 9,
    skipped: 0,
    failed: 0,
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
  } as HarvestRun;
}

async function render(rows: HarvestRun[]): Promise<{
  fixture: ComponentFixture<RunsPage>;
  queries: RunQuery[];
}> {
  const queries: RunQuery[] = [];
  const service = {
    listRuns: async (query: RunQuery) => {
      queries.push(query);
      const wanted = query.reverted;
      const items =
        wanted === undefined
          ? rows
          : rows.filter((row) => (row.revertedAt !== null) === wanted);
      return { items, nextCursor: null };
    },
    spawnRun: async () => rows[0],
  } as unknown as HarvestServiceI;

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [RunsPage, RokuTranslatorTestingModule.forTesting()],
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
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(RunsPage);
  fixture.detectChanges();
  await drain();
  fixture.detectChanges();
  return { fixture, queries };
}

const text = (fixture: ComponentFixture<RunsPage>): string =>
  fixture.nativeElement.textContent;

describe('RunsPage, a reverted run', () => {
  it('draws the reverted chip beside the status, not instead of it', async () => {
    const { fixture } = await render([
      run({
        revertedAt: '2026-09-04T08:00:00.000Z',
        revertedByUserId: 'owner-1',
        revertedPriceCount: 214,
      }),
    ]);

    expect(text(fixture)).toContain('harvest.status.COMPLETED');
    expect(text(fixture)).toContain('harvest.runs.row.reverted');
  });

  it('draws no chip on a run that still stands', async () => {
    const { fixture } = await render([run()]);

    expect(text(fixture)).toContain('harvest.status.COMPLETED');
    expect(text(fixture)).not.toContain('harvest.runs.row.reverted');
  });

  /** A uuid in the row would make the row mostly uuid, so it is on hover. */
  it('names the operator on hover rather than in the row', async () => {
    const { fixture } = await render([
      run({
        revertedAt: '2026-09-04T08:00:00.000Z',
        revertedByUserId: 'owner-1',
      }),
    ]);

    const chip = fixture.nativeElement.querySelector('.reverted');
    expect(chip.getAttribute('title')).toBe('owner-1');
  });

  it('asks for both until the filter says otherwise', async () => {
    const { queries } = await render([run()]);

    expect(queries).toHaveLength(1);
    expect(queries[0].reverted).toBeUndefined();
  });

  it('sends the filter to the server and redraws from what comes back', async () => {
    const standing = run({ id: 'run-standing' });
    const taken = run({
      id: 'run-taken',
      revertedAt: '2026-09-04T08:00:00.000Z',
    });
    const { fixture, queries } = await render([standing, taken]);

    fixture.componentInstance.reverted.set('reverted');
    fixture.componentInstance.onRevertedChange();
    await drain();
    fixture.detectChanges();

    expect(queries[1].reverted).toBe(true);
    expect(fixture.componentInstance.rows().map((row) => row.id)).toEqual([
      'run-taken',
    ]);

    fixture.componentInstance.reverted.set('standing');
    fixture.componentInstance.onRevertedChange();
    await drain();
    fixture.detectChanges();

    expect(queries[2].reverted).toBe(false);
    expect(fixture.componentInstance.rows().map((row) => row.id)).toEqual([
      'run-standing',
    ]);
  });
});
