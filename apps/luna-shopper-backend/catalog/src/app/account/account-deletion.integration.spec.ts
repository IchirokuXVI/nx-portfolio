import { JwtService } from '@nestjs/jwt';
import type { ShopWalkEntryView } from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { CatalogAuditService } from '../catalog/catalog-audit.service';
import { PlatformAdminService } from '../catalog/platform-admin.service';
import { SectionService } from '../catalog/section.service';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import {
  CATALOG_ENTITIES,
  ShopSection,
  Supermarket,
  SupermarketLocation,
} from '../entities';
import { ShopWalkService } from '../shop-walks/shop-walk.service';
import { AccountDeletionService } from './account-deletion.service';
import { CATALOG_USER_IDS_SQL } from './reconcile-deletions';

/**
 * A deleted account in catalog, against real Postgres (plan 0232, sections 6
 * and 8).
 *
 * A person records a walk of a shop with the El Jamón fixture log and shows it,
 * and somebody else records a walk of their own. The deletion rewrites the
 * person's walk and every entry of its log to one tombstone, leaves the other
 * walk alone, and the map still reads through the shopper's read and the
 * walk's own. A second delivery finds nothing to rewrite.
 *
 * It works in a scratch schema of its own, and drops it afterwards.
 *
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=account-deletion.integration.spec.ts
 */
const SCHEMA = 'plan0232_account_deletion_test';
const OWNER = 'ac700000-0000-4000-a000-000000000232';

const FIXTURES = join(
  __dirname,
  '../../../../../../libs/luna-shopper/shop-map/model/src/lib/__fixtures__/el-jamon'
);
const elJamon = (
  JSON.parse(readFileSync(join(FIXTURES, 'walk-log.json'), 'utf8')) as {
    entries: ShopWalkEntryView[];
  }
).entries.map(({ seq: _seq, ...entry }) => entry);

describeIntegration('an account deletion in catalog (real Postgres)', () => {
  let dataSource: DataSource;
  let walks: ShopWalkService;
  let deletion: AccountDeletionService;
  let shopId: string;

  beforeAll(async () => {
    const url = requiredEnv('CATALOG_DB_URL');
    const bootstrap = new DataSource({ type: 'postgres', url });
    await bootstrap.initialize();
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await bootstrap.query(`CREATE SCHEMA "${SCHEMA}"`);
    await bootstrap.destroy();

    dataSource = new DataSource({
      type: 'postgres',
      url,
      schema: SCHEMA,
      entities: CATALOG_ENTITIES,
      migrations: CATALOG_MIGRATIONS,
      synchronize: false,
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    const admin = new PlatformAdminService(new JwtService(), {
      getOrThrow: () => ({ adminJwtPublicKey: '', serviceActorIds: [OWNER] }),
    } as never);
    const sections = new SectionService(
      dataSource.getRepository(ShopSection),
      admin,
      new CatalogAuditService(dataSource)
    );
    walks = new ShopWalkService(dataSource, sections);
    deletion = new AccountDeletionService(dataSource);

    const chains = dataSource.getRepository(Supermarket);
    const chainId = (
      await chains.save(
        chains.create({
          name: { en: 'El Jamón', es: 'El Jamón' },
          externalBrandKey: null,
        })
      )
    ).id;
    const shops = dataSource.getRepository(SupermarketLocation);
    shopId = (
      await shops.save(
        shops.create({
          supermarketId: chainId,
          label: { en: 'ronda', es: 'ronda' },
          address: 'Calle ronda',
          city: 'Córdoba',
          country: 'es',
          latitude: null,
          longitude: null,
          postalCode: null,
          postalCodeSource: null,
          externalRef: null,
          externalProvider: null,
        })
      )
    ).id;
  });

  afterAll(async () => {
    await dataSource?.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await dataSource?.destroy();
  });

  it('rewrites the walk and its entries to one tombstone, and the map still reads', async () => {
    const person = randomUUID();
    const mapper = randomUUID();

    const walk = await walks.create({
      userId: person,
      supermarketLocationId: shopId,
      name: 'Ronda',
    });
    let seq = 0;
    for (const entry of elJamon) {
      await walks.append({
        userId: person,
        walkId: walk.id,
        baseSeq: seq,
        ...entry,
      });
      seq += 1;
    }
    await walks.update({ userId: person, walkId: walk.id, shown: true });
    const other = await walks.create({
      userId: mapper,
      supermarketLocationId: shopId,
      name: 'Somebody else',
    });
    const mapBefore = await walks.mapForLocation({
      supermarketLocationId: shopId,
    });
    const walkBefore = await walks.get({ userId: person, walkId: walk.id });
    expect(mapBefore.map).not.toBeNull();

    await expect(deletion.handleUserDeleted(person)).resolves.toBe(
      1 + elJamon.length
    );

    const owners = (await dataSource.query(
      `SELECT DISTINCT "createdByUserId"::text AS "id" FROM (
         SELECT "createdByUserId" FROM "shop_walks" WHERE "id" = $1
         UNION ALL
         SELECT "createdByUserId" FROM "shop_walk_entries" WHERE "walkId" = $1
       ) t`,
      [walk.id]
    )) as { id: string }[];
    expect(owners).toHaveLength(1);
    expect(owners[0].id).not.toBe(person);
    await expect(
      dataSource.query(
        `SELECT "createdByUserId"::text AS "id" FROM "shop_walks" WHERE "id" = $1`,
        [other.id]
      )
    ).resolves.toEqual([{ id: mapper }]);
    const ids = (
      (await dataSource.query(CATALOG_USER_IDS_SQL)) as { id: string }[]
    ).map((row) => row.id);
    expect(ids).not.toContain(person);

    // The map is the same map, through both reads.
    await expect(
      walks.mapForLocation({ supermarketLocationId: shopId })
    ).resolves.toEqual(mapBefore);
    const walkAfter = await walks.get({ userId: mapper, walkId: walk.id });
    expect(walkAfter.document).toEqual(walkBefore.document);
    expect(walkAfter.timeline).toEqual(walkBefore.timeline);

    // A second delivery finds nothing that still names the person.
    await expect(deletion.handleUserDeleted(person)).resolves.toBe(0);
  });
});
