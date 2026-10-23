import {
  createEnvironmentInjector,
  EnvironmentInjector,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  fakeLineStore,
  fakeListStore,
  fakeMemberNames,
  fakeZoneStore,
  GatewayError,
  LINE_SERVICE,
  LineStore,
  Mutations,
  provideFakeListStore,
  provideFakeMemberNames,
  provideFakeZoneStore,
  REALTIME_CLIENT,
  RealtimeMemory,
  type LineServiceI,
} from '@portfolio/velista/data-access';
import type { Line } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { linePageStatus, loadLineContext } from './line-context';

/**
 * Where a page about one line stands (velista 0156). The line page and the history
 * page both draw from this, so the states are asserted once, here, from the store.
 */

const LIST_ID = '3c9a1d02-5f47-4b8e-9a1c-7d2e6b4f0a35';

function line(id: string): Line {
  return { id, listId: LIST_ID, content: 'Milk' } as Line;
}

type Store = Parameters<typeof linePageStatus>[0];

function statusOf(
  options: Parameters<typeof fakeLineStore>[0],
  lineId = 'ln-1'
) {
  return linePageStatus(
    fakeLineStore(options) as unknown as Store,
    LIST_ID,
    lineId
  );
}

describe('linePageStatus', () => {
  it('is ready while the line is held', () => {
    expect(statusOf({ lines: [line('ln-1')] })).toBe('ready');
  });

  it('is loading until the list is read to its end', () => {
    expect(statusOf({ lines: [], state: 'loading' })).toBe('loading');
    expect(statusOf({ lines: [], complete: false })).toBe('loading');
  });

  it('is missing when the list is read to its end without the line', () => {
    // A deleted line and a line of another list both land here: only a backend
    // read could tell them apart.
    expect(statusOf({ lines: [line('ln-2')] })).toBe('missing');
  });

  it('is gone when the read of the lines was refused, or the list does not exist', () => {
    for (const [code, status] of [
      ['forbidden', 403],
      ['not_found', 404],
    ] as const) {
      expect(
        statusOf({
          lines: [],
          state: 'failed',
          error: new GatewayError({ code, status, correlationId: 'cid' }),
        })
      ).toBe('gone');
    }
  });

  it('is failed when the read did not answer, so a retry can help', () => {
    expect(
      statusOf({ lines: [], state: 'failed', error: new Error('offline') })
    ).toBe('failed');
    expect(
      statusOf({
        lines: [],
        state: 'failed',
        error: new GatewayError({
          code: 'internal',
          status: 500,
          correlationId: 'cid',
        }),
      })
    ).toBe('failed');
  });
});

/**
 * The line page and the history page are live through the zone room, like the list
 * page, so a reconnect has to read their list again (velista 0169). The real
 * `LineStore` decides that, from whether the list is held.
 */
describe('loadLineContext', () => {
  function setUp() {
    TestBed.resetTestingModule();
    const reads: string[] = [];
    const service = {
      listLines: async (listId: string) => {
        reads.push(listId);
        return { items: [line('ln-1')], nextCursor: null };
      },
    } as unknown as LineServiceI;
    const realtime = new RealtimeMemory();

    TestBed.configureTestingModule({
      providers: [
        provideVelistaTesting({ basePath: '/velista' }),
        Mutations,
        LineStore,
        { provide: LINE_SERVICE, useValue: service },
        { provide: REALTIME_CLIENT, useValue: realtime },
        provideFakeZoneStore(fakeZoneStore()),
        provideFakeListStore(fakeListStore()),
        provideFakeMemberNames(fakeMemberNames()),
      ],
    });

    const injector = createEnvironmentInjector(
      [],
      TestBed.inject(EnvironmentInjector)
    );
    runInInjectionContext(injector, () =>
      loadLineContext(signal('zone-1'), signal(LIST_ID))
    );

    return { reads, realtime, injector, store: TestBed.inject(LineStore) };
  }

  async function settle(): Promise<void> {
    for (let turn = 0; turn < 5; turn += 1) {
      await Promise.resolve();
    }
  }

  it('reads its list again after a reconnect', async () => {
    const { reads, realtime } = setUp();
    TestBed.tick();
    await settle();
    expect(reads).toEqual([LIST_ID]);

    realtime.setReconnects(1);
    TestBed.tick();
    await settle();

    expect(reads).toEqual([LIST_ID, LIST_ID]);
  });

  it('lets go of the list when the page goes, so a reconnect only marks it stale', async () => {
    const { reads, realtime, injector, store } = setUp();
    TestBed.tick();
    await settle();

    injector.destroy();
    realtime.setReconnects(1);
    TestBed.tick();
    await settle();

    expect(reads).toEqual([LIST_ID]);
    expect(store.stateOf(LIST_ID)).toBe('idle');
  });
});
