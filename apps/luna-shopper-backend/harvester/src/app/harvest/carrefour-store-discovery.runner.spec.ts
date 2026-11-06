import type { ConfigService } from '@nestjs/config';
import {
  CARREFOUR_DRIVES_PATH,
  CARREFOUR_REFUSAL_POLICY,
  CARREFOUR_STORE_LOCATOR_PATH,
  CarrefourClient,
} from '@portfolio/luna-shopper/carrefour';
import { PostalCodeSource } from '@portfolio/luna-shopper/contracts';
import {
  SourceBlockedError,
  SourceGuard,
} from '@portfolio/luna-shopper/source-guard';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupermarketSource } from '../entities';
import { CarrefourStoreDiscoveryRunner } from './carrefour-store-discovery.runner';
import type { RunContext } from './run-context';
import { RecordingRunReport, type ObservedPlace } from './run-report';

/**
 * Store discovery against Carrefour's own store finder (plan 0223).
 *
 * **Nothing here launches Chromium or reaches a network.** The client is the
 * real one, on a fake browser session that serves the two documents the
 * library's `capture-fixtures` wrote on 2026-11-06. They are read from disk
 * rather than imported, so this spec reaches into no other project's module
 * graph, and a recapture shows up here as a count that moved.
 */

const FIXTURES = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'libs',
  'luna-shopper',
  'carrefour',
  'src',
  'lib',
  '__fixtures__'
);
const XML = readFileSync(join(FIXTURES, 'store-locator.xml'), 'utf8');
const DRIVES = readFileSync(join(FIXTURES, 'drives.json'), 'utf8');

const CHAIN = '11111111-1111-4111-8111-111111111111';
const RUN = '33333333-3333-4333-8333-333333333333';
const CHAIN_IDENTITY = { externalBrandKey: 'Q217599', brandName: 'Carrefour' };

/** What the fake browser answers for one URL. */
type Answer = { status: number; body?: string };

const serve = (url: string): Answer =>
  url.endsWith(CARREFOUR_STORE_LOCATOR_PATH)
    ? { status: 200, body: XML }
    : url.endsWith(CARREFOUR_DRIVES_PATH)
      ? { status: 200, body: DRIVES }
      : { status: 404 };

class TestRunner extends CarrefourStoreDiscoveryRunner {
  readonly asked: string[] = [];
  opened = 0;
  closed = 0;

  constructor(private readonly answer: (url: string) => Answer = serve) {
    super({
      getOrThrow: () => ({ userAgent: 'LunaShopperBot/1.0' }),
    } as unknown as ConfigService);
  }

  protected override createClient(context: RunContext): CarrefourClient {
    return new CarrefourClient({
      userAgent: 'LunaShopperBot/1.0',
      acquire: context.acquire,
      guard: context.guard,
      signal: context.signal,
      sleepImpl: async () => undefined,
      openSession: async () => {
        this.opened += 1;
        return {
          goto: async () => {
            throw new Error('a store run reads no page state');
          },
          fetchText: async (url: string) => {
            this.asked.push(url);
            const { status, body } = this.answer(url);
            return { status, body: status === 200 ? (body ?? '') : null };
          },
          close: async () => {
            this.closed += 1;
          },
        };
      },
    });
  }
}

type TestContext = RunContext & { setReport: jest.Mock };

function context(signal = new AbortController().signal): TestContext {
  return {
    runId: RUN,
    signal,
    acquire: async () => undefined,
    setStage: jest.fn(async () => undefined),
    setTotalPlanned: jest.fn(async () => undefined),
    setReport: jest.fn(async () => undefined),
    report: jest.fn(async () => undefined),
    heartbeat: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
    warn: jest.fn(),
  } as unknown as TestContext;
}

/**
 * A context with the run's refusal guard, wired the way `RunExecutor` wires
 * it: its stop aborts the run with the stop as the reason (plan 0215).
 */
function guardedContext(): TestContext {
  const controller = new AbortController();
  const ctx = context(controller.signal);
  const guard = new SourceGuard(CARREFOUR_REFUSAL_POLICY, {
    onStop: (stop) => controller.abort(new SourceBlockedError(stop)),
  });
  return Object.assign(ctx, {
    guard,
    acquire: () => guard.admit(controller.signal),
  });
}

const source = (config: Record<string, unknown> = {}): SupermarketSource =>
  ({ adapterKey: 'carrefour-web', config, workers: 1 }) as SupermarketSource;

const input = (postalCodes?: string[]) => ({
  postalCode: '',
  country: 'es',
  radiusMetres: 0,
  supermarketId: CHAIN,
  chain: CHAIN_IDENTITY,
  postalCodes,
});

const reportOf = (ctx: TestContext): Record<string, unknown> =>
  ctx.setReport.mock.calls[0][0];

const formatOf = (place: ObservedPlace): string =>
  place.tags['carrefour:format'];

describe('CarrefourStoreDiscoveryRunner', () => {
  let report: RecordingRunReport;

  beforeEach(() => {
    report = new RecordingRunReport();
  });

  it('reports the hypermarkets and Markets by default, in two loads', async () => {
    const runner = new TestRunner();
    const ctx = context();
    await runner.run(ctx, report, input(), source());

    expect(runner.asked).toEqual([
      'https://www.carrefour.es' + CARREFOUR_STORE_LOCATOR_PATH,
      'https://www.carrefour.es' + CARREFOUR_DRIVES_PATH,
    ]);
    expect(report.places).toHaveLength(365);
    expect(new Set(report.places.map(formatOf))).toEqual(
      new Set(['HIPERMERCADO', 'MARKET'])
    );
    expect(report.places.every((place) => place.provider === 'CARREFOUR')).toBe(
      true
    );
    expect(report.places.every((place) => place.scopeKey === null)).toBe(true);
    expect(reportOf(ctx)).toEqual({
      recordsRead: 1976,
      groceryShops: 1586,
      formats: ['HIPERMERCADO', 'MARKET'],
      shopsReported: 365,
      shopsWithSalePoint: 178,
      droppedRecords: expect.any(Array),
      postalCodesWithNoShop: [],
      warnings: [],
      loads: 2,
    });
    expect(reportOf(ctx)['droppedRecords']).toHaveLength(390);
  });

  it('writes the fields of section 6.2 on a hypermarket with a drive', async () => {
    const runner = new TestRunner();
    await runner.run(context(), report, input(), source());

    const pinar = report.places.find(
      (place) => place.name === 'Carrefour El Pinar'
    );
    expect(pinar).toEqual({
      provider: 'CARREFOUR',
      externalRef: 'tcm:5-3890',
      brandKey: 'Q217599',
      brandName: 'Carrefour',
      name: 'Carrefour El Pinar',
      latitude: expect.any(Number),
      longitude: expect.any(Number),
      street: expect.any(String),
      city: expect.any(String),
      postalCode: '28230',
      postalCodeSource: PostalCodeSource.SOURCE,
      country: 'es',
      website: expect.stringMatching(/^https:\/\/www\.carrefour\.es\//),
      openingHours: null,
      tags: expect.objectContaining({
        'carrefour:format': 'HIPERMERCADO',
        'carrefour:category': 'Hipermercado',
        'carrefour:salePoint': '005290',
        'carrefour:driveName': 'Drive Hiper El Pinar',
        'carrefour:hours1': expect.any(String),
        'addr:province': 'Madrid',
      }),
      scopeKey: null,
    });
  });

  it('reports the Express shops alone when the row names that format', async () => {
    const runner = new TestRunner();
    const ctx = context();
    await runner.run(
      ctx,
      report,
      input(),
      source({ storeFormats: ['EXPRESS'] })
    );

    expect(report.places).toHaveLength(835);
    expect(new Set(report.places.map(formatOf))).toEqual(new Set(['EXPRESS']));
    // An Express shop has no online service, so none carries a sale point.
    expect(
      report.places.some((place) => 'carrefour:salePoint' in place.tags)
    ).toBe(false);
    expect(reportOf(ctx)['formats']).toEqual(['EXPRESS']);
  });

  it('refuses an unknown format before any load, naming the valid ones', async () => {
    const runner = new TestRunner();
    await expect(
      runner.run(
        context(),
        report,
        input(),
        source({ storeFormats: ['HIPERMERCADO', 'OUTLET'] })
      )
    ).rejects.toThrow(
      /OUTLET.*HIPERMERCADO, MARKET, EXPRESS, EXPRESS_CEPSA, BIO/
    );
    expect(runner.asked).toEqual([]);
    expect(runner.opened).toBe(0);
  });

  it('reports exactly the shops on a postal code it was asked for', async () => {
    const runner = new TestRunner();
    const ctx = context();
    await runner.run(ctx, report, input(['14011', '99999']), source());

    expect(report.places.map((place) => place.name)).toEqual([
      'Carrefour La Sierra',
    ]);
    expect(reportOf(ctx)['postalCodesWithNoShop']).toEqual(['99999']);
  });

  it('completes with a warning when the drive list cannot be read', async () => {
    const runner = new TestRunner((url) =>
      url.endsWith(CARREFOUR_DRIVES_PATH) ? { status: 500 } : serve(url)
    );
    const ctx = context();
    await runner.run(ctx, report, input(), source());

    expect(report.places).toHaveLength(365);
    expect(
      report.places.some((place) => 'carrefour:salePoint' in place.tags)
    ).toBe(false);
    expect(reportOf(ctx)['shopsWithSalePoint']).toBe(0);
    expect(reportOf(ctx)['warnings']).toEqual([
      expect.stringContaining('drive list could not be read'),
    ]);
    expect(runner.closed).toBe(1);
  });

  it('fails the run on a refusal that stops the guard, and closes the browser', async () => {
    const ctx = guardedContext();
    const guard = ctx.guard as SourceGuard;
    // Two refusals elsewhere in the run, then the drive list is the third in
    // a row: the address is refused, which is not a failed drive read.
    const runner = new TestRunner((url) => {
      if (url.endsWith(CARREFOUR_DRIVES_PATH)) {
        guard.refused(403, '/elsewhere/1');
        guard.refused(403, '/elsewhere/2');
        return { status: 403 };
      }
      return serve(url);
    });

    await expect(
      runner.run(ctx, report, input(), source())
    ).rejects.toBeInstanceOf(SourceBlockedError);
    // The executor ends a run whose guard stopped with SOURCE_BLOCKED.
    expect(guard.stop).not.toBeNull();
    expect(ctx.signal.aborted).toBe(true);
    expect(report.places).toEqual([]);
    expect(runner.closed).toBe(1);
  });

  it('closes the browser after a run that worked', async () => {
    const runner = new TestRunner();
    await runner.run(context(), report, input(), source());
    expect(runner.opened).toBe(1);
    expect(runner.closed).toBe(1);
  });

  it('closes the browser after a run whose store finder failed', async () => {
    const runner = new TestRunner(() => ({ status: 200, body: '<html/>' }));
    await expect(
      runner.run(context(), report, input(), source())
    ).rejects.toThrow(CARREFOUR_STORE_LOCATOR_PATH);
    expect(runner.closed).toBe(1);
  });

  it('refuses a run that does not say which chain it is reading', async () => {
    const runner = new TestRunner();
    await expect(
      runner.run(
        context(),
        report,
        { ...input(), supermarketId: undefined },
        source()
      )
    ).rejects.toThrow(/which chain/);
    expect(runner.opened).toBe(0);
  });
});
