import {
  GeneratedLineOrigin,
  GeneratedListStatus,
  MembershipStatus,
  ZoneRole,
  ZoneStatus,
  type LineView,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CoreAuditService } from '../audit/core-audit.service';
import {
  CORE_ENTITIES,
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOption,
  LineSettlement,
  ListAccess,
  ListLine,
  ListLineGroupRemoval,
  ListLineItem,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { LineService } from '../lists/line.service';
import { ListAccessService } from '../lists/list-access.service';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { GeneratedListLineService } from './generated-list-line.service';
import { fakeLineClaims } from './line-claims.fake';

/**
 * A line sent to a list keeps its products, against real Postgres (plan 0065).
 *
 * The unit spec beside this one owns the rule: which products a promotion
 * carries, and in which order. What it cannot own is everything between that
 * decision and the row a household eventually reads, because it fakes
 * `LineService.add` and therefore agrees with the set being dropped one layer
 * further down.
 *
 * So this seeds a basket line the way the composer does for a **group**
 * suggestion, which is the ordinary gesture and the one that used to arrive as
 * free text: options attached, pick deliberately null. It promotes through the
 * real service against the real add path, then reads the target list's line back
 * through the ordinary read and asserts the products are on it.
 *
 * `promote` is called directly rather than through `addLine` or the bind
 * service. Both callers reach exactly this function and neither may grow a copy
 * of the rule, so the two of them are the unit spec's business; what is worth a
 * database here is the one path they share.
 */
describeIntegration('a promotion keeps its products (real Postgres)', () => {
  let dataSource: DataSource;
  let lineWrites: GeneratedListLineService;
  let zoneLines: LineService;

  const MILK_A = randomUUID();
  const MILK_B = randomUUID();
  const MILK_C = randomUUID();

  const ids = {
    zone: '',
    list: '',
    basket: '',
    shopper: randomUUID(),
  };

  /**
   * A basket line as the composer writes one, with its options in the order they
   * were attached and its pick stated separately.
   */
  async function seedBasketLine(options: {
    itemId?: string | null;
    optionItemIds?: string[];
  }): Promise<GeneratedListLine> {
    const line = await dataSource.getRepository(GeneratedListLine).save(
      dataSource.getRepository(GeneratedListLine).create({
        generatedListId: ids.basket,
        content: 'Milk',
        quantity: 2,
        settledQuantity: 0,
        itemId: options.itemId ?? null,
        origin: GeneratedLineOrigin.ADDED,
        targetListId: null,
        position: 1,
      })
    );
    for (const [position, itemId] of (options.optionItemIds ?? []).entries()) {
      await dataSource.getRepository(GeneratedListLineOption).save(
        dataSource.getRepository(GeneratedListLineOption).create({
          generatedListLineId: line.id,
          itemId,
          position,
        })
      );
    }
    return line;
  }

  /** The created line as the target list answers it, and not as it was written. */
  async function lineOnList(lineId: string): Promise<LineView> {
    const page = await zoneLines.list({
      userId: ids.shopper,
      listId: ids.list,
    });
    const view = page.items.find((row) => row.id === lineId);
    if (!view) {
      throw new Error('the promoted line is not on the list it was sent to');
    }
    return view;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();

    const memberships = dataSource.getRepository(ZoneMembership);
    const authz = new ZoneAuthzService(memberships);
    const listAccess = new ListAccessService(
      dataSource.getRepository(ShoppingList),
      dataSource.getRepository(ListAccess),
      dataSource.getRepository(ListLine),
      authz
    );
    const claims = fakeLineClaims();
    zoneLines = new LineService(
      dataSource,
      dataSource.getRepository(ListLine),
      dataSource.getRepository(ListLineItem),
      dataSource.getRepository(ListLineGroupRemoval),
      dataSource.getRepository(LineSettlement),
      listAccess,
      claims.service,
      { emitToUsers: jest.fn(), emit: jest.fn() } as never,
      new CoreAuditService(dataSource)
    );
    lineWrites = new GeneratedListLineService(
      dataSource.getRepository(GeneratedListLine),
      dataSource.getRepository(GeneratedListLineOption),
      // Not reached by `promote`, which loads no basket and announces nothing:
      // the gesture it serves has already been authorized by its caller.
      undefined as never,
      listAccess,
      zoneLines,
      claims.service,
      undefined as never,
      { emitToUsers: jest.fn(), emit: jest.fn() } as never
    );

    const zone = await dataSource.getRepository(Zone).save(
      dataSource.getRepository(Zone).create({
        name: 'Flat',
        joinCode: `P65${Date.now()}`.slice(0, 16),
        status: ZoneStatus.ACTIVE,
        ownerUserId: ids.shopper,
        config: {},
      })
    );
    ids.zone = zone.id;
    await dataSource.getRepository(ZoneMembership).save(
      dataSource.getRepository(ZoneMembership).create({
        zoneId: zone.id,
        userId: ids.shopper,
        username: 'Shopper',
        role: ZoneRole.OWNER,
        status: MembershipStatus.APPROVED,
      })
    );
    const list = await dataSource.getRepository(ShoppingList).save(
      dataSource.getRepository(ShoppingList).create({
        zoneId: zone.id,
        name: 'Weekly shop',
        createdByUserId: ids.shopper,
      })
    );
    ids.list = list.id;

    const basket = await dataSource.getRepository(GeneratedList).save(
      dataSource.getRepository(GeneratedList).create({
        ownerUserId: ids.shopper,
        name: 'Saturday',
        status: GeneratedListStatus.ACTIVE,
        generatedAt: new Date(),
        sourceSnapshot: {
          profileId: null,
          pricingProfileId: null,
          sources: [],
        },
        defaultTargetListId: null,
        idempotencyKey: null,
      })
    );
    ids.basket = basket.id;
  });

  afterAll(async () => {
    if (ids.basket) {
      // The lines and their options cascade from the basket.
      await dataSource.getRepository(GeneratedList).delete({ id: ids.basket });
    }
    if (ids.zone) {
      await dataSource.getRepository(Zone).delete({ id: ids.zone });
    }
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.getRepository(ListLine).delete({ listId: ids.list });
  });

  it('puts every product of a group line on the list line it creates', async () => {
    const line = await seedBasketLine({
      itemId: null,
      optionItemIds: [MILK_A, MILK_B, MILK_C],
    });

    const promoted = await lineWrites.promote(ids.shopper, line, ids.list);

    // Read back through the ordinary line read rather than the row this call
    // returned, because what a household sees is the read and not the write.
    const view = await lineOnList(promoted.line.id);
    // The sentence this plan exists to stop: an empty set is what the client
    // draws as `Not linked to a product`.
    expect(view.itemIds).toEqual([MILK_A, MILK_B, MILK_C]);
  });

  it('leads the stored set with the pick', async () => {
    const line = await seedBasketLine({
      itemId: MILK_B,
      optionItemIds: [MILK_A, MILK_B, MILK_C],
    });

    const promoted = await lineWrites.promote(ids.shopper, line, ids.list);

    const view = await lineOnList(promoted.line.id);
    // Position is stored rather than derived, so this is the order a later run
    // reads and `resolvePick` takes its default from.
    expect(view.itemIds).toEqual([MILK_B, MILK_A, MILK_C]);
  });
});
