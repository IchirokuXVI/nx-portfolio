import type {
  ShopMapDocument,
  ShopMapSectionView,
} from '@portfolio/luna-shopper/contracts';
import { shopperView } from '@portfolio/luna-shopper/shop-map/model';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import type { SectionService } from '../catalog/section.service';
import { ShopWalk, ShopWalkEntry } from '../entities';
import { ShopWalkService } from './shop-walk.service';

/**
 * The public read's retry cap, with the database replaced by a fake that
 * answers every read the read makes. The integration spec proves the normal
 * path over real Postgres; this one proves the path a real database only
 * reaches under continuous appends.
 */
const FIXTURES = join(
  __dirname,
  '../../../../../../libs/luna-shopper/shop-map/model/src/lib/__fixtures__/el-jamon'
);
const document = JSON.parse(
  readFileSync(join(FIXTURES, 'expected-map.json'), 'utf8')
) as ShopMapDocument;

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const WALK_ID = '22222222-2222-4222-8222-222222222222';
const CREATED_AT = new Date('2026-09-29T10:00:00.000Z');
const SAVED_AT = new Date('2026-09-29T12:42:00.000Z');

describe('ShopWalkService.mapForLocation', () => {
  it('serves the current document once every seq filtered read has missed', async () => {
    const filteredReads: unknown[] = [];
    const unfilteredReads: unknown[] = [];
    const entryReads: unknown[] = [];
    let shownSeq = 5;
    const repositories = new Map<unknown, unknown>([
      [
        ShopWalk,
        {
          findOne: async (options: { where: Record<string, unknown> }) => {
            if ('lastSeq' in options.where) {
              // Every filtered read loses the race to an append.
              filteredReads.push(options.where);
              shownSeq += 1;
              return null;
            }
            unfilteredReads.push(options.where);
            return {
              id: WALK_ID,
              document,
              lastSeq: shownSeq,
              createdAt: CREATED_AT,
              updatedAt: SAVED_AT,
            };
          },
        },
      ],
      [
        ShopWalkEntry,
        {
          findOne: async (options: { where: unknown }) => {
            entryReads.push(options.where);
            return { createdAt: SAVED_AT };
          },
        },
      ],
    ]);
    const dataSource = {
      manager: { query: async () => [{ '?column?': 1 }] },
      query: async () => [
        {
          id: WALK_ID,
          lastSeq: shownSeq,
          createdAt: CREATED_AT,
          updatedAt: SAVED_AT,
        },
      ],
      getRepository: (entity: unknown) => {
        const repository = repositories.get(entity);
        if (!repository) {
          throw new Error(`unexpected repository ${String(entity)}`);
        }
        return repository;
      },
    } as unknown as DataSource;
    const resolved: string[][] = [];
    const sections = {
      resolveWalkNames: async (
        _shopId: string,
        names: readonly string[]
      ): Promise<ShopMapSectionView[]> => {
        resolved.push([...names]);
        return [];
      },
    } as unknown as SectionService;
    const service = new ShopWalkService(dataSource, sections);

    const { map } = await service.mapForLocation({
      supermarketLocationId: SHOP_ID,
    });

    expect(filteredReads).toHaveLength(2);
    expect(unfilteredReads).toEqual([
      { id: WALK_ID, shown: true, deletedAt: expect.anything() },
    ]);
    expect(map).toEqual({
      walkId: WALK_ID,
      savedAt: SAVED_AT.toISOString(),
      view: shopperView(document),
      sections: [],
    });
    // The savedAt of the fold it served, not of a seq it never read.
    expect(entryReads).toEqual([{ walkId: WALK_ID, seq: 7 }]);
    expect(resolved).toHaveLength(1);
  });
});
