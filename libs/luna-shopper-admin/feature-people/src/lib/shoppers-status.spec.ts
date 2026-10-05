import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import {
  DASHBOARD_SERVICE,
  DashboardStore,
  type DashboardDocument,
} from '@portfolio/luna-shopper-admin/data-access';
import { provideSections } from '@portfolio/luna-shopper-admin/feature-resource';
import { ShoppersStatus } from './shoppers-status';
import { SHOPPERS_TEST_SECTION } from './shoppers.testing';

/**
 * How many join requests wait, for the rail and for the Zones tab (admin plan
 * 0045, target 1).
 *
 * One read is behind the count on the rail, the count on the tab and the tile
 * of the Overview. These cases are that read, turned into the answer the
 * frame asks for by the path of each tab.
 */

function document_(core: unknown): DashboardDocument {
  return {
    measuredAt: '2026-10-04T10:00:00.000Z',
    core,
  } as unknown as DashboardDocument;
}

/** A page whose visibility never changes, so no listener ever fires. */
const page = {
  visibilityState: 'visible',
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};

/** Let every pending microtask settle, without a real clock. */
const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
};

function build(answers: readonly unknown[]) {
  let calls = 0;
  const service = {
    read: async (): Promise<DashboardDocument> => {
      const answer = answers[Math.min(calls, answers.length - 1)];
      calls += 1;
      return document_(answer);
    },
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: DASHBOARD_SERVICE, useValue: service },
      { provide: DOCUMENT, useValue: page },
      provideSections(SHOPPERS_TEST_SECTION),
    ],
  });

  return {
    status: TestBed.inject(ShoppersStatus),
    reads: () => calls,
  };
}

describe('ShoppersStatus', () => {
  beforeEach(() => jest.useFakeTimers());

  afterEach(() => {
    TestBed.inject(DashboardStore).stop();
    jest.useRealTimers();
  });

  /** The frame builds it, and the count on the rail is on every screen. */
  it('reads the dashboard from the moment it is built', async () => {
    const { reads } = build([{ memberships: { pending: 3 } }]);
    await settle();

    expect(reads()).toBe(1);
  });

  it('counts the join requests on Zones, and nothing on People', async () => {
    const { status } = build([{ memberships: { pending: 3 } }]);
    await settle();

    expect(status.pending()).toBe(3);
    expect(status.countAt('/shoppers/zones')).toBe(3);
    expect(status.countAt('/shoppers/people')).toBeNull();
  });

  /** Nothing is drawn where nothing is known, and a zero would be a claim. */
  it('is nothing before the first read answers', () => {
    const { status } = build([{ memberships: { pending: 3 } }]);

    expect(status.pending()).toBeNull();
    expect(status.countAt('/shoppers/zones')).toBeNull();
  });

  it('is nothing when core did not answer the read', async () => {
    const { status } = build([null]);
    await settle();

    expect(status.countAt('/shoppers/zones')).toBeNull();
  });

  /** A request was decided, and the rail must not go on saying it waits. */
  it('reads again when asked to', async () => {
    const { status, reads } = build([
      { memberships: { pending: 3 } },
      { memberships: { pending: 2 } },
    ]);
    await settle();

    status.refresh();
    await settle();

    expect(reads()).toBe(2);
    expect(status.countAt('/shoppers/zones')).toBe(2);
  });
});
