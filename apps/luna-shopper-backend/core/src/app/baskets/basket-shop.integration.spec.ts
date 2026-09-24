import { BasketStatus } from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Basket, BasketSource, CORE_ENTITIES } from '../entities';
import { BasketTripRowsService } from './basket-trip-rows.service';
import { BasketService } from './basket.service';
import { fakeLineClaims } from './line-claims.fake';

/**
 * The shop a basket is started at, against Postgres (plan 0163, section 1).
 *
 * A basket created with a shop reads it back, and no path that exists changes
 * it: the rename, the finish and the move back to open all go through the one
 * update the owner has, and the column is still what the run wrote.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 4 --services core
 *   LUNA_INTEGRATION=1 CORE_DB_URL=postgres://luna_core:luna_core@localhost:43311/luna_core \
 *     npx nx run luna-shopper-backend-core:test-integration --testFile=basket-shop.integration.spec.ts
 */
describeIntegration('the shop a basket is started at (real Postgres)', () => {
  let dataSource: DataSource;
  let baskets: BasketService;
  const owner = randomUUID();
  const SHOP = randomUUID();
  const OTHER_SHOP = randomUUID();
  const made: string[] = [];

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();

    baskets = new BasketService(
      dataSource,
      dataSource.getRepository(Basket),
      // The run reads the owner's default profile. This owner draws from no
      // zone, which is an ordinary empty basket and all this file needs.
      {
        resolveGenerationSources: async () => ({
          profileId: randomUUID(),
          sources: [],
        }),
        pricingProfileId: async () => randomUUID(),
      } as never,
      fakeLineClaims({}).service,
      { emitTo: jest.fn(), emitToUsers: jest.fn() } as never,
      { liveRegistered: async () => [] } as never,
      dataSource.getRepository(BasketSource),
      new BasketTripRowsService(),
      // The history counts alone read through this, and nothing here lists.
      undefined as never
    );
  });

  afterAll(async () => {
    if (made.length > 0) {
      await dataSource.getRepository(Basket).delete(made);
    }
    await dataSource?.destroy();
  });

  async function stored(basketId: string): Promise<string | null> {
    const row = await dataSource
      .getRepository(Basket)
      .findOneByOrFail({ id: basketId });
    return row.supermarketLocationId;
  }

  it('stores the shop the run was asked for, and reads it back', async () => {
    const { basket } = await baskets.create({
      userId: owner,
      supermarketLocationId: SHOP,
    });
    made.push(basket.id);

    expect(basket.supermarketLocationId).toBe(SHOP);
    expect(await stored(basket.id)).toBe(SHOP);
    expect(
      (await baskets.get({ userId: owner, basketId: basket.id }))
        .supermarketLocationId
    ).toBe(SHOP);
  });

  it('stores none when the run named none', async () => {
    const { basket } = await baskets.create({ userId: owner });
    made.push(basket.id);

    expect(await stored(basket.id)).toBeNull();
  });

  it('keeps the shop through every update the owner can make', async () => {
    const { basket } = await baskets.create({
      userId: owner,
      supermarketLocationId: SHOP,
    });
    made.push(basket.id);

    for (const change of [
      { name: 'Saturday' },
      { status: BasketStatus.FINISHED },
      { status: BasketStatus.OPEN },
      { status: BasketStatus.ARCHIVED },
    ]) {
      const view = await baskets.update({
        userId: owner,
        basketId: basket.id,
        ...change,
        // A caller that tries anyway. The request has no such field and the
        // service reads none, so it lands nowhere.
        ...({ supermarketLocationId: OTHER_SHOP } as object),
      });
      expect(view.supermarketLocationId).toBe(SHOP);
      expect(await stored(basket.id)).toBe(SHOP);
    }
  });
});
