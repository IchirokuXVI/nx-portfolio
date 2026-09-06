import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import type { HarvestRun } from '@portfolio/luna-shopper-admin/models';
import { GatewayError } from '../gateway-error';
import { HARVEST_RUN_SEED } from '../harvest/harvest-seed';
import { RUN_POLL_INTERVAL_MS } from '../harvest/run-watch';
import { DASHBOARD_SERVICE, type DashboardDocument } from './dashboard-service';
import { DASHBOARD_POLL_INTERVAL_MS, DashboardStore } from './dashboard-store';

const RUNNING = HARVEST_RUN_SEED.find(
  (run) => run.status === 'RUNNING'
) as HarvestRun;

function document_(over: Partial<DashboardDocument> = {}): DashboardDocument {
  return { measuredAt: '2026-09-03T10:00:00.000Z', harvest: null, ...over };
}

/** A document whose visibility a spec can set, and whose listeners it can fire. */
function fakeDocument(state: DocumentVisibilityState = 'visible') {
  const listeners: (() => void)[] = [];

  return {
    visibilityState: state,
    addEventListener: (_: string, handler: EventListener) =>
      listeners.push(handler as () => void),
    removeEventListener: (_: string, handler: EventListener) => {
      const index = listeners.indexOf(handler as () => void);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    },
    change(next: DocumentVisibilityState) {
      this.visibilityState = next;
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

/**
 * A service whose answers are scripted, one per read.
 *
 * An entry that is an error is thrown rather than returned, which is how the
 * spec drives the case the store exists for: a re-read that fails after one that
 * did not.
 */
function reader(answers: readonly (DashboardDocument | Error)[]) {
  let call = 0;

  return {
    get calls() {
      return call;
    },
    read: async (): Promise<DashboardDocument> => {
      const answer = answers[Math.min(call, answers.length - 1)];
      call += 1;
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
  };
}

/** Let every pending microtask settle, without a real clock. */
const settle = () => Promise.resolve().then(() => undefined);

function build(
  service: { read(): Promise<DashboardDocument> },
  page = fakeDocument()
) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: DASHBOARD_SERVICE, useValue: service },
      { provide: DOCUMENT, useValue: page },
    ],
  });

  return { store: TestBed.inject(DashboardStore), page };
}

describe('DashboardStore', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('reads once on the first watch and holds the document', async () => {
    const service = reader([document_()]);
    const { store } = build(service);

    store.watch();
    await settle();

    expect(service.calls).toBe(1);
    expect(store.loading()).toBe(false);
    expect(store.measuredAt()).toBe('2026-09-03T10:00:00.000Z');
    store.stop();
  });

  it('reads again a minute later', async () => {
    const service = reader([document_()]);
    const { store } = build(service);

    store.watch();
    await settle();

    jest.advanceTimersByTime(DASHBOARD_POLL_INTERVAL_MS - 1);
    await settle();
    expect(service.calls).toBe(1);

    jest.advanceTimersByTime(1);
    await settle();
    expect(service.calls).toBe(2);
    store.stop();
  });

  /**
   * Once a minute is the wrong cadence for a progress bar, so a run in flight
   * pulls the interval down to the one the run screen polls at.
   */
  it('drops to the run interval while a run is in flight', async () => {
    const service = reader([document_({ harvest: { running: RUNNING } })]);
    const { store } = build(service);

    store.watch();
    await settle();

    expect(store.runInFlight()).toBe(true);
    expect(store.interval()).toBe(RUN_POLL_INTERVAL_MS);

    jest.advanceTimersByTime(RUN_POLL_INTERVAL_MS);
    await settle();
    expect(service.calls).toBe(2);
    store.stop();
  });

  it('goes back to the slow interval when the run has finished', async () => {
    const service = reader([
      document_({ harvest: { running: RUNNING } }),
      document_({ harvest: { running: null } }),
    ]);
    const { store } = build(service);

    store.watch();
    await settle();
    jest.advanceTimersByTime(RUN_POLL_INTERVAL_MS);
    await settle();

    expect(store.runInFlight()).toBe(false);
    expect(store.interval()).toBe(DASHBOARD_POLL_INTERVAL_MS);

    jest.advanceTimersByTime(RUN_POLL_INTERVAL_MS * 5);
    await settle();
    expect(service.calls).toBe(2);
    store.stop();
  });

  /**
   * A run the gateway still calls `running` but which has reached a terminal
   * status would otherwise hold the fast poll open until something else changed.
   */
  it('treats a terminal run as no run in flight', async () => {
    const service = reader([
      document_({ harvest: { running: { ...RUNNING, status: 'COMPLETED' } } }),
    ]);
    const { store } = build(service);

    store.watch();
    await settle();

    expect(store.runInFlight()).toBe(false);
    store.stop();
  });

  it('reads nothing while the tab is hidden', async () => {
    const service = reader([document_()]);
    const { store, page } = build(service);

    store.watch();
    await settle();
    expect(service.calls).toBe(1);

    page.change('hidden');
    jest.advanceTimersByTime(DASHBOARD_POLL_INTERVAL_MS * 3);
    await settle();

    expect(service.calls).toBe(1);
    store.stop();
  });

  /**
   * Waiting out a minute would show numbers from before the tab was hidden under
   * a timestamp the operator has to read to notice.
   */
  it('reads at once when the tab comes back', async () => {
    const service = reader([document_()]);
    const { store, page } = build(service);

    store.watch();
    await settle();
    page.change('hidden');
    page.change('visible');
    await settle();

    expect(service.calls).toBe(2);
    store.stop();
  });

  /**
   * The numbers on screen were true a minute ago, and a screen that blanks every
   * time the gateway hiccups is one that is never trusted.
   */
  it('keeps the previous document when a re-read fails', async () => {
    const service = reader([
      document_({ measuredAt: '2026-09-03T10:00:00.000Z' }),
      new GatewayError({ code: '', status: 500, correlationId: '' }),
    ]);
    const { store } = build(service);

    store.watch();
    await settle();
    jest.advanceTimersByTime(DASHBOARD_POLL_INTERVAL_MS);
    await settle();

    expect(store.document()).not.toBeNull();
    expect(store.measuredAt()).toBe('2026-09-03T10:00:00.000Z');
    expect(store.failed()?.status).toBe(500);
    expect(store.empty()).toBe(false);
    store.stop();
  });

  /** A first read with nothing to keep is the one failure that takes the screen. */
  it('is empty when the first read fails', async () => {
    const service = reader([
      new GatewayError({ code: '', status: 0, correlationId: '' }),
    ]);
    const { store } = build(service);

    store.watch();
    await settle();

    expect(store.empty()).toBe(true);
    expect(store.document()).toBeNull();
    expect(store.loading()).toBe(false);
    store.stop();
  });

  it('clears the failure once a read answers again', async () => {
    const service = reader([
      new GatewayError({ code: '', status: 500, correlationId: '' }),
      document_(),
    ]);
    const { store } = build(service);

    store.watch();
    await settle();
    await store.load();

    expect(store.failed()).toBeNull();
    expect(store.document()).not.toBeNull();
    store.stop();
  });

  it('reads nothing more once it is stopped', async () => {
    const service = reader([document_()]);
    const { store } = build(service);

    store.watch();
    await settle();
    store.stop();

    jest.advanceTimersByTime(DASHBOARD_POLL_INTERVAL_MS * 3);
    await settle();

    expect(service.calls).toBe(1);
  });

  /** A second screen asking for the same store must not double the polling. */
  it('starts one watch however many times it is asked', async () => {
    const service = reader([document_()]);
    const { store } = build(service);

    store.watch();
    store.watch();
    await settle();

    expect(service.calls).toBe(1);
    store.stop();
  });
});
