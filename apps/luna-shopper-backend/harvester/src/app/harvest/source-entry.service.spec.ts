import {
  ItemCategory,
  ItemSourceMatch,
  ItemSourceRefStatus,
  UnitOfMeasure,
  type ItemView,
} from '@portfolio/luna-shopper/contracts';
import type { SourceCatalogEntry } from '../entities';
import { SourceEntryService } from './source-entry.service';

/**
 * Promoting a source entry to a catalog item (plan 0038, section 6.2), and the
 * shape of the name it writes (plan 0079, section 4).
 *
 * Plan 0038 section 11 copied the Spanish string into `en` when Mercadona had
 * no English one. Plan 0079 reverses that: a copy is indistinguishable from a
 * translation in the row, so nothing could list the products still waiting for
 * one. The item is created with the languages it has and no others.
 */
const ENTRY: SourceCatalogEntry = {
  id: 'entry-1',
  supermarketId: 'chain-1',
  externalId: '4241',
  name: 'Leche entera',
  brand: 'Hacendado',
  ean: null,
  unitSize: 1,
  sizeFormat: 'L',
  price: null,
  unitPrice: null,
  unitPriceLabel: null,
  categoryPath: [],
  url: null,
  lastSeenAt: new Date('2026-01-01T00:00:00Z'),
} as unknown as SourceCatalogEntry;

const CREATED: ItemView = {
  id: 'item-1',
  name: { es: 'Leche entera' },
  brand: 'Hacendado',
  imageUrl: null,
  sku: null,
  ean: null,
  unitSize: 1,
  category: ItemCategory.OTHER,
  defaultUnit: UnitOfMeasure.LITER,
  productGroupId: null,
};

function build(englishName: string | null) {
  const createItem = jest.fn(async () => CREATED);
  const refs = {
    create: jest.fn((value: unknown) => value),
    save: jest.fn(async (value: unknown) => value),
  };
  const service = new SourceEntryService(
    { findOne: jest.fn(async () => ENTRY) } as never,
    refs as never,
    { createItem, findItemByEan: jest.fn() } as never,
    { findBySupermarket: jest.fn(async () => null) } as never,
    { requireAdmin: jest.fn(async () => ({ actorId: 'owner' })) } as never,
    {
      getOrThrow: () => ({ mercadonaEnabled: false }),
    } as never
  );
  // The fetch itself is one HTTP request to Mercadona and is not what this
  // file is about. What is asserted is what the service does with its answer.
  jest
    .spyOn(
      service as unknown as { fetchEnglishName: () => Promise<string | null> },
      'fetchEnglishName'
    )
    .mockResolvedValue(englishName);
  return { service, createItem, refs };
}

describe('SourceEntryService.createItem', () => {
  it('leaves `en` out when Mercadona has no English name, rather than copying the Spanish one', async () => {
    const { service, createItem } = build(null);

    await service.createItem({ userId: 'owner', entryId: ENTRY.id });

    const request = createItem.mock.calls[0][0] as { name: unknown };
    expect(request.name).toEqual({ es: 'Leche entera' });
    expect(Object.keys(request.name as object)).toEqual(['es']);
  });

  it('writes both languages when Mercadona answers an English name', async () => {
    const { service, createItem } = build('Whole milk');

    await service.createItem({ userId: 'owner', entryId: ENTRY.id });

    const request = createItem.mock.calls[0][0] as { name: unknown };
    expect(request.name).toEqual({ es: 'Leche entera', en: 'Whole milk' });
  });

  it('links the created item as an ACTIVE manual match', async () => {
    const { service, refs } = build(null);

    await service.createItem({ userId: 'owner', entryId: ENTRY.id });

    expect(refs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: CREATED.id,
        externalId: ENTRY.externalId,
        matchedBy: ItemSourceMatch.MANUAL,
        status: ItemSourceRefStatus.ACTIVE,
      })
    );
  });
});
