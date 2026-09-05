import {
  ItemCategory,
  ItemSourceMatch,
  PriceSourceKind,
  SourceAliasStatus,
  UnitOfMeasure,
  type LeafletDocument,
  type LeafletOffer,
} from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type { HarvestRun, SourceAlias } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { aliasKeyFor } from './leaflet-rules';
import type { PlatformAdminService } from './platform-admin.service';
import { SourceAliasService } from './source-alias.service';

const RUN = '77777777-7777-4777-8777-777777777777';
const CHAIN = '11111111-1111-4111-8111-111111111111';
const SCOPE = '22222222-2222-4222-8222-222222222222';

const TILE: LeafletOffer = {
  id: 'p05-o01',
  page: 5,
  product: {
    name: 'Cerveza Alhambra Tradicional',
    format: { raw: 'lata 33 cl' },
  },
  pricing: {
    price: { amount: 0.53, currency: 'EUR' },
    basis: 'unit',
    unit_price: { amount: 1.61, currency: 'EUR', per: 'l' },
  },
  source: 'pdf-text',
  raw_text: ['0,53', 'Cerveza Alhambra Tradicional'],
  confidence: 1,
};

function documentOf(offers: LeafletOffer[]): LeafletDocument {
  return {
    schema_version: '1.0',
    source: { file: 'leaflet.pdf', sha256: 'b'.repeat(64), page_count: 40 },
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

function runOf(patch: Partial<HarvestRun> = {}): HarvestRun {
  return {
    id: RUN,
    supermarketId: CHAIN,
    priceScopeId: SCOPE,
    revertedAt: null,
    requestedAt: new Date('2026-08-27T08:00:00.000Z'),
    input: {
      supermarketId: CHAIN,
      priceScopeId: SCOPE,
      validFrom: '2026-08-26T22:00:00.000Z',
      validUntil: '2026-09-23T22:00:00.000Z',
      document: documentOf([TILE]),
    },
    ...patch,
  } as unknown as HarvestRun;
}

function aliasOf(patch: Partial<SourceAlias> = {}): SourceAlias {
  const now = new Date('2026-08-27T09:00:00.000Z');
  return {
    id: 'alias-1',
    supermarketId: CHAIN,
    aliasKey: aliasKeyFor(TILE),
    printedName: TILE.product.name,
    printedFormat: 'lata 33 cl',
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
    firstRunId: RUN,
    lastRunId: RUN,
    ...patch,
  } as unknown as SourceAlias;
}

function build(options: { alias?: SourceAlias; runs?: HarvestRun[] } = {}) {
  const alias = options.alias ?? aliasOf();
  const aliases = {
    findOne: jest.fn(async () => alias),
    save: jest.fn(async (row: SourceAlias) => row),
  };
  const openRuns = options.runs ?? [runOf()];
  const runs = {
    createQueryBuilder: jest.fn(() => {
      const qb = {
        where: () => qb,
        andWhere: () => qb,
        orderBy: () => qb,
        getMany: async () => openRuns,
      };
      return qb;
    }),
    find: jest.fn(async () => openRuns),
  };
  const catalog = {
    addPrices: jest.fn(async () => ({ inserted: 1, confirmed: 0 })),
    createItem: jest.fn(async () => ({ id: 'item-new' })),
  };
  const admin = { requireAdmin: jest.fn(async () => 'operator') };

  const service = new SourceAliasService(
    aliases as unknown as Repository<SourceAlias>,
    runs as unknown as Repository<HarvestRun>,
    catalog as unknown as CatalogClient,
    admin as unknown as PlatformAdminService
  );
  return { service, alias, aliases, catalog, runs };
}

/**
 * The three decisions an admin makes about a queued printed name (plan 0081,
 * section 3), and the half of accepting that is easy to miss.
 */
describe('SourceAliasService (plan 0081, sections 2 and 3)', () => {
  it('accepting binds the item and leaves the printed name alone', async () => {
    const { service, aliases } = build();

    const result = await service.accept({
      userId: 'operator',
      aliasId: 'alias-1',
      itemId: 'item-1',
    });

    const saved = aliases.save.mock.calls[0][0] as SourceAlias;
    expect(saved).toMatchObject({
      itemId: 'item-1',
      status: SourceAliasStatus.ACTIVE,
      matchedBy: ItemSourceMatch.MANUAL,
      confidence: 1,
      // The owner's rule: renaming the item must not change the string the
      // chain printed, or the next leaflet that prints it stops resolving.
      printedName: 'Cerveza Alhambra Tradicional',
      printedFormat: 'lata 33 cl',
    });
    expect(result.alias.printedName).toBe('Cerveza Alhambra Tradicional');
  });

  it('accepting writes the price the row was queued for, with the run id', async () => {
    const { service, catalog } = build();

    const result = await service.accept({
      userId: 'operator',
      aliasId: 'alias-1',
      itemId: 'item-1',
    });

    expect(catalog.addPrices).toHaveBeenCalledWith(
      SCOPE,
      [
        {
          itemId: 'item-1',
          price: 0.53,
          currency: 'EUR',
          unitPrice: 1.61,
          unitPriceLabel: 'l',
          validFrom: '2026-08-26T22:00:00.000Z',
          validUntil: '2026-09-23T22:00:00.000Z',
          details: {
            offerId: 'p05-o01',
            page: 5,
            rawText: ['0,53', 'Cerveza Alhambra Tradicional'],
            promotion: null,
            loyalty: null,
          },
        },
      ],
      // The run's own id, so plan 0082 takes this row back with the rest of
      // that run's rows rather than leaving it behind.
      RUN,
      PriceSourceKind.OFFICIAL_LEAFLET
    );
    expect(result.pricesWritten).toBe(1);
  });

  it('writes nothing for a run whose document no longer names the string', async () => {
    const { service, catalog } = build({
      runs: [
        runOf({
          input: {
            ...runOf().input,
            document: documentOf([
              { ...TILE, product: { name: 'Something else' } },
            ]),
          } as Record<string, unknown>,
        }),
      ],
    });

    const result = await service.accept({
      userId: 'operator',
      aliasId: 'alias-1',
      itemId: 'item-1',
    });

    expect(catalog.addPrices).not.toHaveBeenCalled();
    expect(result.pricesWritten).toBe(0);
  });

  it('writes nothing when the offer it was queued for is a duplicate key', async () => {
    // Section 2.1's residual case survives the accept: the document says two
    // numbers for one printed name, and picking one is still guessing.
    const { service, catalog } = build({
      runs: [
        runOf({
          input: {
            ...runOf().input,
            document: documentOf([
              TILE,
              {
                ...TILE,
                id: 'p05-o02',
                pricing: {
                  price: { amount: 0.79, currency: 'EUR' },
                  basis: 'unit',
                },
              },
            ]),
          } as Record<string, unknown>,
        }),
      ],
    });

    const result = await service.accept({
      userId: 'operator',
      aliasId: 'alias-1',
      itemId: 'item-1',
    });

    expect(catalog.addPrices).not.toHaveBeenCalled();
    expect(result.pricesWritten).toBe(0);
  });

  it('creating a product from a queued name saves one locale and binds it', async () => {
    const { service, catalog, aliases } = build();

    const result = await service.createItem({
      userId: 'operator',
      aliasId: 'alias-1',
      // Plan 0079: no English name, and the item is legal without one.
      name: { es: 'Cerveza Alhambra Tradicional 33 cl' },
      brand: 'Alhambra',
      category: ItemCategory.OTHER,
      defaultUnit: UnitOfMeasure.UNIT,
    });

    expect(catalog.createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        name: { es: 'Cerveza Alhambra Tradicional 33 cl' },
        brand: 'Alhambra',
        // Never rehosted from a chain's own photography (plan 0038, 5.7).
        imageUrl: null,
      })
    );
    expect(result.item).toEqual({ id: 'item-new' });
    const saved = aliases.save.mock.calls[0][0] as SourceAlias;
    expect(saved.itemId).toBe('item-new');
    // Renaming the product changed nothing about what the leaflet printed.
    expect(saved.printedName).toBe('Cerveza Alhambra Tradicional');
  });

  it('refuses to create a product with no name in any language', async () => {
    const { service } = build();

    await expect(
      service.createItem({
        userId: 'operator',
        aliasId: 'alias-1',
        name: {},
        category: ItemCategory.OTHER,
        defaultUnit: UnitOfMeasure.UNIT,
      })
    ).rejects.toThrow(/at least one language/);
  });

  it('rejecting keeps the row so the next leaflet does not ask again', async () => {
    const { service, aliases, catalog } = build();

    const view = await service.reject({
      userId: 'operator',
      aliasId: 'alias-1',
    });

    expect(view.status).toBe(SourceAliasStatus.REJECTED);
    expect((aliases.save.mock.calls[0][0] as SourceAlias).itemId).toBeNull();
    expect(catalog.addPrices).not.toHaveBeenCalled();
  });
});
