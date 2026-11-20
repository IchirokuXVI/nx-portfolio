import {
  EnvironmentInjector,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { HarvestRun } from '@portfolio/luna-shopper-admin/models';
import { SessionStore } from '../auth/session-store';
import { EarlierRunTotals } from './earlier-run-totals';
import { earlierRunTotalsFollowSession } from './earlier-run-totals-follow-session';
import { HARVEST_RUN_SEED } from './harvest-seed';
import { HARVEST_SERVICE } from './harvest-service';

/**
 * The held estimates across a sign out and the next sign in (owner decision
 * 113b of the harvester round).
 */
describe('earlierRunTotalsFollowSession', () => {
  const ABORTED = HARVEST_RUN_SEED.find(
    (run) => run.id === 'run-eljamon-aborted'
  ) as HarvestRun;
  const COMPLETED = HARVEST_RUN_SEED.find(
    (run) => run.id === 'run-eljamon-completed'
  ) as HarvestRun;

  function boot() {
    const signedIn = signal(true);
    const listRuns = jest.fn(async () => ({
      items: [COMPLETED],
      nextCursor: null,
    }));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: HARVEST_SERVICE, useValue: { listRuns } },
        { provide: SessionStore, useValue: { signedIn } },
      ],
    });

    runInInjectionContext(TestBed.inject(EnvironmentInjector), () =>
      earlierRunTotalsFollowSession()
    );

    return { totals: TestBed.inject(EarlierRunTotals), signedIn, listRuns };
  }

  it('keeps the answers while the session holds', async () => {
    const { totals } = boot();
    await totals.resolve(ABORTED);
    TestBed.tick();

    expect(totals.of(ABORTED)).toBe(3402);
  });

  it('clears the answers on sign out, and the next admin reads again', async () => {
    const { totals, signedIn, listRuns } = boot();
    await totals.resolve(ABORTED);
    expect(totals.of(ABORTED)).toBe(3402);

    signedIn.set(false);
    TestBed.tick();

    expect(totals.of(ABORTED)).toBeNull();

    signedIn.set(true);
    TestBed.tick();
    await totals.resolve(ABORTED);

    expect(listRuns).toHaveBeenCalledTimes(2);
    expect(totals.of(ABORTED)).toBe(3402);
  });

  it('drops an answer that was on its way when the session ended', async () => {
    const { totals, signedIn } = boot();
    const lookup = totals.resolve(ABORTED);

    signedIn.set(false);
    TestBed.tick();
    await lookup;

    expect(totals.of(ABORTED)).toBeNull();
  });
});
