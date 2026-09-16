import {
  HarvestWarningCode,
  PriceScopeKind,
  type HarvestRunWarning,
  type PriceScopeView,
} from '@portfolio/luna-shopper/contracts';
import type { CatalogClient } from './catalog-client.service';
import type { RunContext } from './run-context';
import {
  RunExecutor,
  copiesNotWritten,
  describeCopies,
} from './run-executor.service';
import type { RunReportResult } from './run-report.sink';

/**
 * The executor's half of one walk written to several scopes (plan 0118,
 * sections 4 and 7): the copies resolved before the sink opens, and what the
 * run's report says about them afterwards.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const WALKED = '22222222-2222-4222-8222-222222222222';
const W2 = '33333333-3333-4333-8333-333333333333';
const GONE = '44444444-4444-4444-8444-444444444444';

function scope(id: string): PriceScopeView {
  return {
    id,
    supermarketId: CHAIN,
    kind: PriceScopeKind.REGION,
    externalKey: null,
    label: null,
    priority: 300,
  };
}

function build(held: string[]) {
  const catalog = {
    listAllPriceScopes: jest.fn(async () => held.map(scope)),
  } as unknown as CatalogClient;
  // Only the catalog is read by the resolution, so every other dependency is
  // left out rather than faked into something that looks used.
  const executor = new RunExecutor(
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    catalog,
    undefined as never
  );
  const warnings: HarvestRunWarning[] = [];
  const context = {
    warn: (warning: HarvestRunWarning) => warnings.push(warning),
  } as unknown as RunContext;
  const resolve = (requested: unknown) =>
    executor['copyTargets'](context, CHAIN, requested);
  return { resolve, warnings, catalog };
}

function result(over: Partial<RunReportResult>): RunReportResult {
  return {
    pricedScopes: [],
    pricesCopied: {},
    availabilityCopied: {},
    ...over,
  } as RunReportResult;
}

describe('RunExecutor, scope copies (plan 0118)', () => {
  it('drops a target deleted after the spawn, and warns naming it', async () => {
    const { resolve, warnings } = build([WALKED, W2]);

    const copies = await resolve([{ from: WALKED, to: [W2, GONE] }]);

    expect(copies).toEqual(new Map([[WALKED, [W2]]]));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe(HarvestWarningCode.COPY_TARGET_GONE);
    expect(warnings[0].message).toContain(GONE);
  });

  it('asks catalog nothing for a run with no copies', async () => {
    const { resolve, catalog } = build([WALKED]);

    expect(await resolve(undefined)).toEqual(new Map());
    expect(await resolve([])).toEqual(new Map());
    expect(catalog.listAllPriceScopes).not.toHaveBeenCalled();
  });

  it('lists each copy in the report with what it wrote', () => {
    const copies = new Map([[WALKED, [W2]]]);

    expect(
      describeCopies(
        copies,
        result({
          pricesCopied: { [WALKED]: 4232 },
          availabilityCopied: { [WALKED]: 4300 },
        })
      )
    ).toEqual({
      copies: [
        {
          from: WALKED,
          to: [W2],
          pricesCopied: 4232,
          availabilityCopied: 4300,
        },
      ],
    });
  });

  it('adds nothing to the report of a run with no copies', () => {
    expect(describeCopies(new Map(), result({}))).toEqual({});
  });

  it('names a scope copied from that received no price', () => {
    const copies = new Map([
      [WALKED, [W2]],
      [GONE, []],
    ]);

    expect(
      copiesNotWritten(copies, result({ pricedScopes: [WALKED] }))
    ).toEqual([GONE]);
  });
});
