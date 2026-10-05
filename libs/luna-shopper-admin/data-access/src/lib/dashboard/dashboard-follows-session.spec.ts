import { DOCUMENT } from '@angular/common';
import {
  EnvironmentInjector,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SessionStore } from '../auth/session-store';
import { dashboardFollowsSession } from './dashboard-follows-session';
import { DASHBOARD_SERVICE, type DashboardDocument } from './dashboard-service';
import { DashboardStore } from './dashboard-store';

/**
 * What the rail's two counters read, across a sign out and the next sign in.
 *
 * `HarvestStatus` and `ShoppersStatus` both start the dashboard watch when
 * they are built and never stop it. This is the one place that stops the read
 * for both, so it is asserted against the store they share.
 */
describe('dashboardFollowsSession', () => {
  const settle = () => Promise.resolve().then(() => undefined);

  function boot(startsSignedIn: boolean) {
    let reads = 0;
    const signedIn = signal(startsSignedIn);
    const document_ = (): DashboardDocument => ({
      measuredAt: `2026-09-03T10:00:0${reads}.000Z`,
      harvest: null,
    });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DASHBOARD_SERVICE,
          useValue: {
            read: async () => {
              reads += 1;
              return document_();
            },
          },
        },
        {
          provide: DOCUMENT,
          useValue: {
            visibilityState: 'visible',
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
          },
        },
        { provide: SessionStore, useValue: { signedIn } },
      ],
    });

    runInInjectionContext(TestBed.inject(EnvironmentInjector), () =>
      dashboardFollowsSession()
    );

    return {
      store: TestBed.inject(DashboardStore),
      signedIn,
      reads: () => reads,
    };
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('leaves a session that is already held alone', async () => {
    const { store, reads } = boot(true);

    // What a counter of the rail does when the frame builds it.
    store.watch();
    await settle();

    expect(reads()).toBe(1);
    expect(store.document()).not.toBeNull();
    store.stop();
  });

  it('clears the document and stops the read on sign out', async () => {
    const { store, signedIn, reads } = boot(true);
    store.watch();
    await settle();

    signedIn.set(false);
    TestBed.tick();

    expect(store.document()).toBeNull();
    jest.advanceTimersByTime(5 * 60_000);
    await settle();
    expect(reads()).toBe(1);
    store.stop();
  });

  it('reads again for the next admin, who never sees the last document', async () => {
    const { store, signedIn, reads } = boot(true);
    store.watch();
    await settle();
    const first = store.measuredAt();

    signedIn.set(false);
    TestBed.tick();
    signedIn.set(true);
    TestBed.tick();

    // Nothing of the last admin is on screen while the read is on its way.
    expect(store.document()).toBeNull();
    await settle();

    expect(reads()).toBe(2);
    expect(store.measuredAt()).not.toBe(first);
    store.stop();
  });

  it('reads nothing before the first sign in', async () => {
    const { store, signedIn, reads } = boot(false);

    store.watch();
    await settle();
    expect(reads()).toBe(0);

    signedIn.set(true);
    TestBed.tick();
    await settle();
    expect(reads()).toBe(1);
    store.stop();
  });
});
