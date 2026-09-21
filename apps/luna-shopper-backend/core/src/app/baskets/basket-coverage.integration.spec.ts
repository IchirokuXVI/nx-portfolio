import {
  BasketKind,
  GeneratedListStatus,
  ListPermission,
  MembershipStatus,
  ZoneRole,
  ZoneStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource, QueryFailedError } from 'typeorm';
import {
  BasketSource,
  CORE_ENTITIES,
  GeneratedList,
  ListAccess,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { BasketCoverageService } from './basket-coverage.service';

/**
 * What a basket covers, and what the database says a `LIVE` one is (plan 0133,
 * sections 2 and 5).
 *
 * Every assertion here needs a database. `listsOf` and `coveringBaskets` are raw
 * SQL over four tables and share three predicates word for word, so a fake
 * repository would agree with a predicate being missing from either; and the two
 * `LIVE` rules are a partial unique index and a check constraint, which no
 * service layer can be asked about.
 *
 * The fixture is two zones the owner can write in, one zone they can only read,
 * and baskets seeded per test.
 */
describeIntegration('what a basket covers (real Postgres)', () => {
  let dataSource: DataSource;
  let coverage: BasketCoverageService;

  const ids = {
    owner: randomUUID(),
    stranger: randomUUID(),
    zoneHome: '',
    zoneParents: '',
    zoneReadOnly: '',
    listFlat: '',
    listWeekly: '',
    listParents: '',
    listReadOnly: '',
  };

  async function seedZone(name: string): Promise<string> {
    const zones = dataSource.getRepository(Zone);
    const zone = await zones.save(
      zones.create({
        name,
        joinCode: randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(),
        status: ZoneStatus.ACTIVE,
        ownerUserId: ids.owner,
        config: {},
      })
    );
    return zone.id;
  }

  async function seedMembership(
    zoneId: string,
    userId: string,
    role: ZoneRole
  ): Promise<string> {
    const memberships = dataSource.getRepository(ZoneMembership);
    const row = await memberships.save(
      memberships.create({
        zoneId,
        userId,
        username: role === ZoneRole.OWNER ? 'Owner' : 'Member',
        role,
        status: MembershipStatus.APPROVED,
      })
    );
    return row.id;
  }

  async function seedList(zoneId: string, name: string): Promise<string> {
    const lists = dataSource.getRepository(ShoppingList);
    const list = await lists.save(
      lists.create({ zoneId, name, createdByUserId: ids.owner })
    );
    return list.id;
  }

  /** A basket of the owner's, with the source rows it was asked for. */
  async function seedBasket(options: {
    kind?: BasketKind;
    status?: GeneratedListStatus;
    sources?: { zoneId: string; listId: string | null }[];
    ownerUserId?: string;
  }): Promise<GeneratedList> {
    const baskets = dataSource.getRepository(GeneratedList);
    const kind = options.kind ?? BasketKind.GENERATED;
    const basket = await baskets.save(
      baskets.create({
        ownerUserId: options.ownerUserId ?? ids.owner,
        kind,
        name: kind === BasketKind.LIVE ? null : 'Weekly',
        status: options.status ?? GeneratedListStatus.OPEN,
        generatedAt: new Date(),
        pricingProfileId: null,
        idempotencyKey: null,
      })
    );
    const sources = dataSource.getRepository(BasketSource);
    for (const source of options.sources ?? []) {
      await sources.save(
        sources.create({
          basketId: basket.id,
          zoneId: source.zoneId,
          listId: source.listId,
        })
      );
    }
    return basket;
  }

  /**
   * The owner's one permanent basket.
   *
   * Seeded once and reused, because `uq_generated_lists_live_owner` allows one a
   * person: a helper that made a second would be asserting the constraint by
   * accident every time it ran.
   */
  let live: GeneratedList;

  /** The lists a basket covers, as ids alone, so an assertion reads plainly. */
  const coveredBy = async (basket: GeneratedList): Promise<string[]> =>
    (await coverage.listsOf(basket)).map((row) => row.listId).sort();

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();

    ids.zoneHome = await seedZone('Home');
    ids.zoneParents = await seedZone('Parents');
    ids.zoneReadOnly = await seedZone('Book club');
    await seedMembership(ids.zoneHome, ids.owner, ZoneRole.OWNER);
    await seedMembership(ids.zoneParents, ids.owner, ZoneRole.OWNER);
    const readOnly = await seedMembership(
      ids.zoneReadOnly,
      ids.owner,
      ZoneRole.MEMBER
    );

    ids.listFlat = await seedList(ids.zoneHome, 'Flat');
    ids.listWeekly = await seedList(ids.zoneHome, 'Weekly shop');
    ids.listParents = await seedList(ids.zoneParents, 'Parents');
    ids.listReadOnly = await seedList(ids.zoneReadOnly, 'Book club');

    // A member with `READ` alone, which is what "no list the owner only reads"
    // is: a zone they belong to, holding a list they cannot draw a basket from.
    const grants = dataSource.getRepository(ListAccess);
    await grants.save(
      grants.create({
        listId: ids.listReadOnly,
        membershipId: readOnly,
        permissions: [ListPermission.READ],
      })
    );

    coverage = new BasketCoverageService(
      dataSource.getRepository(GeneratedList)
    );
    live = await seedBasket({ kind: BasketKind.LIVE });
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  describe('listsOf (section 5)', () => {
    it('covers every writable list of the owner for a LIVE basket', async () => {
      expect(await coveredBy(live)).toEqual(
        expect.arrayContaining([ids.listFlat, ids.listWeekly, ids.listParents])
      );
    });

    it('covers no list the owner only reads', async () => {
      expect(await coveredBy(live)).not.toContain(ids.listReadOnly);
    });

    it('follows a list created in a covered zone afterwards', async () => {
      // The whole reason a source is a rule rather than a stored list: a whole
      // zone row is evaluated on every read, so a list added next month is in it
      // with no write to the basket (plan 0130, section 3).
      const basket = await seedBasket({
        sources: [{ zoneId: ids.zoneHome, listId: null }],
      });
      expect(await coveredBy(basket)).toEqual(
        [ids.listFlat, ids.listWeekly].sort()
      );

      const later = await seedList(ids.zoneHome, 'Added later');

      expect(await coveredBy(basket)).toContain(later);
    });

    it('does not follow one when the source named a list', async () => {
      const basket = await seedBasket({
        sources: [{ zoneId: ids.zoneHome, listId: ids.listFlat }],
      });
      expect(await coveredBy(basket)).toEqual([ids.listFlat]);

      await seedList(ids.zoneHome, 'Not in this basket');

      expect(await coveredBy(basket)).toEqual([ids.listFlat]);
    });

    it('drops a list the moment its owner loses WRITE, with no write to the basket', async () => {
      const zone = await seedZone('Borrowed');
      const membership = await seedMembership(zone, ids.owner, ZoneRole.MEMBER);
      const list = await seedList(zone, 'Borrowed list');
      const grants = dataSource.getRepository(ListAccess);
      const grant = await grants.save(
        grants.create({
          listId: list,
          membershipId: membership,
          permissions: [ListPermission.READ, ListPermission.WRITE],
        })
      );
      const basket = await seedBasket({
        sources: [{ zoneId: zone, listId: null }],
      });
      expect(await coveredBy(basket)).toEqual([list]);

      grant.permissions = [ListPermission.READ];
      await grants.save(grant);

      expect(await coveredBy(basket)).toEqual([]);
    });

    it('covers nothing for a basket whose owner is in no zone', async () => {
      const basket = await seedBasket({ ownerUserId: ids.stranger });

      expect(await coveredBy(basket)).toEqual([]);
    });
  });

  describe('coveringBaskets is listsOf read from the other end (section 5)', () => {
    /** Whether this basket is among the ones covering that list. */
    const covers = async (basketId: string, listId: string) =>
      (await coverage.coveringBaskets(listId)).some(
        (row) => row.basketId === basketId
      );

    it('holds a basket exactly when the list is in its coverage, and it is open', async () => {
      const cases = [
        live,
        await seedBasket({ sources: [{ zoneId: ids.zoneHome, listId: null }] }),
        await seedBasket({
          sources: [{ zoneId: ids.zoneHome, listId: ids.listFlat }],
        }),
        await seedBasket({
          sources: [{ zoneId: ids.zoneParents, listId: null }],
        }),
      ];

      for (const basket of cases) {
        const covered = await coveredBy(basket);
        for (const listId of [
          ids.listFlat,
          ids.listWeekly,
          ids.listParents,
          ids.listReadOnly,
        ]) {
          expect(await covers(basket.id, listId)).toBe(
            covered.includes(listId)
          );
        }
      }
    });

    it('leaves out a finished basket and an archived one', async () => {
      const finished = await seedBasket({
        status: GeneratedListStatus.FINISHED,
        sources: [{ zoneId: ids.zoneHome, listId: null }],
      });
      const archived = await seedBasket({
        status: GeneratedListStatus.ARCHIVED,
        sources: [{ zoneId: ids.zoneHome, listId: null }],
      });

      // Both still cover the list: coverage is about what a basket draws from,
      // and only this read asks whether anybody is still shopping it.
      expect(await coveredBy(finished)).toContain(ids.listFlat);
      expect(await covers(finished.id, ids.listFlat)).toBe(false);
      expect(await covers(archived.id, ids.listFlat)).toBe(false);
    });

    it('names the owner beside the basket, for the room plan 0139 addresses', async () => {
      const basket = await seedBasket({
        sources: [{ zoneId: ids.zoneParents, listId: null }],
      });

      const rows = await coverage.coveringBaskets(ids.listParents);

      expect(rows).toContainEqual({
        basketId: basket.id,
        ownerUserId: ids.owner,
      });
    });

    it('holds the LIVE basket of an owner who writes the list', async () => {
      expect(await covers(live.id, ids.listFlat)).toBe(true);
    });

    it('holds nothing for a list its owner only reads', async () => {
      // `WRITABLE_LIST` is the single definition of what a basket may draw
      // from, and `READ` is not it (plan 0051, section 2).
      expect(await covers(live.id, ids.listReadOnly)).toBe(false);
    });

    it('holds a basket whose source names the list, and not one naming another list of the zone', async () => {
      const named = await seedBasket({
        sources: [{ zoneId: ids.zoneHome, listId: ids.listFlat }],
      });

      expect(await covers(named.id, ids.listFlat)).toBe(true);
      expect(await covers(named.id, ids.listWeekly)).toBe(false);
    });

    it('holds a basket whose source names the whole zone', async () => {
      const wholeZone = await seedBasket({
        sources: [{ zoneId: ids.zoneHome, listId: null }],
      });

      expect(await covers(wholeZone.id, ids.listFlat)).toBe(true);
      expect(await covers(wholeZone.id, ids.listWeekly)).toBe(true);
    });

    it('holds nothing for an owner who lost their membership', async () => {
      // A user of this test's own, because a basket belongs to a person rather
      // than to a zone: a shared one would appear in every other test's zone.
      const leaver = randomUUID();
      const zone = await seedZone('Leavers');
      const membership = await seedMembership(zone, leaver, ZoneRole.OWNER);
      const list = await seedList(zone, 'Leavers list');
      const basket = await seedBasket({
        ownerUserId: leaver,
        sources: [{ zoneId: zone, listId: null }],
      });
      expect(await covers(basket.id, list)).toBe(true);

      const memberships = dataSource.getRepository(ZoneMembership);
      await memberships.update(
        { id: membership },
        { status: MembershipStatus.KICKED }
      );

      // Coverage is a rule, so losing the membership takes the list out of the
      // basket with no write to the basket at all.
      expect(await covers(basket.id, list)).toBe(false);
    });
  });

  /**
   * Every open basket of one household (plan 0139, section 5).
   *
   * {@link BasketCoverageService.coveringBaskets} with the list taken out of it,
   * which takes the `WRITE` grant and the source rows with it. So this answers a
   * superset on purpose: it is asked when the coverage itself moved and the sets
   * before and after the write differ.
   */
  describe('basketsOfZoneMembers (section 5)', () => {
    const openIn = async (zoneId: string): Promise<string[]> =>
      (await coverage.basketsOfZoneMembers(zoneId))
        .map((row) => row.basketId)
        .sort();

    // A user per test, because a basket belongs to a person rather than to a
    // zone: every basket a member owns is answered for every zone they are in,
    // so a shared user would leak one test's baskets into the next one's zone.

    it('answers every open basket of an approved member, whatever it draws from', async () => {
      const member = randomUUID();
      const zone = await seedZone('Household');
      await seedMembership(zone, member, ZoneRole.OWNER);
      const drawing = await seedBasket({
        ownerUserId: member,
        sources: [{ zoneId: zone, listId: null }],
      });
      // Names another zone entirely, and is still answered: the question is
      // whose baskets are open, not which of them read this zone today.
      const elsewhere = await seedBasket({
        ownerUserId: member,
        sources: [{ zoneId: ids.zoneHome, listId: null }],
      });

      expect(await openIn(zone)).toEqual([drawing.id, elsewhere.id].sort());
    });

    it('leaves out a finished basket and an archived one', async () => {
      const member = randomUUID();
      const zone = await seedZone('Household with history');
      await seedMembership(zone, member, ZoneRole.OWNER);
      const open = await seedBasket({ ownerUserId: member, sources: [] });
      await seedBasket({
        ownerUserId: member,
        status: GeneratedListStatus.FINISHED,
      });
      await seedBasket({
        ownerUserId: member,
        status: GeneratedListStatus.ARCHIVED,
      });

      expect(await openIn(zone)).toEqual([open.id]);
    });

    it('leaves out the baskets of a member who is not approved', async () => {
      const zone = await seedZone('Household with an applicant');
      await seedMembership(zone, randomUUID(), ZoneRole.OWNER);
      const applicant = randomUUID();
      const memberships = dataSource.getRepository(ZoneMembership);
      await memberships.save(
        memberships.create({
          zoneId: zone,
          userId: applicant,
          username: 'Applicant',
          role: ZoneRole.MEMBER,
          status: MembershipStatus.PENDING,
        })
      );
      const theirs = await seedBasket({ ownerUserId: applicant });

      expect(await openIn(zone)).not.toContain(theirs.id);
    });

    it('answers nothing for a zone with no members at all', async () => {
      expect(await openIn(await seedZone('Empty'))).toEqual([]);
    });
  });

  describe('what a source row is (section 4.1)', () => {
    it('goes with the list it names', async () => {
      const list = await seedList(ids.zoneHome, 'Short lived');
      const basket = await seedBasket({
        sources: [{ zoneId: ids.zoneHome, listId: list }],
      });

      await dataSource.getRepository(ShoppingList).delete({ id: list });

      expect(
        await dataSource
          .getRepository(BasketSource)
          .count({ where: { basketId: basket.id } })
      ).toBe(0);
    });

    it('goes with the zone it names', async () => {
      const zone = await seedZone('Short lived zone');
      await seedMembership(zone, ids.owner, ZoneRole.OWNER);
      const basket = await seedBasket({
        sources: [{ zoneId: zone, listId: null }],
      });

      await dataSource.getRepository(Zone).delete({ id: zone });

      expect(
        await dataSource
          .getRepository(BasketSource)
          .count({ where: { basketId: basket.id } })
      ).toBe(0);
    });

    it('goes with the basket it belongs to', async () => {
      const basket = await seedBasket({
        sources: [{ zoneId: ids.zoneHome, listId: null }],
      });

      await dataSource.getRepository(GeneratedList).delete({ id: basket.id });

      expect(
        await dataSource
          .getRepository(BasketSource)
          .count({ where: { basketId: basket.id } })
      ).toBe(0);
    });
  });

  describe('what the database says a LIVE basket is (section 2)', () => {
    const insert = (columns: Record<string, unknown>) =>
      dataSource.query(
        `INSERT INTO "generated_lists"
           ("ownerUserId", "kind", "name", "status", "generatedAt",
            "idempotencyKey")
         VALUES ($1, $2, $3, $4, now(), $5)`,
        [
          columns.ownerUserId,
          columns.kind,
          columns.name ?? null,
          columns.status,
          columns.idempotencyKey ?? null,
        ]
      );

    it('allows one a person, and refuses a second', async () => {
      const owner = randomUUID();
      await insert({
        ownerUserId: owner,
        kind: BasketKind.LIVE,
        status: GeneratedListStatus.OPEN,
      });

      await expect(
        insert({
          ownerUserId: owner,
          kind: BasketKind.LIVE,
          status: GeneratedListStatus.OPEN,
        })
      ).rejects.toBeInstanceOf(QueryFailedError);

      // The same owner may still have as many trips as they like.
      await expect(
        insert({
          ownerUserId: owner,
          kind: BasketKind.GENERATED,
          name: 'Saturday',
          status: GeneratedListStatus.OPEN,
        })
      ).resolves.toBeDefined();
    });

    it('refuses a named one, a finished one and one a run composed', async () => {
      for (const columns of [
        { name: 'Saturday', status: GeneratedListStatus.OPEN },
        { name: null, status: GeneratedListStatus.FINISHED },
        {
          name: null,
          status: GeneratedListStatus.OPEN,
          idempotencyKey: 'tap-1',
        },
      ]) {
        await expect(
          insert({
            ownerUserId: randomUUID(),
            kind: BasketKind.LIVE,
            ...columns,
          })
        ).rejects.toBeInstanceOf(QueryFailedError);
      }
    });
  });
});
