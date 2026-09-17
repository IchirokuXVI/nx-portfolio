import {
  GeneratedLineOrigin,
  GeneratedListStatus,
  LineApprovalStatus,
  MembershipStatus,
  ParticipantEndedReason,
  ParticipantKind,
  RealtimeEvent,
  ZoneRole,
  ZoneStatus,
  type GeneratedListAccessEvent,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  NotAParticipantException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource, In } from 'typeorm';
import {
  CORE_ENTITIES,
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOption,
  GeneratedListLineOrigin,
  GeneratedListParticipant,
  GeneratedListShareLink,
  LineSettlement,
  ListLine,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { GeneratedListBasketService } from './generated-list-basket.service';
import { GeneratedListMembersService } from './generated-list-members.service';
import { GeneratedListSharingService } from './generated-list-sharing.service';
import { GeneratedListService } from './generated-list.service';
import { fakeLineClaims } from './line-claims.fake';

/**
 * A basket shared with people you know, against real Postgres (plan 0114,
 * sections 3 to 11).
 *
 * Integration rather than unit for the reason the plan gives: nearly every rule
 * here lives in the database. The partial unique index is what two concurrent
 * joins race, the check constraint is what keeps a reason beside every
 * revocation, the contact check is a join over two memberships, and the shared
 * listing is a keyset read whose cursor has to survive microseconds. A fake
 * repository would pass all of them and prove none.
 *
 * The event publisher is the one double, and it records rather than answers:
 * what each path tells the basket room and the person is asserted beside the
 * row it wrote.
 */
describeIntegration(
  'a basket shared with people you know (real Postgres)',
  () => {
    let dataSource: DataSource;
    let generated: GeneratedListService;
    let sharing: GeneratedListSharingService;
    let baskets: GeneratedListBasketService;

    const events = {
      emit: jest.fn(),
      emitTo: jest.fn(),
      emitToUsers: jest.fn(),
      emitToGeneratedList: jest.fn(),
    };

    const users = {
      owner: randomUUID(),
      friend: randomUUID(),
      twin: randomUUID(),
      reader: randomUUID(),
      duo: randomUUID(),
      pending: randomUUID(),
      stranger: randomUUID(),
      racer: randomUUID(),
    };
    const ids = { home: '', club: '', weekly: '', unused: '' };

    /** Everybody a basket was said to be shared with, in the order they were told. */
    function toldShared(generatedListId: string): string[] {
      return toldOn(RealtimeEvent.GeneratedListShared, generatedListId);
    }

    function toldUnshared(generatedListId: string): string[] {
      return toldOn(RealtimeEvent.GeneratedListUnshared, generatedListId);
    }

    function toldOn(event: RealtimeEvent, generatedListId: string): string[] {
      return events.emitToUsers.mock.calls
        .filter(
          ([name, , payload]) =>
            name === event &&
            (payload as GeneratedListAccessEvent).generatedListId ===
              generatedListId
        )
        .flatMap(([, userIds]) => userIds as string[]);
    }

    function roomHeard(
      event: RealtimeEvent,
      generatedListId: string
    ): unknown[] {
      return events.emitToGeneratedList.mock.calls
        .filter(
          ([name, basket]) => name === event && basket === generatedListId
        )
        .map(([, , payload]) => payload);
    }

    function row(id: string): Promise<GeneratedListParticipant> {
      return dataSource
        .getRepository(GeneratedListParticipant)
        .findOneByOrFail({ id });
    }

    async function newBasket(
      overrides: Partial<GeneratedList> = {}
    ): Promise<string> {
      const repo = dataSource.getRepository(GeneratedList);
      const saved = await repo.save(
        repo.create({
          ownerUserId: users.owner,
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
          ...overrides,
        })
      );
      return saved.id;
    }

    async function add(generatedListId: string, memberUserId: string) {
      return sharing.addParticipant({
        userId: users.owner,
        generatedListId,
        memberUserId,
      });
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
        members
      );
      generated = new GeneratedListService(
        dataSource,
        dataSource.getRepository(GeneratedList),
        dataSource.getRepository(GeneratedListLine),
        dataSource.getRepository(GeneratedListLineOrigin),
        dataSource.getRepository(GeneratedListLineOption),
        dataSource.getRepository(LineSettlement),
        // A run that names its own sources asks only for the pricing profile.
        { pricingProfileId: async () => null } as never,
        fakeLineClaims({}).service,
        events as never,
        {
          order: async (_userId: string, composed: unknown[]) => composed,
        } as never,
        members
      );
      baskets = new GeneratedListBasketService(
        dataSource.getRepository(GeneratedList),
        dataSource.getRepository(GeneratedListLine),
        dataSource.getRepository(GeneratedListLineOption),
        dataSource.getRepository(ShoppingList),
        generated,
        sharing,
        // The owner's default target, which no read reaches.
        undefined as never,
        events as never
      );

      const zones = dataSource.getRepository(Zone);
      const memberships = dataSource.getRepository(ZoneMembership);
      for (const key of ['home', 'club'] as const) {
        ids[key] = (
          await zones.save(
            zones.create({
              name: key === 'home' ? 'Home' : 'Club',
              joinCode: randomUUID().replace(/-/g, '').slice(0, 12),
              status: ZoneStatus.ACTIVE,
              ownerUserId: users.owner,
              config: {},
            })
          )
        ).id;
      }

      // Home holds everybody the owner can share with, under their names there.
      // The club is the second group the owner shares with two of them, which is
      // what makes their name a global one (section 9).
      const roster: [
        keyof typeof ids,
        string,
        string,
        ZoneRole,
        MembershipStatus,
      ][] = [
        [
          'home',
          users.owner,
          'Owner at home',
          ZoneRole.OWNER,
          MembershipStatus.APPROVED,
        ],
        [
          'home',
          users.friend,
          'Friendo',
          ZoneRole.MEMBER,
          MembershipStatus.APPROVED,
        ],
        [
          'home',
          users.twin,
          'Twin at home',
          ZoneRole.MEMBER,
          MembershipStatus.APPROVED,
        ],
        [
          'home',
          users.reader,
          'Reader',
          ZoneRole.MEMBER,
          MembershipStatus.APPROVED,
        ],
        [
          'home',
          users.duo,
          'Duo at home',
          ZoneRole.MEMBER,
          MembershipStatus.APPROVED,
        ],
        [
          'home',
          users.pending,
          'Pending',
          ZoneRole.MEMBER,
          MembershipStatus.PENDING,
        ],
        [
          'club',
          users.owner,
          'Owner at the club',
          ZoneRole.OWNER,
          MembershipStatus.APPROVED,
        ],
        [
          'club',
          users.twin,
          'Twin at the club',
          ZoneRole.MEMBER,
          MembershipStatus.APPROVED,
        ],
        [
          'club',
          users.duo,
          'Duo at the club',
          ZoneRole.MEMBER,
          MembershipStatus.APPROVED,
        ],
      ];
      for (const [zone, userId, username, role, status] of roster) {
        await memberships.save(
          memberships.create({
            zoneId: ids[zone],
            userId,
            username,
            role,
            status,
          })
        );
      }

      const lists = dataSource.getRepository(ShoppingList);
      for (const [key, name] of [
        ['weekly', 'Weekly shop'],
        ['unused', 'Party'],
      ] as const) {
        ids[key] = (
          await lists.save(
            lists.create({
              zoneId: ids.home,
              name,
              createdByUserId: users.owner,
            })
          )
        ).id;
      }
    });

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        // Links, participants, lines, origins and options cascade from a basket.
        await dataSource
          .getRepository(GeneratedList)
          .delete({ ownerUserId: users.owner });
        // Memberships, lists and lines cascade from a zone.
        const zoneIds = [ids.home, ids.club].filter(Boolean);
        if (zoneIds.length > 0) {
          await dataSource.getRepository(Zone).delete({ id: In(zoneIds) });
        }
        await dataSource.destroy();
      }
    });

    beforeEach(() => {
      jest.clearAllMocks();
    });

    describe('choosing people when a basket is created (section 4)', () => {
      it('writes an invited row per person, named by the one common group or globally', async () => {
        const run = await generated.create({
          userId: users.owner,
          sources: [{ zoneId: ids.home }],
          memberUserIds: [users.friend, users.twin],
          globalUsernames: [
            { userId: users.friend, username: 'Friend everywhere' },
            { userId: users.twin, username: 'Twin everywhere' },
          ],
        });
        const basket = run.list.id;

        const friend = await dataSource
          .getRepository(GeneratedListParticipant)
          .findOneByOrFail({ generatedListId: basket, userId: users.friend });
        expect(friend).toMatchObject({
          kind: ParticipantKind.REGISTERED,
          shareLinkId: null,
          invitedByUserId: users.owner,
          revokedAt: null,
          endedReason: null,
          // One group in common, so the name that group knows them by.
          username: 'Friendo',
        });
        expect(friend.invitedAt).toBeInstanceOf(Date);

        const twin = await dataSource
          .getRepository(GeneratedListParticipant)
          .findOneByOrFail({ generatedListId: basket, userId: users.twin });
        // Two groups in common, so neither group's name: the global one.
        expect(twin.username).toBe('Twin everywhere');

        expect(toldShared(basket).sort()).toEqual(
          [users.friend, users.twin].sort()
        );
      });

      it('refuses the whole run for somebody who is not a contact, and writes no basket', async () => {
        const key = randomUUID();
        for (const outsider of [users.stranger, users.pending, users.owner]) {
          await expect(
            generated.create({
              userId: users.owner,
              sources: [{ zoneId: ids.home }],
              memberUserIds: [users.friend, outsider],
              idempotencyKey: key,
            })
          ).rejects.toBeInstanceOf(ValidationException);
        }
        expect(
          await dataSource
            .getRepository(GeneratedList)
            .count({ where: { ownerUserId: users.owner, idempotencyKey: key } })
        ).toBe(0);
        expect(events.emitToUsers).not.toHaveBeenCalled();
      });
    });

    describe('adding people afterwards (sections 4 and 5)', () => {
      it('turns a person who came by the link into an added member, whom revoking the link leaves live', async () => {
        const basket = await newBasket();
        const link = await sharing.ensureLink({
          userId: users.owner,
          generatedListId: basket,
        });
        const friend = await sharing.join({
          secret: link.secret,
          userId: users.friend,
          username: 'Friend everywhere',
        });
        const guest = await sharing.join({ secret: link.secret });
        expect(friend.participant.shareLinkId).toBe(link.id);
        // A registered join by the link shares the basket with them too.
        expect(toldShared(basket)).toEqual([users.friend]);
        jest.clearAllMocks();

        const added = await add(basket, users.friend);
        expect(added.id).toBe(friend.participant.id);
        expect(added.shareLinkId).toBeNull();
        expect((await row(added.id)).invitedAt).toBeInstanceOf(Date);
        // They were live already, so nobody is told a basket became theirs.
        expect(events.emitToUsers).not.toHaveBeenCalled();
        expect(
          roomHeard(RealtimeEvent.GeneratedListParticipantJoined, basket)
        ).toEqual([]);

        const revoked = await sharing.revokeLink({
          userId: users.owner,
          generatedListId: basket,
          revokeParticipants: true,
        });
        expect(revoked.revoked).toBe(1);
        expect((await row(friend.participant.id)).revokedAt).toBeNull();
        expect(await row(guest.participant.id)).toMatchObject({
          endedReason: ParticipantEndedReason.LINK_REVOKED,
        });
      });

      it('brings a removed person back on the row they had', async () => {
        const basket = await newBasket();
        const first = await add(basket, users.friend);
        await sharing.revokeParticipant({
          userId: users.owner,
          generatedListId: basket,
          participantId: first.id,
        });
        expect(await row(first.id)).toMatchObject({
          endedReason: ParticipantEndedReason.REMOVED,
        });
        expect(toldUnshared(basket)).toEqual([users.friend]);
        jest.clearAllMocks();

        const again = await add(basket, users.friend);
        expect(again.id).toBe(first.id);
        const back = await row(first.id);
        expect(back).toMatchObject({
          revokedAt: null,
          endedReason: null,
          shareLinkId: null,
          invitedByUserId: users.owner,
        });
        expect(toldShared(basket)).toEqual([users.friend]);
        expect(
          roomHeard(RealtimeEvent.GeneratedListParticipantJoined, basket)
        ).toEqual([expect.objectContaining({ id: first.id })]);
      });

      it('refuses a person who is not a contact, and is not found for anybody but the owner', async () => {
        const basket = await newBasket();
        await expect(add(basket, users.stranger)).rejects.toBeInstanceOf(
          ValidationException
        );
        await expect(
          sharing.addParticipant({
            userId: users.friend,
            generatedListId: basket,
            memberUserId: users.twin,
          })
        ).rejects.toMatchObject({ code: 'not_found' });
      });
    });

    describe('the link after an ending (section 7)', () => {
      it('refuses a person the owner removed', async () => {
        const basket = await newBasket();
        const link = await sharing.ensureLink({
          userId: users.owner,
          generatedListId: basket,
        });
        const joined = await sharing.join({
          secret: link.secret,
          userId: users.friend,
        });
        await sharing.revokeParticipant({
          userId: users.owner,
          generatedListId: basket,
          participantId: joined.participant.id,
        });

        await expect(
          sharing.join({ secret: link.secret, userId: users.friend })
        ).rejects.toBeInstanceOf(NotAParticipantException);
      });

      it('refuses a person whose link was revoked with its people, even through the next link', async () => {
        const basket = await newBasket();
        const first = await sharing.ensureLink({
          userId: users.owner,
          generatedListId: basket,
        });
        await sharing.join({ secret: first.secret, userId: users.friend });
        await sharing.revokeLink({
          userId: users.owner,
          generatedListId: basket,
          revokeParticipants: true,
        });
        expect(toldUnshared(basket)).toEqual([users.friend]);

        const next = await sharing.ensureLink({
          userId: users.owner,
          generatedListId: basket,
        });
        expect(next.id).not.toBe(first.id);
        await expect(
          sharing.join({ secret: next.secret, userId: users.friend })
        ).rejects.toBeInstanceOf(NotAParticipantException);
      });

      it('brings back a person who left, and the link holds them again', async () => {
        const basket = await newBasket();
        const link = await sharing.ensureLink({
          userId: users.owner,
          generatedListId: basket,
        });
        // Added rather than joined, so coming back by the link visibly moves them
        // from the owner's invitation to the link.
        const added = await add(basket, users.friend);
        await sharing.leave({
          generatedListId: basket,
          participantId: added.id,
        });
        jest.clearAllMocks();

        const back = await sharing.join({
          secret: link.secret,
          userId: users.friend,
        });
        expect(back.participant.id).toBe(added.id);
        expect(await row(added.id)).toMatchObject({
          revokedAt: null,
          endedReason: null,
          shareLinkId: link.id,
          invitedAt: null,
          invitedByUserId: null,
        });
        expect(toldShared(basket)).toEqual([users.friend]);
        expect(
          roomHeard(RealtimeEvent.GeneratedListParticipantJoined, basket)
        ).toHaveLength(1);
      });
    });

    describe('leaving (section 6)', () => {
      it('ends a registered participant with LEFT, and tells the room and the person', async () => {
        const basket = await newBasket();
        const added = await add(basket, users.friend);
        jest.clearAllMocks();

        await expect(
          sharing.leave({ generatedListId: basket, participantId: added.id })
        ).resolves.toEqual({ id: added.id });

        const left = await row(added.id);
        expect(left.endedReason).toBe(ParticipantEndedReason.LEFT);
        expect(left.revokedAt).toBeInstanceOf(Date);
        expect(
          roomHeard(RealtimeEvent.GeneratedListParticipantLeft, basket)
        ).toEqual([expect.objectContaining({ id: added.id })]);
        expect(toldUnshared(basket)).toEqual([users.friend]);
      });

      it('refuses a guest with forbidden and the owner with a validation failure', async () => {
        const basket = await newBasket();
        const link = await sharing.ensureLink({
          userId: users.owner,
          generatedListId: basket,
        });
        const guest = await sharing.join({ secret: link.secret });
        const owner = await dataSource
          .getRepository(GeneratedListParticipant)
          .findOneByOrFail({
            generatedListId: basket,
            kind: ParticipantKind.OWNER,
          });

        await expect(
          sharing.leave({
            generatedListId: basket,
            participantId: guest.participant.id,
          })
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
          sharing.leave({ generatedListId: basket, participantId: owner.id })
        ).rejects.toBeInstanceOf(ValidationException);
        expect((await row(guest.participant.id)).revokedAt).toBeNull();
        expect((await row(owner.id)).revokedAt).toBeNull();
      });
    });

    describe('the baskets shared with you (section 8)', () => {
      it('lists live registered rows newest share first, finished included, archived and left not, a page at a time', async () => {
        const participants = dataSource.getRepository(GeneratedListParticipant);

        const invited = await newBasket({ name: 'Invited' });
        const invitedRow = await add(invited, users.reader);
        await participants.update(
          { id: invitedRow.id },
          { invitedAt: new Date('2026-01-03T10:00:00.123456Z') }
        );

        const byLink = await newBasket({ name: 'By link' });
        const link = await sharing.ensureLink({
          userId: users.owner,
          generatedListId: byLink,
        });
        const linkRow = await sharing.join({
          secret: link.secret,
          userId: users.reader,
        });
        await participants.update(
          { id: linkRow.participant.id },
          { joinedAt: new Date('2026-01-02T10:00:00.654321Z') }
        );

        const finished = await newBasket({
          name: 'Finished',
          status: GeneratedListStatus.COMPLETED,
        });
        const finishedRow = await add(finished, users.reader);
        await participants.update(
          { id: finishedRow.id },
          { invitedAt: new Date('2026-01-01T10:00:00.000001Z') }
        );

        const archived = await newBasket({
          name: 'Archived',
          status: GeneratedListStatus.ARCHIVED,
        });
        await add(archived, users.reader);

        const left = await newBasket({ name: 'Left' });
        const leftRow = await add(left, users.reader);
        await sharing.leave({
          generatedListId: left,
          participantId: leftRow.id,
        });

        const first = await generated.listShared({
          userId: users.reader,
          limit: 2,
        });
        expect(first.items.map((item) => item.id)).toEqual([invited, byLink]);
        expect(first.items[0]).toMatchObject({
          name: 'Invited',
          ownerUserId: users.owner,
          // One group in common, so the owner by the name that group knows them.
          ownerZoneUsername: 'Owner at home',
          sharedAt: '2026-01-03T10:00:00.123Z',
        });
        expect(first.items[1].sharedAt).toBe('2026-01-02T10:00:00.654Z');
        expect(first.nextCursor).not.toBeNull();

        // The boundary row's key carries microseconds a cursor could not, and
        // the second page must neither repeat it nor skip the next row.
        const second = await generated.listShared({
          userId: users.reader,
          limit: 2,
          cursor: first.nextCursor ?? undefined,
        });
        expect(second.items.map((item) => item.id)).toEqual([finished]);
        expect(second.nextCursor).toBeNull();
      });

      it('leaves the owner for the gateway to name when the two people share several groups', async () => {
        const basket = await newBasket({ name: 'Two groups' });
        await add(basket, users.duo);

        const page = await generated.listShared({ userId: users.duo });
        expect(page.items).toEqual([
          expect.objectContaining({
            id: basket,
            ownerUserId: users.owner,
            ownerZoneUsername: null,
          }),
        ]);
      });

      it('refuses a cursor it did not mint', async () => {
        await expect(
          generated.listShared({ userId: users.reader, cursor: 'nonsense' })
        ).rejects.toBeInstanceOf(ValidationException);
      });
    });

    describe('deleting a shared basket (section 10)', () => {
      it('tells the basket room and every person on it, and names the basket for the sweep', async () => {
        const run = await generated.create({
          userId: users.owner,
          sources: [{ zoneId: ids.home }],
          memberUserIds: [users.friend],
        });
        const basket = run.list.id;
        jest.clearAllMocks();

        await generated.delete({
          userId: users.owner,
          generatedListId: basket,
        });

        expect(events.emitTo).toHaveBeenCalledWith(
          RealtimeEvent.GeneratedListDeleted,
          { userIds: [users.owner], generatedListId: basket },
          { id: basket }
        );
        expect(toldUnshared(basket)).toEqual([users.friend]);
      });
    });

    describe('the basket read (section 11)', () => {
      it("gives a guest nobody's join time or last seen, and gives the owner everybody's", async () => {
        const basket = await newBasket();
        const link = await sharing.ensureLink({
          userId: users.owner,
          generatedListId: basket,
        });
        const guest = await sharing.join({ secret: link.secret });
        await add(basket, users.friend);
        const owner = await dataSource
          .getRepository(GeneratedListParticipant)
          .findOneByOrFail({
            generatedListId: basket,
            kind: ParticipantKind.OWNER,
          });

        const asGuest = await baskets.getBasket({
          generatedListId: basket,
          participantId: guest.participant.id,
        });
        expect(asGuest.participants).toHaveLength(3);
        for (const person of [...asGuest.participants, asGuest.me]) {
          expect(person).not.toHaveProperty('joinedAt');
          expect(person).not.toHaveProperty('lastSeenAt');
          expect(person).not.toHaveProperty('userAgent');
        }

        const asOwner = await baskets.getBasket({
          generatedListId: basket,
          participantId: owner.id,
        });
        for (const person of asOwner.participants) {
          expect(person.joinedAt).toEqual(expect.any(String));
          expect(person.lastSeenAt).toEqual(expect.any(String));
        }
      });

      it('names only the source lists the basket has an origin in', async () => {
        const basket = await newBasket({
          sourceSnapshot: {
            profileId: null,
            pricingProfileId: null,
            sources: [
              { zoneId: ids.home, listId: ids.weekly },
              { zoneId: ids.home, listId: ids.unused },
            ],
          },
        });
        const zoneLines = dataSource.getRepository(ListLine);
        const zoneLine = await zoneLines.save(
          zoneLines.create({
            listId: ids.weekly,
            content: 'Milk',
            quantity: 1,
            position: 1,
            approvalStatus: LineApprovalStatus.APPROVED,
            createdByUserId: users.owner,
            approvedByUserId: users.owner,
            version: 1,
          })
        );
        const lines = dataSource.getRepository(GeneratedListLine);
        const line = await lines.save(
          lines.create({
            generatedListId: basket,
            content: 'Milk',
            quantity: 1,
            settledQuantity: 0,
            itemId: null,
            origin: GeneratedLineOrigin.DERIVED,
            targetListId: null,
            position: 1,
          })
        );
        await dataSource.getRepository(GeneratedListLineOrigin).insert({
          generatedListLineId: line.id,
          zoneId: ids.home,
          listId: ids.weekly,
          lineId: zoneLine.id,
          quantity: 1,
          lineVersion: 1,
        });
        await sharing.ensureLink({
          userId: users.owner,
          generatedListId: basket,
        });
        const owner = await dataSource
          .getRepository(GeneratedListParticipant)
          .findOneByOrFail({
            generatedListId: basket,
            kind: ParticipantKind.OWNER,
          });

        const read = await baskets.getBasket({
          generatedListId: basket,
          participantId: owner.id,
        });
        expect(read.seesZoneData).toBe(true);
        expect(read.sourceNames?.map((source) => source.listId)).toEqual([
          ids.weekly,
        ]);
      });
    });

    describe('two first joins by one person (section 11)', () => {
      it('answers both with the one row', async () => {
        const basket = await newBasket();
        const link = await sharing.ensureLink({
          userId: users.owner,
          generatedListId: basket,
        });

        const [one, two] = await Promise.all([
          sharing.join({ secret: link.secret, userId: users.racer }),
          sharing.join({ secret: link.secret, userId: users.racer }),
        ]);

        expect(one.participant.id).toBe(two.participant.id);
        expect(
          await dataSource
            .getRepository(GeneratedListParticipant)
            .count({ where: { generatedListId: basket, userId: users.racer } })
        ).toBe(1);
        // Became live once, so the room and the person heard it once.
        expect(
          roomHeard(RealtimeEvent.GeneratedListParticipantJoined, basket)
        ).toHaveLength(1);
        expect(toldShared(basket)).toEqual([users.racer]);
      });
    });
  }
);
