import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { CoreAuditService } from '../audit/core-audit.service';
import { fakeBasketAnnouncer } from '../baskets/basket-announcer.fake';
import { BasketService } from '../baskets/basket.service';
import {
  Basket,
  CORE_ENTITIES,
  ProcessedEvent,
  ZoneMembership,
} from '../entities';
import { ProcessedEventStore } from '../events/idempotency.store';
import {
  AccountDeletionService,
  deletionKey,
  TOMBSTONE_PREFIX,
} from './account-deletion.service';
import { anonymizedUsername } from './anonymize';
import { CORE_USER_IDS_SQL } from './reconcile-deletions';

/**
 * A deleted account in core, against real Postgres (plan 0232, section 8).
 *
 * One person with everything section 2 names: a profile with a postal code,
 * app state, two zones (a member of one, the owner of the other), lists and
 * lines, a typed and a voice comment, a change, a merge request, an approval of
 * somebody else, a row on somebody else's basket with a settlement on each
 * path, a basket of their own, audit rows, and the dedupe key plan 0011 wrote.
 * The deletion runs, and every row of section 2's core table is asserted by
 * name. Then a second person's deletion is made to fail after step 2, and
 * nothing of theirs changed, the key included.
 *
 *   LUNA_INTEGRATION=1 CORE_DB_URL=postgres://luna_core:luna_core@localhost:<port>/luna_core \
 *     npx nx run luna-shopper-backend-core:test-integration --testFile=account-deletion.integration.spec.ts
 */
describeIntegration('an account deletion in core (real Postgres)', () => {
  let dataSource: DataSource;
  const zones: string[] = [];
  const owners: string[] = [];

  /** The service, with a seam that can fail after step 2. */
  class Failing extends AccountDeletionService {
    fail = false;
    protected override async afterZoneRewrites(
      _manager: EntityManager
    ): Promise<void> {
      if (this.fail) {
        throw new Error('fault injected after step 2');
      }
    }
  }
  let service: Failing;
  const events = { emit: jest.fn(), emitTo: jest.fn() };

  async function sql<T = Record<string, unknown>>(
    query: string,
    parameters: unknown[] = []
  ): Promise<T[]> {
    return (await dataSource.query(query, parameters)) as T[];
  }
  async function one<T = Record<string, unknown>>(
    query: string,
    parameters: unknown[] = []
  ): Promise<T> {
    const [row] = await sql<T>(query, parameters);
    return row;
  }
  async function insert(
    query: string,
    parameters: unknown[] = []
  ): Promise<string> {
    return (await one<{ id: string }>(`${query} RETURNING "id"`, parameters))
      .id;
  }

  async function zone(name: string, ownerUserId: string): Promise<string> {
    const id = await insert(
      `INSERT INTO "zones" ("name", "joinCode", "status", "ownerUserId", "config")
       VALUES ($1, $2, 'ACTIVE', $3, '{}')`,
      [
        name,
        `DEL${Date.now()}${Math.floor(Math.random() * 1e6)}`.slice(0, 16),
        ownerUserId,
      ]
    );
    zones.push(id);
    return id;
  }

  async function member(
    zoneId: string,
    userId: string,
    username: string,
    role: 'OWNER' | 'MEMBER',
    approvedByUserId: string | null
  ): Promise<string> {
    return insert(
      `INSERT INTO "zone_memberships"
         ("zoneId", "userId", "username", "role", "status", "approvedByUserId")
       VALUES ($1, $2, $3, $4, 'APPROVED', $5)`,
      [zoneId, userId, username, role, approvedByUserId]
    );
  }

  async function basket(ownerUserId: string): Promise<string> {
    owners.push(ownerUserId);
    return insert(
      `INSERT INTO "baskets" ("ownerUserId", "kind", "name", "status", "generatedAt")
       VALUES ($1, 'GENERATED', 'Trip', 'FINISHED', now())`,
      [ownerUserId]
    );
  }

  /** Everything one person leaves in core. Answers the ids the asserts read. */
  async function seed(person: string, friend: string) {
    const zoneA = await zone('Flat', friend);
    const zoneB = await zone('Family', person);
    const friendInA = await member(zoneA, friend, 'Fran', 'OWNER', null);
    const personInA = await member(zoneA, person, 'Pat', 'MEMBER', friend);
    const personInB = await member(zoneB, person, 'Pat', 'OWNER', null);
    const friendInB = await member(zoneB, friend, 'Fran', 'MEMBER', person);

    const listA = await insert(
      `INSERT INTO "shopping_lists" ("zoneId", "name", "createdByUserId")
       VALUES ($1, 'Weekly', $2)`,
      [zoneA, person]
    );
    const listB = await insert(
      `INSERT INTO "shopping_lists" ("zoneId", "name", "createdByUserId")
       VALUES ($1, 'Home', $2)`,
      [zoneB, person]
    );
    const theirLine = await insert(
      `INSERT INTO "list_lines" ("listId", "content", "createdByUserId", "approvedByUserId")
       VALUES ($1, 'Milk', $2, $3)`,
      [listA, person, friend]
    );
    // A line somebody else wrote, that the person approved and then deleted.
    const deletedLine = await insert(
      `INSERT INTO "list_lines"
         ("listId", "content", "createdByUserId", "approvedByUserId",
          "deletedAt", "deletedByUserId")
       VALUES ($1, 'Bread', $2, $3, now(), $3)`,
      [listA, friend, person]
    );
    const lineB = await insert(
      `INSERT INTO "list_lines" ("listId", "content", "createdByUserId")
       VALUES ($1, 'Eggs', $2)`,
      [listB, person]
    );

    const typed = await insert(
      `INSERT INTO "line_comments" ("lineId", "authorUserId", "body")
       VALUES ($1, $2, 'the big one')`,
      [theirLine, person]
    );
    const voice = await insert(
      `INSERT INTO "line_comments"
         ("lineId", "authorUserId", "body", "audioContentType",
          "audioByteLength", "audioDurationSeconds", "transcription")
       VALUES ($1, $2, 'two litres', 'audio/webm', 4, 1.5, 'READY')`,
      [theirLine, person]
    );
    await sql(
      `INSERT INTO "comment_audio" ("commentId", "contentType", "audio")
       VALUES ($1, 'audio/webm', '\\x01020304'::bytea)`,
      [voice]
    );
    const friendComment = await insert(
      `INSERT INTO "line_comments" ("lineId", "authorUserId", "body")
       VALUES ($1, $2, 'ok')`,
      [theirLine, friend]
    );

    const change = await insert(
      `INSERT INTO "list_line_changes" ("zoneId", "listId", "lineId", "kind", "actorUserId")
       VALUES ($1, $2, $3, 'ADDED', $4)`,
      [zoneA, listA, theirLine, person]
    );
    const merge = await insert(
      `INSERT INTO "merge_requests"
         ("zoneId", "sourceUserId", "targetUserId", "requestedByUserId",
          "status", "resolvedByUserId")
       VALUES ($1, $2, $3, $3, 'REJECTED', $2)`,
      [zoneA, person, friend]
    );

    // Somebody else's basket, drawing from zone A, with the person on it.
    const friendsBasket = await basket(friend);
    await sql(
      `INSERT INTO "basket_sources" ("basketId", "zoneId", "listId")
       VALUES ($1, $2, $3)`,
      [friendsBasket, zoneA, listA]
    );
    const seat = await insert(
      `INSERT INTO "basket_participants"
         ("basketId", "kind", "userId", "username", "displayName",
          "userAgent", "sessionSecretHash", "joinedAt", "lastSeenAt",
          "invitedAt", "invitedByUserId", "expiresAt")
       VALUES ($1, 'REGISTERED', $2, 'Pat', 'Patricia', 'Firefox on Android',
               $3, now(), now(), now(), $4, NULL)`,
      [friendsBasket, person, randomUUID().replace(/-/g, ''), friend]
    );
    // Somebody the person added, on a basket that is not theirs.
    const invited = await insert(
      `INSERT INTO "basket_participants"
         ("basketId", "kind", "userId", "username", "joinedAt", "lastSeenAt",
          "invitedAt", "invitedByUserId", "expiresAt")
       VALUES ($1, 'REGISTERED', $2, 'Sam', now(), now(), now(), $3, NULL)`,
      [friendsBasket, randomUUID(), person]
    );
    const onListPage = await insert(
      `INSERT INTO "line_settlements"
         ("lineId", "listId", "outcome", "quantity", "settledByUserId", "settledAt")
       VALUES ($1, $2, 'BOUGHT', 1, $3, now())`,
      [theirLine, listA, person]
    );
    const fromBasket = await insert(
      `INSERT INTO "line_settlements"
         ("lineId", "listId", "outcome", "quantity", "settledByParticipantId",
          "settledAt", "basketId")
       VALUES ($1, $2, 'BOUGHT', 1, $3, now(), $4)`,
      [theirLine, listA, seat, friendsBasket]
    );

    const ownBasket = await basket(person);
    const profile = await insert(
      `INSERT INTO "shopping_profiles" ("userId", "name", "addressText")
       VALUES ($1, 'Home', 'Calle Mayor 1')`,
      [person]
    );
    await sql(
      `INSERT INTO "profile_postal_codes" ("profileId", "postalCode", "label")
       VALUES ($1, '14001', 'home')`,
      [profile]
    );
    await sql(
      `INSERT INTO "user_app_state" ("userId", "setupCompletedAt") VALUES ($1, now())`,
      [person]
    );

    const admin = randomUUID();
    const audit = async (
      entity: string,
      entityId: string,
      before: unknown,
      after: unknown
    ) =>
      insert(
        `INSERT INTO "core_audit"
           ("actorId", "actorKind", "entity", "entityId", "action", "before", "after")
         VALUES ($1, 'ADMIN', $2, $3, 'UPDATE', $4::jsonb, $5::jsonb)`,
        [admin, entity, entityId, JSON.stringify(before), JSON.stringify(after)]
      );
    const renamed = await audit(
      'zone_memberships',
      personInA,
      { username: 'Pat' },
      { username: 'Patty' }
    );
    const approved = await audit(
      'list_lines',
      theirLine,
      { approvedByUserId: null },
      { approvedByUserId: person, status: 'APPROVED' }
    );
    const aboutThem = await audit(
      'user_app_state',
      person,
      { email: 'pat@example.com', userAgent: 'Firefox', tourSeenAt: null },
      { email: null, userAgent: 'Chrome', tourSeenAt: '2026-10-01' }
    );
    const unrelated = await audit(
      'zone_memberships',
      friendInA,
      { username: 'Fran' },
      { username: 'Francesca' }
    );

    await sql(`INSERT INTO "processed_events" ("key") VALUES ($1)`, [
      `user.deleted:${person}`,
    ]);

    return {
      zoneA,
      zoneB,
      personInA,
      personInB,
      friendInB,
      listA,
      listB,
      theirLine,
      deletedLine,
      lineB,
      typed,
      voice,
      friendComment,
      change,
      merge,
      friendsBasket,
      seat,
      invited,
      onListPage,
      fromBasket,
      ownBasket,
      profile,
      renamed,
      approved,
      aboutThem,
      unrelated,
    };
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
    service = new Failing(
      dataSource,
      dataSource.getRepository(ZoneMembership),
      events as never,
      { emitZoneCounts: jest.fn(async () => undefined) } as never,
      new ProcessedEventStore(dataSource.getRepository(ProcessedEvent)),
      // The basket delete runs on the deletion's manager and reads nothing of
      // the service's own, so the rest of its constructor is not needed here.
      new BasketService(
        dataSource,
        dataSource.getRepository(Basket),
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never
      ),
      fakeBasketAnnouncer(),
      new CoreAuditService(dataSource)
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      for (const owner of owners) {
        await sql(`DELETE FROM "baskets" WHERE "ownerUserId" = $1`, [owner]);
      }
      for (const id of zones) {
        await sql(
          `DELETE FROM "core_audit" WHERE "entityId" IN (
          SELECT "id" FROM "zone_memberships" WHERE "zoneId" = $1)`,
          [id]
        );
        await sql(`DELETE FROM "zones" WHERE "id" = $1`, [id]);
      }
      await dataSource.destroy();
    }
  });

  it('deletes what is personal and keeps the rest with a tombstone of its zone', async () => {
    const person = randomUUID();
    const friend = randomUUID();
    const s = await seed(person, friend);

    await expect(service.handleUserDeleted(person)).resolves.toBe(true);

    // zone_memberships: kept, KICKED, anonymized, a tombstone per zone.
    const inA = await one<{ userId: string; username: string; status: string }>(
      `SELECT "userId", "username", "status" FROM "zone_memberships" WHERE "id" = $1`,
      [s.personInA]
    );
    const inB = await one<{ userId: string; username: string; status: string }>(
      `SELECT "userId", "username", "status" FROM "zone_memberships" WHERE "id" = $1`,
      [s.personInB]
    );
    const tA = inA.userId;
    const tB = inB.userId;
    expect(tA).not.toBe(person);
    expect(tB).not.toBe(person);
    expect(tA).not.toBe(tB);
    expect(inA).toMatchObject({
      status: 'KICKED',
      username: anonymizedUsername(s.personInA),
    });
    expect(inB).toMatchObject({
      status: 'KICKED',
      username: anonymizedUsername(s.personInB),
    });
    // ... and the approval of somebody else, to the tombstone of that zone.
    await expect(
      one(`SELECT "approvedByUserId" FROM "zone_memberships" WHERE "id" = $1`, [
        s.friendInB,
      ])
    ).resolves.toEqual({ approvedByUserId: tB });

    // shopping_lists.
    await expect(
      sql(
        `SELECT "id", "createdByUserId" FROM "shopping_lists"
          WHERE "id" IN ($1, $2) ORDER BY "id" = $1 DESC`,
        [s.listA, s.listB]
      )
    ).resolves.toEqual([
      { id: s.listA, createdByUserId: tA },
      { id: s.listB, createdByUserId: tB },
    ]);

    // list_lines, the soft deleted one included.
    await expect(
      one(
        `SELECT "createdByUserId", "approvedByUserId", "deletedByUserId"
           FROM "list_lines" WHERE "id" = $1`,
        [s.theirLine]
      )
    ).resolves.toEqual({
      createdByUserId: tA,
      approvedByUserId: friend,
      deletedByUserId: null,
    });
    await expect(
      one(
        `SELECT "createdByUserId", "approvedByUserId", "deletedByUserId"
           FROM "list_lines" WHERE "id" = $1`,
        [s.deletedLine]
      )
    ).resolves.toEqual({
      createdByUserId: friend,
      approvedByUserId: tA,
      deletedByUserId: tA,
    });
    await expect(
      one(`SELECT "createdByUserId" FROM "list_lines" WHERE "id" = $1`, [
        s.lineB,
      ])
    ).resolves.toEqual({ createdByUserId: tB });

    // line_comments: kept, the body and the transcript state too.
    await expect(
      one(
        `SELECT "authorUserId", "body" FROM "line_comments" WHERE "id" = $1`,
        [s.typed]
      )
    ).resolves.toEqual({ authorUserId: tA, body: 'the big one' });
    await expect(
      one(
        `SELECT "authorUserId", "body", "audioContentType", "audioByteLength",
                "audioDurationSeconds", "transcription"
           FROM "line_comments" WHERE "id" = $1`,
        [s.voice]
      )
    ).resolves.toEqual({
      authorUserId: tA,
      body: 'two litres',
      audioContentType: null,
      audioByteLength: null,
      audioDurationSeconds: null,
      transcription: 'READY',
    });
    await expect(
      one(`SELECT "authorUserId" FROM "line_comments" WHERE "id" = $1`, [
        s.friendComment,
      ])
    ).resolves.toEqual({ authorUserId: friend });

    // comment_audio: the voice is gone.
    await expect(
      sql(`SELECT 1 FROM "comment_audio" WHERE "commentId" = $1`, [s.voice])
    ).resolves.toEqual([]);

    // list_line_changes.
    await expect(
      one(`SELECT "actorUserId" FROM "list_line_changes" WHERE "id" = $1`, [
        s.change,
      ])
    ).resolves.toEqual({ actorUserId: tA });

    // merge_requests: each column that named the person.
    await expect(
      one(
        `SELECT "sourceUserId", "targetUserId", "requestedByUserId", "resolvedByUserId"
           FROM "merge_requests" WHERE "id" = $1`,
        [s.merge]
      )
    ).resolves.toEqual({
      sourceUserId: tA,
      targetUserId: friend,
      requestedByUserId: friend,
      resolvedByUserId: tA,
    });

    // baskets of the person: gone. Somebody else's: kept.
    await expect(
      sql(`SELECT 1 FROM "baskets" WHERE "id" = $1`, [s.ownBasket])
    ).resolves.toEqual([]);
    await expect(
      sql(`SELECT 1 FROM "baskets" WHERE "id" = $1`, [s.friendsBasket])
    ).resolves.toHaveLength(1);

    // basket_participants on somebody else's basket: kept and scrubbed, with
    // the anonymized name of the zone the basket draws from.
    await expect(
      one(
        `SELECT "userId", "userAgent", "sessionSecretHash", "username", "displayName"
           FROM "basket_participants" WHERE "id" = $1`,
        [s.seat]
      )
    ).resolves.toEqual({
      userId: null,
      userAgent: null,
      sessionSecretHash: null,
      username: anonymizedUsername(s.personInA),
      displayName: anonymizedUsername(s.personInA),
    });
    await expect(
      one(
        `SELECT "invitedByUserId" FROM "basket_participants" WHERE "id" = $1`,
        [s.invited]
      )
    ).resolves.toEqual({ invitedByUserId: null });

    // line_settlements: both kept. The list page one carries the tombstone,
    // because `ck_line_settlements_actor` forbids a row with neither actor.
    await expect(
      one(
        `SELECT "settledByUserId", "settledByParticipantId" FROM "line_settlements" WHERE "id" = $1`,
        [s.onListPage]
      )
    ).resolves.toEqual({ settledByUserId: tA, settledByParticipantId: null });
    await expect(
      one(
        `SELECT "settledByUserId", "settledByParticipantId" FROM "line_settlements" WHERE "id" = $1`,
        [s.fromBasket]
      )
    ).resolves.toEqual({
      settledByUserId: null,
      settledByParticipantId: s.seat,
    });

    // zones owned by the person: ownerless and marked.
    await expect(
      one(`SELECT "ownerUserId", "status" FROM "zones" WHERE "id" = $1`, [
        s.zoneB,
      ])
    ).resolves.toEqual({ ownerUserId: null, status: 'MARKED_FOR_DELETION' });

    // shopping_profiles, their postal codes by cascade, and user_app_state.
    await expect(
      sql(`SELECT 1 FROM "shopping_profiles" WHERE "userId" = $1`, [person])
    ).resolves.toEqual([]);
    await expect(
      sql(`SELECT 1 FROM "profile_postal_codes" WHERE "profileId" = $1`, [
        s.profile,
      ])
    ).resolves.toEqual([]);
    await expect(
      sql(`SELECT 1 FROM "user_app_state" WHERE "userId" = $1`, [person])
    ).resolves.toEqual([]);

    // core_audit: scrubbed, each row by the zone it names.
    const renamed = await one<{
      entityId: string;
      before: unknown;
      after: unknown;
    }>(
      `SELECT "entityId", "before", "after" FROM "core_audit" WHERE "id" = $1`,
      [s.renamed]
    );
    expect(renamed).toEqual({
      entityId: s.personInA,
      before: { username: anonymizedUsername(s.personInA) },
      after: { username: anonymizedUsername(s.personInA) },
    });
    await expect(
      one(`SELECT "before", "after" FROM "core_audit" WHERE "id" = $1`, [
        s.approved,
      ])
    ).resolves.toEqual({
      before: { approvedByUserId: null },
      after: { approvedByUserId: tA, status: 'APPROVED' },
    });
    const aboutThem = await one<{
      entityId: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }>(
      `SELECT "entityId", "before", "after" FROM "core_audit" WHERE "id" = $1`,
      [s.aboutThem]
    );
    expect(aboutThem.entityId).not.toBe(person);
    expect([tA, tB]).not.toContain(aboutThem.entityId);
    expect(aboutThem.before).toEqual({
      email: null,
      userAgent: null,
      tourSeenAt: null,
    });
    expect(aboutThem.after).toEqual({
      email: null,
      userAgent: null,
      tourSeenAt: '2026-10-01',
    });
    await expect(
      one(`SELECT "before", "after" FROM "core_audit" WHERE "id" = $1`, [
        s.unrelated,
      ])
    ).resolves.toEqual({
      before: { username: 'Fran' },
      after: { username: 'Francesca' },
    });

    // processed_events: the hash, and not the id.
    await expect(
      sql(`SELECT "key" FROM "processed_events" WHERE "key" IN ($1, $2)`, [
        deletionKey(person),
        `user.deleted:${person}`,
      ])
    ).resolves.toEqual([{ key: deletionKey(person) }]);

    // No column of section 2 names the person any more, and no audit row.
    const ids = (await sql<{ id: string }>(CORE_USER_IDS_SQL)).map((r) => r.id);
    expect(ids).not.toContain(person);
    // A tombstone is no candidate of the reconcile command either, so its
    // release task does nothing the second time.
    for (const tombstone of [tA, tB, aboutThem.entityId]) {
      expect(tombstone.startsWith(TOMBSTONE_PREFIX)).toBe(true);
      expect(ids).not.toContain(tombstone);
    }
    await expect(
      sql(
        `SELECT "id" FROM "core_audit"
          WHERE "entityId" = $1 OR "before"::text LIKE $2 OR "after"::text LIKE $2`,
        [person, `%${person}%`]
      )
    ).resolves.toEqual([]);

    // A redelivery is a no-op.
    await expect(service.handleUserDeleted(person)).resolves.toBe(false);
  });

  it('changes nothing, the key included, when it fails after step 2', async () => {
    const person = randomUUID();
    const friend = randomUUID();
    const s = await seed(person, friend);
    const snapshot = async () => ({
      memberships: await sql(
        `SELECT "id", "userId", "username", "status", "approvedByUserId"
           FROM "zone_memberships" WHERE "zoneId" IN ($1, $2) ORDER BY "id"`,
        [s.zoneA, s.zoneB]
      ),
      lists: await sql(
        `SELECT "id", "createdByUserId" FROM "shopping_lists" WHERE "zoneId" IN ($1, $2) ORDER BY "id"`,
        [s.zoneA, s.zoneB]
      ),
      lines: await sql(
        `SELECT "id", "createdByUserId", "approvedByUserId", "deletedByUserId"
           FROM "list_lines" WHERE "listId" IN ($1, $2) ORDER BY "id"`,
        [s.listA, s.listB]
      ),
      comments: await sql(
        `SELECT "id", "authorUserId", "audioContentType" FROM "line_comments"
          WHERE "lineId" = $1 ORDER BY "id"`,
        [s.theirLine]
      ),
      audio: await sql(
        `SELECT "commentId" FROM "comment_audio" WHERE "commentId" = $1`,
        [s.voice]
      ),
      merge: await sql(`SELECT * FROM "merge_requests" WHERE "id" = $1`, [
        s.merge,
      ]),
      participants: await sql(
        `SELECT "id", "userId", "username", "invitedByUserId" FROM "basket_participants"
          WHERE "basketId" = $1 ORDER BY "id"`,
        [s.friendsBasket]
      ),
      settlements: await sql(
        `SELECT "id", "settledByUserId" FROM "line_settlements" WHERE "lineId" = $1 ORDER BY "id"`,
        [s.theirLine]
      ),
      baskets: await sql(
        `SELECT "id" FROM "baskets" WHERE "ownerUserId" = $1`,
        [person]
      ),
      zone: await sql(
        `SELECT "ownerUserId", "status" FROM "zones" WHERE "id" = $1`,
        [s.zoneB]
      ),
      profiles: await sql(
        `SELECT "id" FROM "shopping_profiles" WHERE "userId" = $1`,
        [person]
      ),
      appState: await sql(
        `SELECT "userId" FROM "user_app_state" WHERE "userId" = $1`,
        [person]
      ),
      audit: await sql(
        `SELECT "id", "entityId", "before", "after" FROM "core_audit"
          WHERE "id" IN ($1, $2, $3) ORDER BY "id"`,
        [s.renamed, s.approved, s.aboutThem]
      ),
      keys: await sql(
        `SELECT "key" FROM "processed_events" WHERE "key" IN ($1, $2)`,
        [deletionKey(person), `user.deleted:${person}`]
      ),
    });
    const before = await snapshot();
    events.emit.mockClear();
    events.emitTo.mockClear();

    service.fail = true;
    try {
      await expect(service.handleUserDeleted(person)).rejects.toThrow(
        'fault injected after step 2'
      );
    } finally {
      service.fail = false;
    }

    expect(await snapshot()).toEqual(before);
    expect(before.keys).toEqual([{ key: `user.deleted:${person}` }]);
    // Nothing was announced for a deletion that rolled back.
    expect(events.emit).not.toHaveBeenCalled();
    expect(events.emitTo).not.toHaveBeenCalled();

    // And the redelivery does the whole thing.
    await expect(service.handleUserDeleted(person)).resolves.toBe(true);
    const ids = (await sql<{ id: string }>(CORE_USER_IDS_SQL)).map((r) => r.id);
    expect(ids).not.toContain(person);
  });
});
