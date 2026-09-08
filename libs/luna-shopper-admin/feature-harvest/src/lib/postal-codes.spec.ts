import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  GatewayError,
  HARVEST_SERVICE,
  HarvestMemory,
  POSTAL_CODE_SERVICE,
  PostalCodeMemory,
  PostalCodeSummaryStore,
  type HarvestServiceI,
  type PostalCodeServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import type {
  NamedAction,
  ResourceGateway,
  ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { PostalCodeQueueGateway } from './postal-code-queue-gateway';
import type { PostalCodeRow } from './postal-code-row';
import { POSTAL_CODES } from './postal-codes';

/**
 * The postal code queue as a resource (admin plan 0021, section 8).
 *
 * Most of what this screen is lives in a descriptor and a gateway, so most of
 * what is worth asserting can be read without rendering anything: which columns
 * there are, which filters, which action, and how many times the demand is
 * asked for.
 */

/** The harvester, with every call recorded so a fan out is visible. */
function recorded<T extends object>(
  inner: T
): {
  service: T;
  calls: { name: string; args: unknown[] }[];
} {
  const calls: { name: string; args: unknown[] }[] = [];

  const service = new Proxy(inner, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || typeof property !== 'string') {
        return value;
      }

      return (...args: unknown[]) => {
        calls.push({ name: property, args });
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as T;

  return { service, calls };
}

/** What the app provides, with the two services replaceable. */
function configure(overrides: {
  harvest?: HarvestServiceI;
  postalCodes?: PostalCodeServiceI;
}): void {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [RokuTranslatorTestingModule.forTesting()],
    providers: [
      {
        provide: HARVEST_SERVICE,
        useValue: overrides.harvest ?? new HarvestMemory(),
      },
      {
        provide: POSTAL_CODE_SERVICE,
        useValue: overrides.postalCodes ?? new PostalCodeMemory(),
      },
    ],
  });
}

describe('the postal codes descriptor', () => {
  /** Section 2's table, in order. */
  it('shows the columns of section 2 and drops two of them on a phone', () => {
    expect(POSTAL_CODES.list.columns).toEqual([
      'postalCode',
      'placeName',
      'status',
      'lastLooked',
      'found',
      'accepted',
      'waiting',
      'attempts',
    ]);
    expect(POSTAL_CODES.list.compact).not.toContain('waiting');
    expect(POSTAL_CODES.list.compact).not.toContain('attempts');
  });

  /**
   * One filter, and it is the search box.
   *
   * The route offers a status filter as well and this screen declines it: the
   * whole table is the working set, and hiding rows behind a status picker
   * before anybody has looked at them is how a queue gets forgotten.
   */
  it('offers exactly one filter, on the code', () => {
    expect(POSTAL_CODES.filters).toEqual([
      {
        kind: 'search',
        param: 'postalCode',
        label: 'harvest.postalCodes.filter.postalCode',
      },
    ]);
  });

  /**
   * Nothing is sortable, because the harvester cannot order by a number core
   * owns and a header that looked sortable and was not would be a worse lie
   * than a plain column.
   */
  it('offers no sort and no edit or delete', () => {
    expect(POSTAL_CODES.sorts).toBeUndefined();
    expect(POSTAL_CODES.actions?.edit).toBeUndefined();
    expect(POSTAL_CODES.actions?.delete).toBeUndefined();
    expect(POSTAL_CODES.actions?.create).toBe(true);
  });

  /** The address is the code, so a link an operator reads says which code. */
  it('addresses a row by its code and not by its id', () => {
    const row = { id: 'postal-14013', postalCode: '14013' } as ResourceRow;

    expect(POSTAL_CODES.rowId?.(row)).toBe('14013');
    expect(POSTAL_CODES.title(row)).toBe('14013');
  });
});

describe('discover again', () => {
  const named = (): readonly NamedAction<ResourceRow>[] =>
    TestBed.runInInjectionContext(() => POSTAL_CODES.actions?.named?.() ?? []);

  const action = (): NamedAction<ResourceRow> => named()[0];

  beforeEach(() => {
    configure({});
  });

  it('is the one named action, and it confirms first', () => {
    const named = TestBed.runInInjectionContext(
      () => POSTAL_CODES.actions?.named?.() ?? []
    );

    expect(named).toHaveLength(1);
    expect(named[0].name).toBe('discover-again');
    // Confirmed, because it starts a run that fetches from a public service.
    expect(named[0].confirm).toEqual({
      heading: 'harvest.postalCodes.confirm.discoverAgain.heading',
      body: 'harvest.postalCodes.confirm.discoverAgain.body',
      confirm: 'harvest.postalCodes.confirm.discoverAgain.confirm',
    });
  });

  /**
   * A row the harvester is working on cannot be queued again, and the route
   * refuses it. Saying so with a control that is not offered is better than an
   * error the operator has to read to learn the same thing.
   */
  it('is unavailable while the row is running', () => {
    const running = { status: 'RUNNING' } as ResourceRow;
    const parked = { status: 'PARKED' } as ResourceRow;

    expect(action().available?.(running)).toBe(false);
    expect(action().available?.(parked)).toBe(true);
  });

  it('queues the row it was given', async () => {
    const { service, calls } = recorded(new HarvestMemory());
    configure({ harvest: service });

    await action().run({ id: 'postal-14900' } as ResourceRow);

    expect(
      calls.filter((call) => call.name === 'requeuePostalCode')[0].args
    ).toEqual(['postal-14900']);
  });
});

describe('the postal codes gateway', () => {
  const gateway = (): ResourceGateway<PostalCodeRow> =>
    TestBed.inject(PostalCodeQueueGateway);

  /**
   * Section 2.1's first rule: one call per page, never one per row.
   *
   * The seeded page holds five working rows, so a fan out would be five calls
   * and would look exactly like a working screen until somebody watched the
   * network.
   */
  it('asks core once for a whole page of rows', async () => {
    const { service, calls } = recorded(new PostalCodeMemory());
    configure({ postalCodes: service });

    const page = await gateway().list({});

    expect(page.items.length).toBeGreaterThan(1);
    expect(calls.filter((call) => call.name === 'usage')).toHaveLength(1);
    // Every code of the page in that one call.
    expect(calls[0].args[1]).toEqual(page.items.map((row) => row.postalCode));
  });

  /** The demand really lands on the rows, or the column would be honest and empty. */
  it('puts the main and near profiles together on the row', async () => {
    configure({});

    const page = await gateway().list({});
    const cordoba = page.items.find((row) => row.postalCode === '14013');

    // Nine typed it and four had it derived onto them; the suppressed one is
    // waiting on nothing and is left out.
    expect(cordoba?.waiting).toBe(13);
  });

  /**
   * Section 2.1's second rule: a failure blanks the column and nothing else.
   *
   * The rows render, the numbers are absent rather than zero, and the screen
   * gains a sentence saying the count could not be read.
   */
  it('renders every row with an empty column when core does not answer', async () => {
    configure({
      postalCodes: {
        usage: async () => {
          throw new GatewayError({
            code: '',
            status: 500,
            correlationId: '',
          });
        },
        nearby: async () => ({
          country: 'es',
          postalCode: '',
          known: false,
          postalCodes: [],
        }),
        shipped: async () => null,
      },
    });

    const page = await gateway().list({});

    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((row) => row.waiting === null)).toBe(true);
    expect(TestBed.inject(PostalCodeQueueGateway).notices()).toContain(
      'harvest.postalCodes.notice.demandUnavailable'
    );
  });

  /** The prefix filter is what the search box sets, and it reaches the route. */
  it('sends the search box through as the postal code filter', async () => {
    const { service, calls } = recorded(new HarvestMemory());
    configure({ harvest: service });

    await gateway().list({ filters: { postalCode: '140' } });

    // By name, because the banner's summary read goes out on the same page load.
    const listed = calls.filter((call) => call.name === 'listPostalCodes');
    expect(listed[0].args[0]).toMatchObject({ postalCode: '140' });
  });

  /** There is no route that reads one row, so the collection is the read. */
  it('reads one row by its code, exactly and not by prefix', async () => {
    configure({});

    const row = await gateway().read('14013');

    expect(row.postalCode).toBe('14013');
    expect(row.id).toBe('postal-14013');
  });
});

describe('the banner above the list', () => {
  /**
   * Section 4.1. A queue that fills and never empties is the designed behaviour
   * of a cluster with `HARVEST_ENABLED` false, and an operator pressing discover
   * again there deserves to be told rather than left watching a row.
   */
  it('shows when nothing drains the queue and hides when something does', async () => {
    const draining = {
      queued: 1,
      running: 0,
      done: 0,
      failed: 0,
      parked: 0,
      oldestQueuedAt: null,
      draining: false,
    };

    configure({
      harvest: Object.assign(new HarvestMemory(), {
        postalCodeSummary: async () => draining,
      }),
    });

    const gateway = TestBed.inject(PostalCodeQueueGateway);
    await TestBed.inject(PostalCodeSummaryStore).load(true);

    expect(gateway.notices()).toContain(
      'harvest.postalCodes.notice.notDraining'
    );

    configure({});
    const other = TestBed.inject(PostalCodeQueueGateway);
    await TestBed.inject(PostalCodeSummaryStore).load(true);

    expect(other.notices()).toEqual([]);
  });
});
