import {
  CommentTranscription,
  ListPermission,
  ZoneStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  CommentAudio,
  CORE_ENTITIES,
  LineComment,
  ListAccess,
  ListLine,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { LIST_SHARED_WITH_ZONE_BACKFILL_SQL } from './migrations/1756000300000-ListSharedWithZone';

/**
 * Real-Postgres integration test (plan 0010, section 1). Runs only with
 * LUNA_INTEGRATION=1 against the compose stack's core database, after
 * `nx run luna-shopper-backend-core:migration:run` has applied the committed migrations.
 * It proves the migrated schema matches the entities: the expected tables exist
 * and a Zone round-trips through the enum column and the jsonb `config` default,
 * which unit tests with a mocked repository cannot validate honestly.
 */
describeIntegration('core schema (real Postgres)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  it('has the core tables the migrations create', async () => {
    const rows = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const names = new Set(
      rows.map((r: { table_name: string }) => r.table_name)
    );
    for (const table of [
      'zones',
      'zone_memberships',
      'shopping_lists',
      'list_lines',
      'line_comments',
      'comment_audio',
      'merge_requests',
      // Plan 0048: a line holds a set of products.
      'list_line_items',
    ]) {
      expect(names.has(table)).toBe(true);
    }
  });

  it('retired the single line itemId for a set and a hash (plan 0048, section 1.1)', async () => {
    const columns = await dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'list_lines'`
    );
    const names = new Set(
      columns.map((c: { column_name: string }) => c.column_name)
    );
    expect(names.has('itemSetHash')).toBe(true);
    // Gone, not merely unused. It was null on every line ever created, so
    // nothing moved and nothing needs it.
    expect(names.has('itemId')).toBe(false);
  });

  it('computes the same digest in SQL that the service computes in TypeScript', async () => {
    // The migration backfills `itemSetHash` with `encode(sha256(...), 'hex')`
    // over the sorted distinct ids joined with commas. `item-set-hash.spec.ts`
    // pins the TypeScript half against the same two literals; this is the SQL
    // half of the same pin, and the only place the two can be caught disagreeing.
    const [{ hash }] = await dataSource.query(
      `SELECT encode(
         sha256(convert_to(string_agg(DISTINCT id, ',' ORDER BY id), 'UTF8')),
         'hex'
       ) AS "hash"
       FROM (VALUES
         ('22222222-2222-4222-8222-222222222222'),
         ('11111111-1111-4111-8111-111111111111')
       ) AS t(id)`
    );
    expect(hash).toBe(
      'f1263a03cdb2be40b54df53df70602a0e9fcc7f8df4e1715891bbf0e92d83f4f'
    );
  });

  it('round-trips a Zone through the enum column and jsonb config default', async () => {
    const zones = dataSource.getRepository(Zone);
    const saved = await zones.save(
      zones.create({
        name: 'Integration Zone',
        joinCode: `IT${Date.now()}`,
        status: ZoneStatus.ACTIVE,
        ownerUserId: null,
        config: {},
      })
    );
    try {
      const found = await zones.findOneOrFail({ where: { id: saved.id } });
      expect(found.status).toBe(ZoneStatus.ACTIVE);
      expect(found.config).toEqual({});
    } finally {
      await zones.delete({ id: saved.id });
    }
  });

  it('no longer enforces per-zone username uniqueness (plan 0018, section 2)', async () => {
    const constraints = await dataSource.query(
      `SELECT conname FROM pg_constraint WHERE conname = 'uq_membership_zone_username'`
    );
    expect(constraints).toEqual([]);
  });

  it('backfills sharedWithZone from the trace the old grant left (plan 0042, 2.4)', async () => {
    // One shared list and one private one in the same group, distinguishable
    // only by whether an access row exists for somebody other than the creator.
    // That row is the observable trace of `shareWithZone` having run, so the
    // statement reads a fact rather than guessing at an intent.
    const zones = dataSource.getRepository(Zone);
    const memberships = dataSource.getRepository(ZoneMembership);
    const lists = dataSource.getRepository(ShoppingList);
    const access = dataSource.getRepository(ListAccess);

    const creatorId = randomUUID();
    const otherId = randomUUID();
    const zone = await zones.save(
      zones.create({
        name: 'Backfill',
        joinCode: `IT${Date.now()}`,
        status: ZoneStatus.ACTIVE,
        ownerUserId: creatorId,
        config: {},
      })
    );
    try {
      const [creator, other] = await memberships.save([
        memberships.create({
          zoneId: zone.id,
          userId: creatorId,
          username: 'creator',
        }),
        memberships.create({
          zoneId: zone.id,
          userId: otherId,
          username: 'other',
        }),
      ]);
      const [shared, priv] = await lists.save([
        lists.create({
          zoneId: zone.id,
          name: 'Shared',
          createdByUserId: creatorId,
        }),
        lists.create({
          zoneId: zone.id,
          name: 'Private',
          createdByUserId: creatorId,
        }),
      ]);
      await access.save([
        // The trace: a row for somebody who is not the creator.
        access.create({
          listId: shared.id,
          membershipId: other.id,
          permissions: [ListPermission.READ, ListPermission.WRITE],
        }),
        // The creator's own row on the private list says nothing about sharing.
        access.create({
          listId: priv.id,
          membershipId: creator.id,
          permissions: [ListPermission.READ, ListPermission.MANAGE],
        }),
      ]);
      // Both columns start false, as they would just after the ALTER TABLE.
      await lists.update({ zoneId: zone.id }, { sharedWithZone: false });

      await dataSource.query(LIST_SHARED_WITH_ZONE_BACKFILL_SQL);

      expect(
        (await lists.findOneOrFail({ where: { id: shared.id } })).sharedWithZone
      ).toBe(true);
      expect(
        (await lists.findOneOrFail({ where: { id: priv.id } })).sharedWithZone
      ).toBe(false);
    } finally {
      // Lists, access rows and memberships all cascade with the zone.
      await zones.delete({ id: zone.id });
    }
  });

  it('accepts two members of one zone with the same username', async () => {
    const zones = dataSource.getRepository(Zone);
    const memberships = dataSource.getRepository(ZoneMembership);
    const zone = await zones.save(
      zones.create({
        name: 'Shared Names',
        joinCode: `IT${Date.now()}`,
        status: ZoneStatus.ACTIVE,
        ownerUserId: null,
        config: {},
      })
    );
    try {
      // Impersonation inside a zone is possible by construction now; the guard is
      // a discriminator in the UI, not a database constraint (section 2).
      const rows = await memberships.save([
        memberships.create({
          zoneId: zone.id,
          userId: randomUUID(),
          username: 'Vela',
        }),
        memberships.create({
          zoneId: zone.id,
          userId: randomUUID(),
          username: 'Vela',
        }),
      ]);
      expect(rows).toHaveLength(2);
    } finally {
      // The membership rows cascade with the zone.
      await zones.delete({ id: zone.id });
    }
  });

  /**
   * A recording lives exactly as long as its comment (plan 0045, section 7).
   *
   * This is an integration test rather than a unit one because the whole claim is
   * about foreign keys: `comment_audio` cascades from the comment, which cascades
   * from the line, which cascades from the list, which cascades from the zone. A
   * mocked repository cannot tell you whether Postgres agrees, and the cost of it
   * not agreeing is a table of orphaned megabytes nothing ever deletes.
   *
   * It also covers account deletion (plan 0011) without naming it: that path
   * reaches these rows by this same chain.
   */
  it('takes a recording with the line its comment is on', async () => {
    const zones = dataSource.getRepository(Zone);
    const lists = dataSource.getRepository(ShoppingList);
    const lines = dataSource.getRepository(ListLine);
    const comments = dataSource.getRepository(LineComment);
    const audio = dataSource.getRepository(CommentAudio);

    const zone = await zones.save(
      zones.create({
        name: 'Cascade',
        joinCode: `IT${Date.now()}`,
        status: ZoneStatus.ACTIVE,
        ownerUserId: null,
        config: {},
      })
    );

    try {
      const list = await lists.save(
        lists.create({
          zoneId: zone.id,
          name: 'Weekly',
          createdByUserId: randomUUID(),
          autoApproveLines: false,
        })
      );
      const line = await lines.save(
        lines.create({
          listId: list.id,
          content: 'Olive oil',
          quantity: 1,
          itemSetHash: null,
          position: 1,
          createdByUserId: randomUUID(),
        })
      );
      const comment = await comments.save(
        comments.create({
          lineId: line.id,
          authorUserId: randomUUID(),
          body: '',
          audioContentType: 'audio/webm',
          audioByteLength: 5,
          audioDurationSeconds: 1.5,
          transcription: CommentTranscription.PENDING,
        })
      );
      await audio.save(
        audio.create({
          commentId: comment.id,
          contentType: 'audio/webm',
          audio: Buffer.from('bytes'),
        })
      );

      // The bytes round-trip as bytes, which is the other half of this test: a
      // `bytea` column that came back as a hex string would be a player fed
      // nonsense, and nothing above the repository would notice.
      const stored = await audio.findOneOrFail({
        where: { commentId: comment.id },
      });
      expect(Buffer.isBuffer(stored.audio)).toBe(true);
      expect(stored.audio.toString()).toBe('bytes');

      await lines.delete({ id: line.id });

      expect(await comments.findOne({ where: { id: comment.id } })).toBeNull();
      expect(
        await audio.findOne({ where: { commentId: comment.id } })
      ).toBeNull();
    } finally {
      await zones.delete({ id: zone.id });
    }
  });
});
