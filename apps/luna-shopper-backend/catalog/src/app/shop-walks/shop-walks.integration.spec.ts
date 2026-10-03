import { JwtService } from '@nestjs/jwt';
import type {
  ShopMapDocument,
  ShopWalkEntryView,
} from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  NotFoundException,
  ShopMapInvalidException,
  ValidationException,
  WalkChangedException,
} from '@portfolio/luna-shopper/platform';
import {
  shopperView,
  walkOrderV2,
} from '@portfolio/luna-shopper/shop-map/model';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { CatalogAuditService } from '../catalog/catalog-audit.service';
import { PlatformAdminService } from '../catalog/platform-admin.service';
import { SectionService } from '../catalog/section.service';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import { ShopWalks1758400000000 } from '../db/migrations/1758400000000-ShopWalks';
import {
  CATALOG_ENTITIES,
  Supermarket,
  SupermarketLocation,
  SupermarketSection,
} from '../entities';
import { shopsWithMap } from './has-map';
import { ShopWalkService } from './shop-walk.service';

/**
 * A shop's walks through the service, against real Postgres (backend plan
 * 0168).
 *
 * It appends the El Jamón fixture log of shop-map plan 0002 entry by entry and
 * reads back the document the library folds the whole log to; a retried entry
 * answers the first result; a stale base is refused; the fixture's second
 * rewind goes past its first; the shop's section list is in walk order once
 * the walk is shown; and the public read answers without an account. It ends
 * with the migration down and up again.
 *
 * It works in a scratch schema of its own, and drops it afterwards.
 *
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=shop-walks.integration.spec.ts
 */
const SCHEMA = 'plan0168_shop_walks_test';
const OWNER = 'ac700000-0000-4000-a000-000000000168';
const MAPPER = 'ac700000-0000-4000-a000-0000000000aa';

const FIXTURES = join(
  __dirname,
  '../../../../../../libs/luna-shopper/shop-map/model/src/lib/__fixtures__/el-jamon'
);
const read = <T>(file: string): T =>
  JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as T;
// The fixture states each entry's seq; the server assigns it, so it is dropped.
const elJamon = read<{ entries: ShopWalkEntryView[] }>(
  'walk-log.json'
).entries.map(({ seq: _seq, ...entry }) => entry);
const expectedMap = read<ShopMapDocument>('expected-map.json');

describeIntegration('shop walks (real Postgres)', () => {
  let dataSource: DataSource;
  let sections: SectionService;
  let walks: ShopWalkService;

  let chainId: string;
  let shopId: string;
  let otherShopId: string;
  /** The chain's own sections before any walk: one per spelling to match. */
  let lacteos: string;
  let charcuteria: string;

  /** What a promise was rejected with. */
  async function refusal(promise: Promise<unknown>): Promise<unknown> {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    throw new Error('expected a refusal');
  }

  async function shop(supermarketId: string, key: string): Promise<string> {
    const repo = dataSource.getRepository(SupermarketLocation);
    return (
      await repo.save(
        repo.create({
          supermarketId,
          label: { en: key, es: key },
          address: `Calle ${key}`,
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
  }

  const append = (
    walkId: string,
    baseSeq: number,
    entry: Omit<ShopWalkEntryView, 'seq'>
  ) => walks.append({ userId: MAPPER, walkId, baseSeq, ...entry });

  /** The shop's own section list, by name, in its order. */
  async function listOf(locationId: string): Promise<string[]> {
    const rows = (await dataSource.query(
      `SELECT s."name" AS "name"
         FROM "location_sections" ls
         JOIN "supermarket_sections" s ON s."id" = ls."sectionId"
        WHERE ls."supermarketLocationId" = $1
        ORDER BY ls."position"`,
      [locationId]
    )) as { name: Record<string, string> }[];
    return rows.map((row) => row.name['es'] ?? row.name['en']);
  }

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
    sections = new SectionService(
      dataSource.getRepository(SupermarketSection),
      admin,
      new CatalogAuditService(dataSource)
    );
    walks = new ShopWalkService(dataSource, sections);

    const chains = dataSource.getRepository(Supermarket);
    chainId = (
      await chains.save(
        chains.create({
          name: { en: 'El Jamón', es: 'El Jamón' },
          externalBrandKey: null,
        })
      )
    ).id;
    shopId = await shop(chainId, 'ronda');
    otherShopId = await shop(chainId, 'centro');
    // Matched in another locale, and matched after case folding.
    lacteos = (
      await sections.create({
        userId: OWNER,
        supermarketId: chainId,
        slug: 'lacteos',
        name: { en: 'Lácteos', es: 'Leche y derivados' },
        categoryIds: [],
      })
    ).id;
    charcuteria = (
      await sections.create({
        userId: OWNER,
        supermarketId: chainId,
        slug: 'charcuteria',
        name: { es: 'charcutería' },
        categoryIds: [],
      })
    ).id;
  });

  afterAll(async () => {
    await dataSource?.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await dataSource?.destroy();
  });

  let walkId: string;

  it('creates an empty walk, not shown, and the shop has no map', async () => {
    const created = await walks.create({
      userId: MAPPER,
      supermarketLocationId: shopId,
      name: '  El Jamón 2 ',
    });
    walkId = created.id;
    expect(created).toMatchObject({
      name: 'El Jamón 2',
      shown: false,
      lastSeq: 0,
      entryCount: 0,
      markCount: 0,
    });
    await expect(
      walks.mapForLocation({ supermarketLocationId: shopId })
    ).resolves.toEqual({ map: null });
    expect(await shopsWithMap(dataSource, [shopId])).toEqual(new Set());
  });

  it('appends the El Jamón log entry by entry and stores the document the library folds', async () => {
    let seq = 0;
    for (const entry of elJamon) {
      const result = await append(walkId, seq, entry);
      seq += 1;
      expect(result.replayed).toBe(false);
      expect(result.entry).toMatchObject({ id: entry.id, seq });
      expect(result.walk.lastSeq).toBe(seq);
    }
    const walk = await walks.get({ userId: MAPPER, walkId });
    expect(walk.document).toEqual(expectedMap);
    expect(walk.walk.markCount).toBe(expectedMap.marks.length);
    expect(walk.timeline.map((row) => row.id)).toEqual(
      elJamon.map((entry) => entry.id)
    );
    expect(walk.timeline.every((row) => !('events' in row))).toBe(true);

    // Both rewinds stored their fold, and the second went past the first.
    const snapshots = (await dataSource.query(
      `SELECT "seq", "kind" FROM "shop_walk_entries"
        WHERE "walkId" = $1 AND "snapshot" IS NOT NULL ORDER BY "seq"`,
      [walkId]
    )) as { seq: number; kind: string }[];
    expect(snapshots.map((row) => row.kind)).toEqual(['rewound', 'rewound']);
  });

  it('answers a retried entry with the first result and writes nothing', async () => {
    const last = elJamon[elJamon.length - 1];
    const before = await walks.get({ userId: MAPPER, walkId });
    const retried = await append(walkId, 0, last);
    expect(retried.replayed).toBe(true);
    expect(retried.entry).toEqual(before.timeline[before.timeline.length - 1]);
    expect(retried.walk.lastSeq).toBe(elJamon.length);
  });

  it('names the replayed entry’s own seq as the next base, which another phone’s save makes stale', async () => {
    // Phone A saves seq 1 and loses the answer; phone B saves seq 2 on top.
    const walk = await walks.create({
      userId: MAPPER,
      supermarketLocationId: otherShopId,
      name: 'Two phones',
    });
    const saveA: Omit<ShopWalkEntryView, 'seq'> = {
      id: 'cc000000-0000-4000-8000-000000000001',
      kind: 'started',
      at: '2026-09-30T10:00:00.000Z',
      logFrom: 0,
      logTo: 1000,
      events: [
        {
          type: 'path',
          points: [
            [0, 0, 0],
            [1000, 1, 0],
          ],
        },
      ],
    };
    const first = await append(walk.id, 0, saveA);
    await append(walk.id, first.entry.seq, {
      id: 'cc000000-0000-4000-8000-000000000002',
      kind: 'continued',
      at: '2026-09-30T10:00:20.000Z',
      logFrom: 1000,
      logTo: 2000,
      events: [{ type: 'path', points: [[2000, 5, 5]] }],
    });

    // A retries and is told what it stored: its own seq, while the walk has
    // moved on to B's entry.
    const replay = await append(walk.id, 0, saveA);
    expect(replay.replayed).toBe(true);
    expect(replay.entry.seq).toBe(1);
    expect(replay.walk.lastSeq).toBe(2);

    // Building on its own seq, as the contract says, A is refused and reloads
    // rather than extending B's path.
    const error = await refusal(
      append(walk.id, replay.entry.seq, {
        id: 'cc000000-0000-4000-8000-000000000003',
        kind: 'continued',
        at: '2026-09-30T10:00:40.000Z',
        logFrom: 1000,
        logTo: 3000,
        events: [{ type: 'path', points: [[3000, 1, 1]] }],
      })
    );
    expect(error).toBeInstanceOf(WalkChangedException);
    expect((error as WalkChangedException).details).toEqual({ lastSeq: 2 });
  });

  it('refuses a stale base with walk_changed and the current lastSeq', async () => {
    const error = await refusal(
      append(walkId, elJamon.length - 1, {
        id: 'bb000000-0000-4000-8000-000000000001',
        kind: 'edited',
        at: '2026-09-30T10:00:00.000Z',
        logFrom: 2000000,
        logTo: 2000000,
        events: [],
      })
    );
    expect(error).toBeInstanceOf(WalkChangedException);
    expect((error as WalkChangedException).details).toEqual({
      lastSeq: elJamon.length,
    });
  });

  it('refuses an entry id stored on another walk', async () => {
    const other = await walks.create({
      userId: MAPPER,
      supermarketLocationId: otherShopId,
      name: 'Centro',
    });
    const error = await refusal(append(other.id, 0, elJamon[0]));
    expect(error).toBeInstanceOf(ConflictException);
  });

  it('refuses a reason on an entry that is not a stop', async () => {
    const error = await refusal(
      append(walkId, elJamon.length, {
        id: 'bb000000-0000-4000-8000-000000000004',
        kind: 'edited',
        at: '2026-09-30T10:00:00.000Z',
        logFrom: 2000000,
        logTo: 2000000,
        events: [],
        reason: 'button',
      })
    );
    expect(error).toBeInstanceOf(ValidationException);
  });

  it('refuses an entry whose fold does not validate, with the problems', async () => {
    const error = await refusal(
      append(walkId, elJamon.length, {
        id: 'bb000000-0000-4000-8000-000000000002',
        kind: 'edited',
        at: '2026-09-30T10:00:00.000Z',
        logFrom: 2000000,
        logTo: 2000000,
        events: [
          {
            type: 'area-put',
            area: {
              id: 'tiny',
              kind: 'shelf',
              x: 0,
              y: 0,
              w: 0.1,
              h: 1,
              colour: { mode: 'default' },
              origin: 'drawn',
            },
          },
        ],
      })
    );
    expect(error).toBeInstanceOf(ShopMapInvalidException);
    expect((error as ShopMapInvalidException).details).toEqual({
      problems: [{ code: 'AREA_TOO_SMALL', id: 'tiny' }],
    });
    const walk = await walks.get({ userId: MAPPER, walkId });
    expect(walk.walk.lastSeq).toBe(elJamon.length);
  });

  it('reads the log from the snapshot at or before fromSeq', async () => {
    const whole = await walks.log({ userId: MAPPER, walkId });
    expect(whole.snapshot).toBeNull();
    expect(whole.entries.map((e) => e.seq)).toEqual(
      elJamon.map((_, i) => i + 1)
    );
    const firstRewind =
      elJamon.findIndex((entry) => entry.kind === 'rewound') + 1;
    const fromRewind = await walks.log({
      userId: MAPPER,
      walkId,
      fromSeq: firstRewind,
    });
    expect(fromRewind.snapshot?.seq).toBe(firstRewind);
    expect(fromRewind.entries[0].seq).toBe(firstRewind + 1);
  });

  it('writes the shop’s section list in walk order once the walk is shown', async () => {
    const shown = await walks.update({ userId: MAPPER, walkId, shown: true });
    expect(shown.shown).toBe(true);

    const names = walkOrderV2(expectedMap).sections.map((stop) => stop.name);
    // Lácteos matched the section named so in English, Charcutería the one
    // spelled in lower case; every other name created a section of the chain.
    const expected = names.map((name) =>
      name === 'Lácteos'
        ? 'Leche y derivados'
        : name === 'Charcutería'
          ? 'charcutería'
          : name
    );
    expect(await listOf(shopId)).toEqual(expected);

    const created = (await dataSource.query(
      `SELECT "slug", "name" FROM "supermarket_sections"
        WHERE "supermarketId" = $1 AND "id" <> ALL($2::uuid[])
        ORDER BY "position"`,
      [chainId, [lacteos, charcuteria]]
    )) as { slug: string; name: Record<string, string> }[];
    expect(created.length).toBe(names.length - 2);
    // No request context, so the default locale names them.
    expect(created.find((row) => row.slug === 'pescaderia')?.name).toEqual({
      en: 'Pescadería',
    });
    expect(await shopsWithMap(dataSource, [shopId, otherShopId])).toEqual(
      new Set([shopId.toLowerCase()])
    );
  });

  it('serves the shown walk to anybody through shopperView', async () => {
    const { map } = await walks.mapForLocation({
      supermarketLocationId: shopId,
    });
    expect(map).not.toBeNull();
    expect(map?.walkId).toBe(walkId);
    expect(map?.view).toEqual(shopperView(expectedMap));
    expect(map?.sections.map((s) => s.name)).toEqual(
      walkOrderV2(expectedMap).sections.map((stop) => stop.name)
    );
    expect(map?.sections.find((s) => s.name === 'Lácteos')?.sectionId).toBe(
      lacteos
    );
  });

  it('resolves the section ids on every read, past the cached walk order', async () => {
    const before = await walks.mapForLocation({
      supermarketLocationId: shopId,
    });
    const fish = before.map?.sections.find((s) => s.name === 'Pescadería');
    expect(fish).toBeDefined();
    // Delete the chain section: the cached names still hold the walk's name,
    // and the next read leaves it out because nothing resolves it.
    await sections.delete({ userId: OWNER, sectionId: fish?.sectionId ?? '' });
    const after = await walks.mapForLocation({ supermarketLocationId: shopId });
    expect(after.map?.view).toBe(before.map?.view);
    expect(after.map?.sections.map((s) => s.name)).toEqual(
      before.map?.sections
        .map((s) => s.name)
        .filter((name) => name !== 'Pescadería')
    );
  });

  it('keeps the list in walk order on the next save of the shown walk', async () => {
    // Nothing new in the walk, and the list is rewritten the same, even after
    // a hand edit of the list.
    await sections.setForLocation({
      userId: OWNER,
      supermarketLocationId: shopId,
      sectionIds: [lacteos],
    });
    await append(walkId, elJamon.length, {
      id: 'bb000000-0000-4000-8000-000000000003',
      kind: 'confirmed',
      at: '2026-09-30T10:00:00.000Z',
      logFrom: 2000000,
      logTo: 2000000,
      events: [],
    });
    expect((await listOf(shopId))[0]).toBe(
      walkOrderV2(expectedMap).sections[0].name
    );
  });

  it('shows one walk per shop, and a deleted walk takes the map with it', async () => {
    const second = await walks.create({
      userId: MAPPER,
      supermarketLocationId: shopId,
      name: 'Second',
    });
    await walks.update({ userId: MAPPER, walkId: second.id, shown: true });
    const listed = await walks.list({
      userId: MAPPER,
      supermarketLocationId: shopId,
    });
    expect(listed.walks.map((w) => [w.id, w.shown])).toEqual([
      [second.id, true],
      [walkId, false],
    ]);

    await walks.delete({ userId: MAPPER, walkId: second.id });
    await expect(
      walks.mapForLocation({ supermarketLocationId: shopId })
    ).resolves.toEqual({ map: null });
    expect(
      await refusal(walks.get({ userId: MAPPER, walkId: second.id }))
    ).toBeInstanceOf(NotFoundException);
    // Deleting keeps the row and its entries.
    const [{ count }] = (await dataSource.query(
      `SELECT count(*)::int AS "count" FROM "shop_walks" WHERE "id" = $1`,
      [second.id]
    )) as { count: number }[];
    expect(count).toBe(1);
  });

  it('refuses a second shown walk at the database too', async () => {
    await walks.update({ userId: MAPPER, walkId, shown: true });
    const third = await walks.create({
      userId: MAPPER,
      supermarketLocationId: shopId,
      name: 'Third',
    });
    await expect(
      dataSource.query(
        `UPDATE "shop_walks" SET "shown" = true WHERE "id" = $1`,
        [third.id]
      )
    ).rejects.toMatchObject({
      driverError: { constraint: 'uq_shop_walks_shown' },
    });
  });

  it('migrates down and up again', async () => {
    // Back through the shop walks migration, which is no longer the last one.
    const later =
      CATALOG_MIGRATIONS.length -
      CATALOG_MIGRATIONS.indexOf(ShopWalks1758400000000);
    for (let undone = 0; undone < later; undone++) {
      await dataSource.undoLastMigration();
    }
    // Named with the schema: the slot's own catalog in `public` has them too.
    const [{ present }] = (await dataSource.query(
      `SELECT to_regclass('"${SCHEMA}"."shop_walks"') IS NOT NULL AS "present"`
    )) as { present: boolean }[];
    expect(present).toBe(false);
    await dataSource.runMigrations();
    const [{ back }] = (await dataSource.query(
      `SELECT to_regclass('"${SCHEMA}"."shop_walk_entries"') IS NOT NULL AS "back"`
    )) as { back: boolean }[];
    expect(back).toBe(true);
  });
});
