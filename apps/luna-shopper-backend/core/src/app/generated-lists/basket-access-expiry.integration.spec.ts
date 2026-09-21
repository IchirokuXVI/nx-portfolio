import {
  BasketKind,
  GeneratedListStatus,
  ParticipantEndedReason,
  ParticipantKind,
  RealtimeEvent,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import type { Logger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { fakeCoreConfig } from '../baskets/basket-config.fake';
import {
  CORE_ENTITIES,
  GeneratedList,
  GeneratedListParticipant,
  GeneratedListShareLink,
} from '../entities';
import { BasketAccessSweepService } from './basket-access-sweep.service';
import { GeneratedListMembersService } from './generated-list-members.service';
import { GeneratedListSharingService } from './generated-list-sharing.service';

/**
 * A link that lasts twelve hours, against real Postgres (plan 0140,
 * section 12).
 *
 * Integration rather than unit for the reason the plan gives: everything here
 * is a predicate or an upsert. The expiry is compared against the **database's**
 * `now()` in every read, freeing the slot an expired link holds is a write under
 * the partial unique index, the rejoin is an update on a row the unique index
 * pins, and the sweep is one statement with `SKIP LOCKED`. A fake repository
 * would pass all of them and prove none.
 *
 * The clock is moved by writing the column, never by waiting: a spec that slept
 * would be twelve hours long.
 */
describeIntegration('a link that lasts twelve hours (real Postgres)', () => {
  let dataSource: DataSource;
  let sharing: GeneratedListSharingService;
  let sweep: BasketAccessSweepService;

  const events = {
    emit: jest.fn(),
    emitTo: jest.fn(),
    emitToUsers: jest.fn(),
    // The basket audience is a list since plan 0139. These events still name
    // exactly one basket; only the shape of the argument moved.
    emitToBaskets: jest.fn(),
  };

  const owner = randomUUID();

  async function newBasket(
    overrides: Partial<GeneratedList> = {}
  ): Promise<string> {
    const repo = dataSource.getRepository(GeneratedList);
    const saved = await repo.save(
      repo.create({
        ownerUserId: owner,
        name: 'Saturday',
        status: GeneratedListStatus.OPEN,
        generatedAt: new Date(),
        kind: BasketKind.GENERATED,
        idempotencyKey: null,
        ...overrides,
      })
    );
    return saved.id;
  }

  /** Move a row's expiry, which is how this file moves the clock. */
  async function expireIn(
    participantId: string,
    interval: string
  ): Promise<void> {
    await dataSource.query(
      `UPDATE "generated_list_participants"
         SET "expiresAt" = now() + $2::interval WHERE "id" = $1`,
      [participantId, interval]
    );
  }

  async function expireLink(linkId: string, interval: string): Promise<void> {
    await dataSource.query(
      `UPDATE "generated_list_share_links"
         SET "createdAt" = now() + $2::interval - interval '12 hours',
             "expiresAt" = now() + $2::interval WHERE "id" = $1`,
      [linkId, interval]
    );
  }

  function row(id: string): Promise<GeneratedListParticipant> {
    return dataSource
      .getRepository(GeneratedListParticipant)
      .findOneByOrFail({ id });
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();

    const members = new GeneratedListMembersService(
      dataSource,
      events as never
    );
    sharing = new GeneratedListSharingService(
      dataSource,
      dataSource.getRepository(GeneratedList),
      dataSource.getRepository(GeneratedListShareLink),
      dataSource.getRepository(GeneratedListParticipant),
      members,
      fakeCoreConfig()
    );
    sweep = new BasketAccessSweepService(
      dataSource,
      members,
      { log: () => undefined, error: () => undefined } as unknown as Logger,
      fakeCoreConfig()
    );
  }, 60_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('the link', () => {
    it('is minted with an expiry twelve hours after its creation', async () => {
      const basket = await newBasket();
      const link = await sharing.ensureLink({
        userId: owner,
        generatedListId: basket,
      });

      const apart =
        new Date(link.expiresAt).getTime() - new Date(link.createdAt).getTime();
      // Both moments come from one statement, so they cannot disagree.
      expect(apart).toBe(12 * 60 * 60 * 1000);
    });

    it('is no link at all once it expired, and pressing share mints another', async () => {
      const basket = await newBasket();
      const first = await sharing.ensureLink({
        userId: owner,
        generatedListId: basket,
      });
      await expireLink(first.id, '-1 minute');

      await expect(
        sharing.getLink({ userId: owner, generatedListId: basket })
      ).resolves.toEqual({});

      const second = await sharing.ensureLink({
        userId: owner,
        generatedListId: basket,
      });
      expect(second.id).not.toBe(first.id);

      // The partial unique index cannot read a clock, so freeing the slot is a
      // write, and it is what keeps the index from refusing the new link.
      const [live] = await dataSource.query(
        `SELECT count(*)::int AS n FROM "generated_list_share_links"
         WHERE "generatedListId" = $1 AND "revokedAt" IS NULL`,
        [basket]
      );
      expect(live.n).toBe(1);
    });

    it('ends with one live link when two devices press share at once', async () => {
      const basket = await newBasket();
      const both = await Promise.all([
        sharing.ensureLink({ userId: owner, generatedListId: basket }),
        sharing.ensureLink({ userId: owner, generatedListId: basket }),
      ]);

      expect(both[0].id).toBe(both[1].id);
      const rows = await dataSource.query(
        `SELECT count(*)::int AS n FROM "generated_list_share_links"
         WHERE "generatedListId" = $1 AND "revokedAt" IS NULL`,
        [basket]
      );
      expect(rows[0].n).toBe(1);
    });

    it('answers an expired link exactly as it answers one that never existed', async () => {
      const basket = await newBasket();
      const link = await sharing.ensureLink({
        userId: owner,
        generatedListId: basket,
      });
      await expireLink(link.id, '-1 minute');

      await expect(sharing.preview({ secret: link.secret })).resolves.toEqual({
        joinable: false,
      });
      await expect(
        sharing.preview({ secret: 'never-existed' })
      ).resolves.toEqual({ joinable: false });
      await expect(sharing.join({ secret: link.secret })).rejects.toThrow();
    });
  });

  describe('the people a link lets in', () => {
    it('gives a guest and a signed in visitor an expiry, and the owner none', async () => {
      const basket = await newBasket();
      const link = await sharing.ensureLink({
        userId: owner,
        generatedListId: basket,
      });
      const guest = await sharing.join({ secret: link.secret });
      const visitor = await sharing.join({
        secret: link.secret,
        userId: randomUUID(),
      });
      const asOwner = await sharing.join({
        secret: link.secret,
        userId: owner,
      });

      expect(guest.participant.expiresAt).not.toBeNull();
      expect(visitor.participant.expiresAt).not.toBeNull();
      expect(asOwner.participant.expiresAt).toBeNull();
    });

    it('refuses a visitor one second past their expiry and admits one a second before', async () => {
      const basket = await newBasket();
      const link = await sharing.ensureLink({
        userId: owner,
        generatedListId: basket,
      });
      const joined = await sharing.join({ secret: link.secret });
      const secret = joined.sessionSecret as string;

      await expireIn(joined.participant.id, '1 second');
      await expect(
        sharing.resolveParticipant({
          generatedListId: basket,
          sessionSecret: secret,
        })
      ).resolves.toMatchObject({ participantId: joined.participant.id });

      await expireIn(joined.participant.id, '-1 second');
      await expect(
        sharing.resolveParticipant({
          generatedListId: basket,
          sessionSecret: secret,
        })
      ).rejects.toMatchObject({ code: 'participant_expired' });
    });

    it('brings a signed in visitor back under the same id on a fresh link', async () => {
      const basket = await newBasket();
      const visitorId = randomUUID();
      const first = await sharing.ensureLink({
        userId: owner,
        generatedListId: basket,
      });
      const joined = await sharing.join({
        secret: first.secret,
        userId: visitorId,
      });
      await expireIn(joined.participant.id, '-1 hour');
      await expireLink(first.id, '-1 minute');

      const second = await sharing.ensureLink({
        userId: owner,
        generatedListId: basket,
      });
      const back = await sharing.join({
        secret: second.secret,
        userId: visitorId,
      });

      // The unique index over (basket, user) is what makes it the same row, and
      // that is what keeps everything they already bought attributed to them.
      expect(back.participant.id).toBe(joined.participant.id);
      expect(back.participant.expiresAt).not.toBe(joined.participant.expiresAt);
      expect((await row(back.participant.id)).revokedAt).toBeNull();
    });

    it('refuses somebody the owner removed, however fresh the link', async () => {
      const basket = await newBasket();
      const removedId = randomUUID();
      const link = await sharing.ensureLink({
        userId: owner,
        generatedListId: basket,
      });
      const joined = await sharing.join({
        secret: link.secret,
        userId: removedId,
      });
      await sharing.revokeParticipant({
        userId: owner,
        generatedListId: basket,
        participantId: joined.participant.id,
      });

      await expect(
        sharing.join({ secret: link.secret, userId: removedId })
      ).rejects.toThrow();
    });

    it('never shortens a live visitor’s access', async () => {
      const basket = await newBasket();
      const visitorId = randomUUID();
      const link = await sharing.ensureLink({
        userId: owner,
        generatedListId: basket,
      });
      const joined = await sharing.join({
        secret: link.secret,
        userId: visitorId,
      });
      await expireIn(joined.participant.id, '30 hours');

      const again = await sharing.join({
        secret: link.secret,
        userId: visitorId,
      });
      // `GREATEST`: the window they hold is longer, and a second link cannot
      // take it back.
      const held = new Date(again.participant.expiresAt as string).getTime();
      expect(held - Date.now()).toBeGreaterThan(24 * 60 * 60 * 1000);
    });

    it('stops counting an expired visitor toward the room at their expiry', async () => {
      const basket = await newBasket();
      const link = await sharing.ensureLink({
        userId: owner,
        generatedListId: basket,
      });
      const guest = await sharing.join({ secret: link.secret });

      const before = await sharing.preview({ secret: link.secret });
      await expireIn(guest.participant.id, '-1 second');
      const after = await sharing.preview({ secret: link.secret });

      expect(after.participantCount).toBe(
        (before.participantCount as number) - 1
      );
    });
  });

  describe('the permanent basket', () => {
    it('is shared through the same routes, and its preview names nothing', async () => {
      // A `LIVE` basket is open by definition (plan 0133), so `listAccepts`
      // takes it, and it carries no name. That leaks nothing: the client is
      // what words the join screen (velista 0094).
      const basket = await newBasket({ kind: BasketKind.LIVE, name: null });
      const link = await sharing.ensureLink({
        userId: owner,
        generatedListId: basket,
      });

      const preview = await sharing.preview({ secret: link.secret });
      expect(preview.joinable).toBe(true);
      expect(preview.name).toBeNull();

      const guest = await sharing.join({ secret: link.secret });
      expect(guest.participant.kind).toBe(ParticipantKind.GUEST);
      expect(guest.participant.expiresAt).not.toBeNull();
    });
  });

  describe('keeping somebody', () => {
    it('clears the expiry, keeps the id, and puts them past a cascade', async () => {
      const basket = await newBasket();
      const keptId = randomUUID();
      const link = await sharing.ensureLink({
        userId: owner,
        generatedListId: basket,
      });
      const joined = await sharing.join({
        secret: link.secret,
        userId: keptId,
      });

      // The contact rule is waived for somebody already on the basket, which is
      // what makes "keeping access means being added by name" reachable for a
      // friend outside every group of the owner's (section 6).
      const kept = await sharing.addParticipant({
        userId: owner,
        generatedListId: basket,
        memberUserId: keptId,
      });

      expect(kept.id).toBe(joined.participant.id);
      expect(kept.expiresAt).toBeNull();

      await sharing.revokeLink({
        userId: owner,
        generatedListId: basket,
        revokeParticipants: true,
      });
      expect((await row(kept.id)).revokedAt).toBeNull();
    });
  });

  describe('the sweep', () => {
    it('ends an expired row once, with EXPIRED, and announces it', async () => {
      const basket = await newBasket();
      const link = await sharing.ensureLink({
        userId: owner,
        generatedListId: basket,
      });
      const guest = await sharing.join({ secret: link.secret });
      await expireIn(guest.participant.id, '-1 second');

      await sweep.sweep();

      const ended = await row(guest.participant.id);
      expect(ended.revokedAt).not.toBeNull();
      expect(ended.endedReason).toBe(ParticipantEndedReason.EXPIRED);
      expect(
        events.emitToBaskets.mock.calls.filter(
          ([name, ids]) =>
            name === RealtimeEvent.GeneratedListParticipantLeft &&
            (ids as readonly string[]).includes(basket)
        )
      ).toHaveLength(1);

      // A second tick finds nothing: the row is revoked, so the predicate skips
      // it, and nobody hears about them twice.
      events.emitToBaskets.mockClear();
      await sweep.sweep();
      expect(events.emitToBaskets).not.toHaveBeenCalled();
    });

    it('announces no row twice when two sweeps run at once', async () => {
      // `SKIP LOCKED` is the whole of this, and it is the database's rather than
      // the service's, which is why it is asserted here.
      const basket = await newBasket();
      const link = await sharing.ensureLink({
        userId: owner,
        generatedListId: basket,
      });
      const first = await sharing.join({ secret: link.secret });
      const second = await sharing.join({ secret: link.secret });
      await expireIn(first.participant.id, '-1 second');
      await expireIn(second.participant.id, '-1 second');

      const [a, b] = await Promise.all([sweep.sweep(), sweep.sweep()]);
      expect(a + b).toBe(2);

      const told = events.emitToBaskets.mock.calls.filter(
        ([name, ids]) =>
          name === RealtimeEvent.GeneratedListParticipantLeft &&
          (ids as readonly string[]).includes(basket)
      );
      expect(told).toHaveLength(2);
    });

    it('revokes an expired link and evicts nobody for it', async () => {
      const basket = await newBasket();
      const link = await sharing.ensureLink({
        userId: owner,
        generatedListId: basket,
      });
      const guest = await sharing.join({ secret: link.secret });
      await expireLink(link.id, '-1 minute');

      await sweep.sweep();

      const [row0] = await dataSource.query(
        `SELECT "revokedAt" FROM "generated_list_share_links" WHERE "id" = $1`,
        [link.id]
      );
      expect(row0.revokedAt).not.toBeNull();
      // Their own expiry is what ends them, and it has not passed.
      expect((await row(guest.participant.id)).revokedAt).toBeNull();
    });

    it('leaves the owner and a named person alone for ever', async () => {
      const basket = await newBasket();
      await sharing.ensureLink({ userId: owner, generatedListId: basket });

      await sweep.sweep();

      const ownerRow = await dataSource
        .getRepository(GeneratedListParticipant)
        .findOneByOrFail({ generatedListId: basket, userId: owner });
      expect(ownerRow.kind).toBe(ParticipantKind.OWNER);
      expect(ownerRow.revokedAt).toBeNull();
    });
  });
});
