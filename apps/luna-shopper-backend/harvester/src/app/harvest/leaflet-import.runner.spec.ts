import {
  HarvestWarningCode,
  ItemSourceMatch,
  PriceSourceKind,
  SourceAliasStatus,
  type HarvestRunWarning,
  type LeafletDocument,
  type LeafletOffer,
} from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type { SourceAlias, SourceCatalogEntry } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { LeafletImportRunner } from './leaflet-import.runner';
import { aliasKeyFor } from './leaflet-rules';
import type { RunContext } from './run-context';

const RUN = '77777777-7777-4777-8777-777777777777';
const CHAIN = '11111111-1111-4111-8111-111111111111';
const SCOPE = '22222222-2222-4222-8222-222222222222';

function offer(patch: Partial<LeafletOffer> = {}): LeafletOffer {
  return {
    id: 'p01-o01',
    page: 1,
    product: { name: 'Cerveza Alhambra Tradicional', format: { raw: '33 cl' } },
    pricing: { price: { amount: 1.19, currency: 'EUR' }, basis: 'unit' },
    source: 'pdf-text',
    ...patch,
  };
}

function documentOf(offers: LeafletOffer[]): LeafletDocument {
  return {
    schema_version: '1.0',
    source: { file: 'leaflet.pdf', sha256: 'a'.repeat(64), page_count: 1 },
    retailer: {
      name: 'El Jamon',
      country: 'ES',
      currency: 'EUR',
      language: 'es',
    },
    validity: { starts_on: '2026-08-27', ends_on: '2026-09-23' },
    offers,
  };
}

function aliasOf(patch: Partial<SourceAlias>): SourceAlias {
  const now = new Date('2026-08-01T00:00:00.000Z');
  return {
    id: 'alias-1',
    supermarketId: CHAIN,
    aliasKey: '',
    printedName: '',
    printedFormat: null,
    printedBrand: null,
    itemId: null,
    candidateItemId: null,
    candidateEntryId: null,
    status: SourceAliasStatus.UNRESOLVED,
    matchedBy: ItemSourceMatch.NAME_SIZE,
    confidence: 0,
    timesSeen: 1,
    firstSeenAt: now,
    lastSeenAt: now,
    firstRunId: null,
    lastRunId: null,
    createdAt: now,
    updatedAt: now,
    ...patch,
  } as unknown as SourceAlias;
}

interface Harness {
  run: (
    offers: LeafletOffer[],
    extractorWarnings?: { page: number; message: string }[]
  ) => Promise<void>;
  catalog: { addPrices: jest.Mock; searchItems: jest.Mock };
  saved: SourceAlias[][];
  warnings: HarvestRunWarning[];
  counters: Record<string, number>;
}

function build(
  options: {
    aliases?: SourceAlias[];
    items?: {
      id: string;
      name: { es?: string };
      brand: string | null;
      unitSize: number | null;
    }[];
    entries?: SourceCatalogEntry[];
  } = {}
): Harness {
  const saved: SourceAlias[][] = [];
  const aliases = {
    find: jest.fn(async () => options.aliases ?? []),
    create: jest.fn((row: Partial<SourceAlias>) => row as SourceAlias),
    save: jest.fn(async (rows: SourceAlias[]) => {
      saved.push(rows);
      return rows;
    }),
  };
  const entries = { find: jest.fn(async () => options.entries ?? []) };
  const catalog = {
    addPrices: jest.fn(async () => ({ inserted: 1, confirmed: 0 })),
    searchItems: jest.fn(async () => ({
      items: (options.items ?? []).map((item) => ({
        ...item,
        ean: null,
      })),
      nextCursor: null,
    })),
  };

  const warnings: HarvestRunWarning[] = [];
  const counters: Record<string, number> = {};
  const runner = new LeafletImportRunner(
    aliases as unknown as Repository<SourceAlias>,
    entries as unknown as Repository<SourceCatalogEntry>,
    catalog as unknown as CatalogClient
  );

  return {
    catalog,
    saved,
    warnings,
    counters,
    run: async (offers, extractorWarnings) => {
      const document = documentOf(offers);
      if (extractorWarnings) {
        document.warnings = extractorWarnings;
      }
      const context = {
        runId: RUN,
        run: {
          id: RUN,
          input: {
            supermarketId: CHAIN,
            priceScopeId: SCOPE,
            validFrom: '2026-08-26T22:00:00.000Z',
            validUntil: '2026-09-23T22:00:00.000Z',
            document,
          },
        },
        setStage: jest.fn(async () => undefined),
        setTotalPlanned: jest.fn(async () => undefined),
        flush: jest.fn(async () => undefined),
        warn: (warning: HarvestRunWarning) => warnings.push(warning),
        report: jest.fn(async (values: Record<string, number>) => {
          for (const [key, value] of Object.entries(values)) {
            counters[key] = (counters[key] ?? 0) + value;
          }
        }),
      } as unknown as RunContext;
      await runner.run(context, { supermarketId: CHAIN, priceScopeId: SCOPE });
    },
  };
}

const codes = (warnings: HarvestRunWarning[]): HarvestWarningCode[] =>
  warnings.map((warning) => warning.code);

/**
 * The ladder (plan 0081, section 3), which every automated path stops one step
 * short of finishing.
 *
 * The rule the whole runner exists to keep: **a fuzzy match never writes a
 * price.** Backlog 0001 section 6.2 is why, and it is the reason each of these
 * cases is worth pinning rather than reading: a bad match writes a wrong price
 * onto a real product that people then shop on, which is worse than no price.
 */
describe('LeafletImportRunner, the ladder (plan 0081, section 3)', () => {
  it('rung 1: an ACTIVE alias writes the price to its item', async () => {
    const tile = offer();
    const harness = build({
      aliases: [
        aliasOf({
          aliasKey: aliasKeyFor(tile),
          status: SourceAliasStatus.ACTIVE,
          itemId: 'item-1',
        }),
      ],
    });

    await harness.run([tile]);

    expect(harness.catalog.addPrices).toHaveBeenCalledWith(
      SCOPE,
      [
        {
          itemId: 'item-1',
          price: 1.19,
          currency: 'EUR',
          unitPrice: null,
          unitPriceLabel: null,
          validFrom: '2026-08-26T22:00:00.000Z',
          validUntil: '2026-09-23T22:00:00.000Z',
          details: {
            offerId: 'p01-o01',
            page: 1,
            rawText: [],
            promotion: null,
            loyalty: null,
          },
        },
      ],
      RUN,
      PriceSourceKind.OFFICIAL_LEAFLET
    );
    // Section 3: every rung moves the row's counters, including the one that
    // wrote a price.
    expect(harness.saved.flat()[0]).toMatchObject({
      timesSeen: 2,
      lastRunId: RUN,
    });
  });

  it('rung 2: a REJECTED alias is skipped with a warning and not asked again', async () => {
    const tile = offer();
    const harness = build({
      aliases: [
        aliasOf({
          aliasKey: aliasKeyFor(tile),
          status: SourceAliasStatus.REJECTED,
        }),
      ],
    });

    await harness.run([tile]);

    expect(harness.catalog.addPrices).not.toHaveBeenCalled();
    expect(codes(harness.warnings)).toEqual([
      HarvestWarningCode.REJECTED_ALIAS,
    ]);
    expect(harness.counters.skipped).toBe(1);
    // Still REJECTED: the owner decided, and a run does not get to reopen it.
    expect(harness.saved.flat()[0].status).toBe(SourceAliasStatus.REJECTED);
  });

  it('rung 3: a queued alias is touched and not duplicated', async () => {
    const tile = offer();
    const harness = build({
      aliases: [
        aliasOf({
          aliasKey: aliasKeyFor(tile),
          status: SourceAliasStatus.CANDIDATE,
          candidateItemId: 'item-9',
        }),
      ],
    });

    await harness.run([tile]);

    expect(harness.catalog.addPrices).not.toHaveBeenCalled();
    expect(codes(harness.warnings)).toEqual([
      HarvestWarningCode.ALREADY_QUEUED,
    ]);
    const rows = harness.saved.flat();
    expect(rows).toHaveLength(1);
    expect(rows[0].timesSeen).toBe(2);
  });

  it('rung 4: a fuzzy hit is a CANDIDATE and writes nothing', async () => {
    const tile = offer({
      product: {
        name: 'Leche Entera Pascual',
        brand: 'Pascual',
        format: { raw: '1 l' },
      },
    });
    const harness = build({
      items: [
        {
          id: 'item-7',
          name: { es: 'Leche Entera Pascual' },
          brand: 'Pascual',
          unitSize: null,
        },
      ],
    });

    await harness.run([tile]);

    expect(harness.catalog.addPrices).not.toHaveBeenCalled();
    expect(codes(harness.warnings)).toEqual([
      HarvestWarningCode.CANDIDATE_MATCH,
    ]);
    expect(harness.saved.flat()[0]).toMatchObject({
      status: SourceAliasStatus.CANDIDATE,
      candidateItemId: 'item-7',
      itemId: null,
      matchedBy: ItemSourceMatch.NAME_SIZE,
      firstRunId: RUN,
    });
  });

  it('rung 4: nothing matched is UNRESOLVED, and keeps what was printed', async () => {
    const harness = build();

    await harness.run([
      offer({
        product: {
          name: 'Cerveza Alhambra Tradicional',
          brand: 'Alhambra',
          format: { raw: 'lata 33 cl' },
        },
      }),
    ]);

    expect(codes(harness.warnings)).toEqual([HarvestWarningCode.NO_MATCH]);
    expect(harness.saved.flat()[0]).toMatchObject({
      status: SourceAliasStatus.UNRESOLVED,
      printedName: 'Cerveza Alhambra Tradicional',
      printedFormat: 'lata 33 cl',
      // Stored for the queue to show, and in no key: one extractor reads a
      // brand where another does not.
      printedBrand: 'Alhambra',
      confidence: 0,
    });
  });

  it('two offers with one key both queue, and neither writes', async () => {
    const tile = offer();
    const harness = build({
      aliases: [
        aliasOf({
          aliasKey: aliasKeyFor(tile),
          status: SourceAliasStatus.ACTIVE,
          itemId: 'item-1',
        }),
      ],
    });

    await harness.run([
      tile,
      offer({
        id: 'p01-o02',
        pricing: { price: { amount: 2.29, currency: 'EUR' }, basis: 'unit' },
      }),
    ]);

    // Even an ACTIVE alias writes nothing here: the document says two different
    // numbers for one printed name, and picking one is guessing.
    expect(harness.catalog.addPrices).not.toHaveBeenCalled();
    expect(codes(harness.warnings)).toEqual([
      HarvestWarningCode.DUPLICATE_KEY,
      HarvestWarningCode.DUPLICATE_KEY,
    ]);
    expect(harness.counters.skipped).toBe(2);
  });

  it('a loyalty gated offer writes nothing and creates no queue row', async () => {
    const harness = build();

    await harness.run([
      offer({ loyalty: { required: true, program: 'ifamilia' } }),
    ]);

    expect(harness.catalog.addPrices).not.toHaveBeenCalled();
    expect(codes(harness.warnings)).toEqual([
      HarvestWarningCode.LOYALTY_REQUIRED,
    ]);
    // Skipped entirely (section 6.3): no price row, no alias, no flag.
    expect(harness.saved.flat()).toHaveLength(0);
    expect(harness.counters.skipped).toBe(1);
  });

  it("carries the extractor's own warnings into the run", async () => {
    const harness = build();

    await harness.run([], [{ page: 12, message: 'Tile too faint to read' }]);

    // They arrive naming a page and no offer, so the admin sees what the
    // extractor lost beside what the import skipped.
    expect(harness.warnings).toEqual([
      {
        code: HarvestWarningCode.EXTRACTOR,
        offerId: null,
        page: 12,
        name: null,
        message: 'Tile too faint to read',
      },
    ]);
  });

  it('a conditional tile with no single unit price queues rather than guessing', async () => {
    const harness = build();

    await harness.run([
      offer({
        promotion: {
          type: 'multibuy_total',
          raw_text: '2 unidades por 1,18',
          total_price: { amount: 1.18, currency: 'EUR' },
        },
      }),
    ]);

    expect(harness.catalog.addPrices).not.toHaveBeenCalled();
    expect(codes(harness.warnings)).toEqual([
      HarvestWarningCode.CONDITIONAL_PRICE,
    ]);
    expect(harness.saved.flat()[0]).toMatchObject({
      status: SourceAliasStatus.UNRESOLVED,
    });
  });
});
