import {
  GeneratedListStatus,
  ParticipantEndedReason,
  ParticipantKind,
  RealtimeEvent,
} from '@portfolio/luna-shopper/contracts';
import { DomainException } from '@portfolio/luna-shopper/platform';
import { createHash } from 'node:crypto';
import type { DataSource, FindOperator } from 'typeorm';
import { GeneratedListParticipant, GeneratedListShareLink } from '../entities';
import type { ConfigService } from '@nestjs/config';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { GeneratedListMembersService } from './generated-list-members.service';
import { GeneratedListSharingService } from './generated-list-sharing.service';
import { COMMON_GROUPS_SQL } from './generated-list-members.sql';
import {
  NEXT_GUEST_NUMBER_SQL,
  WRITABLE_AMONG_SQL,
} from './generated-list-sharing.sql';

/**
 * Sharing a basket with people who have no account (plan 0051, sections 3, 4
 * and 5), against the plan's own exit criteria in section 12.
 *
 * The repositories are faked in the style `generated-list-run.spec.ts`
 * established, and the reads are matched on the SQL constants themselves rather
 * than on a string, so a rewritten query shows up as an unmocked read rather than
 * as a silently passing test.
 *
 * What a mocked repository **cannot** prove is the pair of partial unique
 * indexes, which is where two of the plan's rules actually live: one live link
 * per basket, and one participant row per registered person. Those are asserted
 * here through the loser path (the write throws, the re-read succeeds) and the
 * constraints themselves live in the migration.
 */

/**
 * The harness's clock, which stands in for the database's (plan 0140).
 *
 * Every expiry in these fakes is computed from it and compared against it, so
 * nothing here depends on the wall clock and a spec cannot pass in the morning
 * and fail in the evening.
 */
const NOW = new Date('2026-06-01T12:00:00.000Z');
const LINK_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** A moment that many hours after {@link NOW}, for seeding and asserting. */
function hours(count: number): Date {
  return new Date(NOW.getTime() + count * 60 * 60 * 1000);
}

const OWNER = 'u-owner';
const OTHER_USER = 'u-someone-else';
const BASKET = 'gl-1';
const LIST_A = 'l-flat';
const LIST_B = 'l-parents';
const ZONE_A = 'z-flat';

interface Harness {
  service: GeneratedListSharingService;
  links: Partial<GeneratedListShareLink>[];
  participants: Partial<GeneratedListParticipant>[];
  /** Basket room events carry the basket, and a person's own carry the user. */
  events: {
    event: RealtimeEvent;
    generatedListId?: string;
    userIds?: string[];
  }[];
}

function hash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function build(
  options: {
    status?: GeneratedListStatus;
    /** Seeded links, newest last. */
    links?: Partial<GeneratedListShareLink>[];
    participants?: Partial<GeneratedListParticipant>[];
    /** Source lists the basket's provenance rows point at. */
    /** userId -> the lists that user may write, at request time. */
    writable?: Record<string, string[]>;
    /** Make the next link insert lose the partial unique index. */
    loseTheLinkRace?: Partial<GeneratedListShareLink>;
    /** userId -> their name in the one group they share with the owner. */
    contacts?: Record<string, string>;
  } = {}
): Harness {
  const links = [...(options.links ?? [])];
  const participants = [...(options.participants ?? [])];
  const events: Harness['events'] = [];
  const writable = options.writable ?? {};

  const list = {
    id: BASKET,
    ownerUserId: OWNER,
    name: 'Saturday',
    status: options.status ?? GeneratedListStatus.OPEN,
    generatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  let nextId = 0;
  const id = (prefix: string) => `${prefix}-${++nextId}`;

  const contacts = options.contacts ?? {};

  const query = async (sql: string, params: unknown[]): Promise<unknown[]> => {
    if (sql === COMMON_GROUPS_SQL) {
      const [, userIds] = params as [string, string[]];
      return userIds
        .filter((userId) => contacts[userId] !== undefined)
        .map((userId) => ({
          userId,
          groupCount: 1,
          username: contacts[userId],
        }));
    }
    if (sql === WRITABLE_AMONG_SQL) {
      const [userId, listIds] = params as [string, string[]];
      const allowed = new Set(writable[userId] ?? []);
      return listIds
        .filter((listId) => allowed.has(listId))
        .map((listId) => ({ listId }));
    }
    if (sql === NEXT_GUEST_NUMBER_SQL) {
      const highest = participants.reduce(
        (max, row) => Math.max(max, row.guestNumber ?? 0),
        0
      );
      return [{ next: String(highest + 1) }];
    }
    if (sql.includes('SELECT now()')) {
      return [{ now: NOW }];
    }
    if (sql.includes('FOR UPDATE')) {
      return [{ id: BASKET }];
    }
    if (sql.includes('INSERT INTO "generated_list_share_links"')) {
      const [generatedListId, secret, createdByParticipantId, ttl] = params as [
        string,
        string,
        string,
        number,
      ];
      if (options.loseTheLinkRace && links.every((link) => link.revokedAt)) {
        // The index refused ours; the winner's row is what the re-read finds.
        links.push(options.loseTheLinkRace);
        throw uniqueViolation();
      }
      // Both moments from one statement, which is the whole reason the insert
      // is raw (plan 0140, section 4).
      const saved = {
        id: id('link'),
        generatedListId,
        secret,
        createdByParticipantId,
        createdAt: NOW,
        expiresAt: new Date(NOW.getTime() + ttl),
        revokedAt: null,
      };
      links.push(saved);
      return [saved];
    }
    if (sql.includes('UPDATE "generated_list_share_links"')) {
      // Freeing the slot an expired link still holds, and the sweep's second
      // statement. Both revoke every unrevoked link they are pointed at.
      for (const link of links) {
        if (!link.revokedAt) {
          link.revokedAt = NOW;
        }
      }
      return [];
    }
    if (sql.includes('UPDATE "generated_list_participants"')) {
      const [rowId, ttl] = params as [string, number];
      const row = participants.find((p) => p.id === rowId);
      if (!row) {
        return [];
      }
      // `GREATEST`, so a second link never shortens somebody's access.
      const asked = new Date(NOW.getTime() + ttl);
      const held = row.expiresAt ?? NOW;
      row.expiresAt = held > asked ? held : asked;
      return [row];
    }
    throw new Error(`unmocked query: ${sql.slice(0, 60)}`);
  };

  const listRepo = {
    query,
    findOne: async ({ where }: { where: Record<string, unknown> }) => {
      if (where['ownerUserId'] && where['ownerUserId'] !== OWNER) {
        return null;
      }
      if (where['id'] && where['id'] !== BASKET) {
        return null;
      }
      return list;
    },
  };

  const matches = (
    row: Partial<Record<string, unknown>>,
    where: Record<string, unknown>
  ): boolean =>
    Object.entries(where).every(([key, value]) => {
      const actual = (row as Record<string, unknown>)[key];
      // A find operator is an object rather than a literal, so it is recognised
      // by shape. Two kinds reach here: `IsNull()`, and the `Raw` that plan
      // 0140 put on both expiry rules. A fake that read the second as the first
      // would call every live visitor expired, which is why the operator's own
      // SQL is what decides.
      if (value && typeof value === 'object' && '@instanceof' in value) {
        const sql = (value as FindOperator<unknown>).getSql?.('X');
        if (sql) {
          if (actual === null || actual === undefined) {
            return sql.includes('X IS NULL');
          }
          return (actual as Date).getTime() > NOW.getTime();
        }
        return actual === null || actual === undefined;
      }
      return actual === value;
    });

  const linkRepo = {
    findOne: async ({ where }: { where: Record<string, unknown> }) =>
      links.find((link) => matches(link, where)) ?? null,
  };

  const participantRepo = {
    findOne: async ({ where }: { where: Record<string, unknown> }) =>
      participants.find((row) => matches(row, where)) ?? null,
    find: async ({ where }: { where: Record<string, unknown> }) =>
      participants.filter((row) => matches(row, where)),
    count: async ({ where }: { where: Record<string, unknown> }) =>
      participants.filter((row) => matches(row, where)).length,
    create: (data: Partial<GeneratedListParticipant>) => ({ ...data }),
    save: async (row: Partial<GeneratedListParticipant>) => {
      const existing = participants.find((p) => p.id && p.id === row.id);
      if (existing) {
        Object.assign(existing, row);
        return existing;
      }
      const saved = { ...row, id: id('p') };
      participants.push(saved);
      return saved;
    },
    update: async (rowId: string, patch: Partial<GeneratedListParticipant>) => {
      const found = participants.find((p) => p.id === rowId);
      if (found) {
        Object.assign(found, patch);
      }
      return { affected: found ? 1 : 0 };
    },
  };

  // The transaction manager dispatches on the entity, because `revokeLink`
  // writes to both tables: the link, and then optionally every participant it
  // minted. A fake that only knew about participants would let the cascade pass
  // while the revoke itself silently did nothing.
  const rowsOf = (entity: unknown): Partial<Record<string, unknown>>[] =>
    entity === GeneratedListShareLink
      ? (links as Partial<Record<string, unknown>>[])
      : (participants as Partial<Record<string, unknown>>[]);

  const manager = {
    query,
    find: async (
      entity: unknown,
      { where }: { where: Record<string, unknown> }
    ) => rowsOf(entity).filter((row) => matches(row, where)),
    count: async (
      entity: unknown,
      { where }: { where: Record<string, unknown> }
    ) => rowsOf(entity).filter((row) => matches(row, where)).length,
    create: (_entity: unknown, data: Partial<GeneratedListParticipant>) => ({
      ...data,
    }),
    findOne: async (
      entity: unknown,
      { where }: { where: Record<string, unknown> }
    ) => rowsOf(entity).find((row) => matches(row, where)) ?? null,
    save: async (row: Partial<GeneratedListParticipant>) => {
      // A row read back and changed is that row rather than a second one, which
      // is what bringing somebody back through the link writes (plan 0114).
      const existing = participants.find((p) => p.id && p.id === row.id);
      if (existing) {
        Object.assign(existing, row);
        return existing;
      }
      const saved = { ...row, id: id('p') };
      participants.push(saved);
      return saved;
    },
    update: async (
      entity: unknown,
      rowId: string,
      patch: Record<string, unknown>
    ) => {
      const found = rowsOf(entity).find((row) => row['id'] === rowId);
      if (found) {
        Object.assign(found, patch);
      }
      return { affected: found ? 1 : 0 };
    },
  };

  const dataSource = {
    transaction: async (fn: (m: typeof manager) => Promise<unknown>) =>
      fn(manager),
    // The pooled manager, which a live visitor's expiry is pushed out through:
    // no transaction is needed for one statement on one row.
    manager,
    // The contact check reads through the data source rather than a repository.
    query,
  } as unknown as DataSource;

  const publisher = {
    // One basket, named on the list the envelope carries since plan 0139.
    emitToBaskets: (event: RealtimeEvent, basketIds: readonly string[]) =>
      events.push({ event, generatedListId: basketIds[0] }),
    // A person's own sessions (plan 0114, section 10).
    emitToUsers: (event: RealtimeEvent, userIds: readonly string[]) =>
      events.push({ event, userIds: [...userIds] }),
  } as unknown as CoreEventsPublisher;

  const configService = {
    getOrThrow: () => ({
      basket: {
        linkTtlMs: LINK_TTL_MS,
        linkSessionTtlMs: SESSION_TTL_MS,
        accessSweep: { enabled: false, intervalMs: 60_000, batchSize: 200 },
      },
    }),
  } as unknown as ConfigService;

  const service = new GeneratedListSharingService(
    dataSource,
    listRepo as never,
    linkRepo as never,
    participantRepo as never,
    new GeneratedListMembersService(dataSource, publisher),
    configService
  );

  return { service, links, participants, events };
}

function uniqueViolation(): Error {
  return Object.assign(new Error('duplicate key'), { code: '23505' });
}

describe('a basket has zero share links or one (section 3)', () => {
  it('mints one on the first share, and hands the same one back on the second', async () => {
    const harness = build();
    const first = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    const second = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });

    expect(second.id).toBe(first.id);
    expect(second.secret).toBe(first.secret);
    expect(harness.links.filter((link) => !link.revokedAt)).toHaveLength(1);
  });

  it('returns the winner when two devices race the unique index', async () => {
    const harness = build({
      loseTheLinkRace: {
        id: 'link-winner',
        secret: 'winner',
        generatedListId: BASKET,
        createdByParticipantId: 'p-owner',
        createdAt: NOW,
        expiresAt: hours(12),
        revokedAt: null,
      },
    });
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    expect(link.id).toBe('link-winner');
  });

  it('serves the secret on every read, so the owner can copy it again', async () => {
    // The deliberate asymmetry with a participant's session secret (section 3.1):
    // an invitation has to be copyable tomorrow, from another device.
    const harness = build();
    const minted = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    const read = await harness.service.getLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    expect(read.link?.secret).toBe(minted.secret);
  });

  it('answers an unshared basket with no link rather than an error', async () => {
    const harness = build();
    await expect(
      harness.service.getLink({ userId: OWNER, generatedListId: BASKET })
    ).resolves.toEqual({});
  });

  it('is not found for somebody else, never forbidden', async () => {
    const harness = build();
    await expect(
      harness.service.ensureLink({
        userId: OTHER_USER,
        generatedListId: BASKET,
      })
    ).rejects.toBeInstanceOf(DomainException);
  });
});

describe('the link preview discloses nothing (section 4, step 1)', () => {
  it('names the basket and counts the people, and says nothing else', async () => {
    const harness = build();
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    const preview = await harness.service.preview({ secret: link.secret });

    expect(preview).toEqual({
      joinable: true,
      name: 'Saturday',
      participantCount: 1,
    });
    // No lines, no zone names, no list names, no member names.
    expect(Object.keys(preview).sort()).toEqual([
      'joinable',
      'name',
      'participantCount',
    ]);
  });

  it('answers a link that never existed exactly as it answers a revoked one', async () => {
    // Sections 3.1 and 4 both hold only if these are indistinguishable.
    const harness = build();
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    await harness.service.revokeLink({
      userId: OWNER,
      generatedListId: BASKET,
    });

    const revoked = await harness.service.preview({ secret: link.secret });
    const fictional = await harness.service.preview({
      secret: 'never-existed',
    });

    expect(revoked).toEqual({ joinable: false });
    expect(fictional).toEqual({ joinable: false });
  });

  it('refuses an expired link the same way', async () => {
    const harness = build({
      links: [
        {
          id: 'link-old',
          generatedListId: BASKET,
          secret: 'expired',
          createdAt: hours(-24),
          expiresAt: hours(-12),
          revokedAt: null,
        },
      ],
    });
    await expect(
      harness.service.preview({ secret: 'expired' })
    ).resolves.toEqual({ joinable: false });
  });

  it('stops accepting people once the basket is finished', async () => {
    // Section 11's leaning: an unauthenticated read of somebody's shopping
    // habits should not outlive the trip.
    const harness = build({
      status: GeneratedListStatus.FINISHED,
      links: [
        {
          id: 'l',
          generatedListId: BASKET,
          secret: 'live',
          createdAt: NOW,
          expiresAt: hours(12),
          revokedAt: null,
        },
      ],
    });
    await expect(harness.service.preview({ secret: 'live' })).resolves.toEqual({
      joinable: false,
    });
  });
});

describe('one link, three people, three participants (section 3)', () => {
  it('mints a participant per join and a session secret per participant', async () => {
    const harness = build();
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });

    const joins = [];
    for (const displayName of ['Dani', 'Dani', undefined]) {
      joins.push(
        await harness.service.join({ secret: link.secret, displayName })
      );
    }

    const ids = new Set(joins.map((join) => join.participant.id));
    expect(ids.size).toBe(3);
    // Two people typed the same name and are still two people: the name is what
    // the screen shows, the id is what the record keeps (section 3.5).
    expect(joins[0].participant.displayName).toBe('Dani');
    expect(joins[1].participant.displayName).toBe('Dani');
    expect(joins[0].participant.id).not.toBe(joins[1].participant.id);
    // Each guest credential is distinct and handed back exactly once.
    expect(new Set(joins.map((join) => join.sessionSecret)).size).toBe(3);
  });

  it('gives a guest who skipped the prompt the next guest number', async () => {
    const harness = build();
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    await harness.service.join({ secret: link.secret, displayName: 'Dani' });
    const skipped = await harness.service.join({ secret: link.secret });

    expect(skipped.participant.displayName).toBeNull();
    expect(skipped.participant.guestNumber).toBe(2);
  });

  it('treats a whitespace name as no name at all', async () => {
    const harness = build();
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    const joined = await harness.service.join({
      secret: link.secret,
      displayName: '   ',
    });
    expect(joined.participant.displayName).toBeNull();
    expect(joined.participant.guestNumber).toBe(1);
  });

  it('stores the guest credential hashed and never returns it again', async () => {
    const harness = build();
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    const joined = await harness.service.join({ secret: link.secret });

    const row = harness.participants.find(
      (p) => p.id === joined.participant.id
    );
    expect(row?.sessionSecretHash).toBe(hash(joined.sessionSecret as string));
    expect(row?.sessionSecretHash).not.toBe(joined.sessionSecret);
  });

  it('announces a join on the basket’s own room', async () => {
    const harness = build();
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    await harness.service.join({ secret: link.secret });

    expect(harness.events).toContainEqual({
      event: RealtimeEvent.GeneratedListParticipantJoined,
      generatedListId: BASKET,
    });
  });
});

describe('a registered person is attached once, however many links (section 4)', () => {
  it('resolves a second join to the row they already have', async () => {
    const harness = build();
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });

    const first = await harness.service.join({
      secret: link.secret,
      userId: OTHER_USER,
    });
    const second = await harness.service.join({
      secret: link.secret,
      userId: OTHER_USER,
    });

    expect(second.participant.id).toBe(first.participant.id);
    expect(first.participant.kind).toBe(ParticipantKind.REGISTERED);
  });

  it('gives them no session secret, because they have a token already', async () => {
    const harness = build();
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    const joined = await harness.service.join({
      secret: link.secret,
      userId: OTHER_USER,
    });
    expect(joined.sessionSecret).toBeNull();
  });

  it('resolves the owner opening their own link to the owner row', async () => {
    const harness = build();
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    const joined = await harness.service.join({
      secret: link.secret,
      userId: OWNER,
    });

    expect(joined.participant.kind).toBe(ParticipantKind.OWNER);
    expect(
      harness.participants.filter((p) => p.kind === ParticipantKind.OWNER)
    ).toHaveLength(1);
  });

  it('refuses somebody who was revoked, rather than letting them rejoin', async () => {
    // Section 3.4's per participant revoke would mean nothing otherwise.
    const harness = build();
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    const joined = await harness.service.join({
      secret: link.secret,
      userId: OTHER_USER,
    });
    await harness.service.revokeParticipant({
      userId: OWNER,
      generatedListId: BASKET,
      participantId: joined.participant.id,
    });

    await expect(
      harness.service.join({ secret: link.secret, userId: OTHER_USER })
    ).rejects.toBeInstanceOf(DomainException);
  });
});

describe('a participant carries the account holder’s name (plan 0054, section 2)', () => {
  it('names the owner on the row sharing mints for them', async () => {
    const harness = build();

    await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
      username: 'Swift Sail',
    });

    const owner = harness.participants.find(
      (row) => row.kind === ParticipantKind.OWNER
    );
    expect(owner?.username).toBe('Swift Sail');
    // The typed name stays empty: the owner never went through a join screen,
    // and the two are different facts rather than one field with two sources.
    expect(owner?.displayName).toBeNull();
  });

  it('backfills an owner row that predates the plan, on the next share', async () => {
    // The same lazy repair plan 0051 chose for the row existing at all: nothing
    // else can supply the name, and this is one of the two calls that carry one.
    const harness = build({
      participants: [
        {
          id: 'p-owner',
          generatedListId: BASKET,
          kind: ParticipantKind.OWNER,
          userId: OWNER,
          displayName: null,
          username: null,
        },
      ],
    });

    await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
      username: 'Swift Sail',
    });

    expect(harness.participants[0].username).toBe('Swift Sail');
  });

  it('names the owner from the participants read as well, unshared basket included', async () => {
    // The share sheet reads this whether or not anybody has pressed share, so an
    // owner who has never minted a link is still named on the screen listing
    // them (section 2.3).
    const harness = build();

    const people = await harness.service.listParticipants({
      generatedListId: BASKET,
      userId: OWNER,
      username: 'Swift Sail',
    });

    expect(people.participants).toHaveLength(1);
    expect(people.participants[0].username).toBe('Swift Sail');
  });

  it('names a signed in joiner, who never sees the name prompt', async () => {
    const harness = build();
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });

    const joined = await harness.service.join({
      secret: link.secret,
      userId: OTHER_USER,
      username: 'Quiet Lantern',
    });

    expect(joined.participant.username).toBe('Quiet Lantern');
    // Plan 0044 section 3 takes them through the screen without asking, so the
    // typed name is null and the client has something to draw all the same.
    expect(joined.participant.displayName).toBeNull();
  });

  it('keeps a typed name beside the account name when they typed one', async () => {
    // Section 2.4: a signed in participant may still type a name, and if they do
    // it wins, because they said it on purpose.
    const harness = build();
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });

    const joined = await harness.service.join({
      secret: link.secret,
      userId: OTHER_USER,
      username: 'Quiet Lantern',
      displayName: 'Dani',
    });

    expect(joined.participant.displayName).toBe('Dani');
    expect(joined.participant.username).toBe('Quiet Lantern');
  });

  it('never puts one on a guest, whatever the message said', async () => {
    // There is no account behind them for it to be the name of, and a username
    // on a guest row would make an unverified name look like a verified one.
    const harness = build();
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });

    const joined = await harness.service.join({
      secret: link.secret,
      username: 'Quiet Lantern',
      displayName: 'Dani',
    });

    expect(joined.participant.kind).toBe(ParticipantKind.GUEST);
    expect(joined.participant.username).toBeNull();
  });

  it('does not rename anybody retroactively', async () => {
    // Section 2.4. A username is a snapshot taken at join time, as a zone
    // membership's is, so somebody who renames their account keeps the old name
    // on baskets they have already joined.
    const harness = build();
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    await harness.service.join({
      secret: link.secret,
      userId: OTHER_USER,
      username: 'Quiet Lantern',
    });

    const again = await harness.service.join({
      secret: link.secret,
      userId: OTHER_USER,
      username: 'Renamed Since',
    });

    expect(again.participant.username).toBe('Quiet Lantern');
  });
});

describe('the three revoke levels (section 3.4)', () => {
  async function shared() {
    const harness = build();
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    const one = await harness.service.join({ secret: link.secret });
    const two = await harness.service.join({ secret: link.secret });
    return { harness, link, one, two };
  }

  it('revoking the link stops new joins and evicts nobody', async () => {
    const { harness, link, one } = await shared();
    await harness.service.revokeLink({
      userId: OWNER,
      generatedListId: BASKET,
    });

    await expect(
      harness.service.join({ secret: link.secret })
    ).rejects.toBeInstanceOf(DomainException);
    // The people already in the shop keep working: their session authorizes
    // them, and the link was only an invitation they already accepted.
    await expect(
      harness.service.resolveParticipant({
        generatedListId: BASKET,
        sessionSecret: one.sessionSecret as string,
      })
    ).resolves.toMatchObject({ participantId: one.participant.id });
  });

  it('revoking with the cascade removes everybody that link let in', async () => {
    const { harness, one, two } = await shared();
    const result = await harness.service.revokeLink({
      userId: OWNER,
      generatedListId: BASKET,
      revokeParticipants: true,
    });

    expect(result.revoked).toBe(2);
    for (const joined of [one, two]) {
      await expect(
        harness.service.resolveParticipant({
          generatedListId: BASKET,
          sessionSecret: joined.sessionSecret as string,
        })
      ).rejects.toBeInstanceOf(DomainException);
    }
  });

  it('the cascade leaves the owner, who never arrived by a link', async () => {
    const { harness } = await shared();
    await harness.service.revokeLink({
      userId: OWNER,
      generatedListId: BASKET,
      revokeParticipants: true,
    });

    await expect(
      harness.service.resolveParticipant({
        generatedListId: BASKET,
        userId: OWNER,
      })
    ).resolves.toMatchObject({ kind: ParticipantKind.OWNER });
  });

  it('revoking one participant touches nobody else', async () => {
    const { harness, one, two } = await shared();
    await harness.service.revokeParticipant({
      userId: OWNER,
      generatedListId: BASKET,
      participantId: one.participant.id,
    });

    await expect(
      harness.service.resolveParticipant({
        generatedListId: BASKET,
        sessionSecret: one.sessionSecret as string,
      })
    ).rejects.toBeInstanceOf(DomainException);
    await expect(
      harness.service.resolveParticipant({
        generatedListId: BASKET,
        sessionSecret: two.sessionSecret as string,
      })
    ).resolves.toMatchObject({ participantId: two.participant.id });
  });

  it('refuses to revoke the owner, which would be incoherent', async () => {
    const { harness } = await shared();
    const owner = harness.participants.find(
      (p) => p.kind === ParticipantKind.OWNER
    );
    await expect(
      harness.service.revokeParticipant({
        userId: OWNER,
        generatedListId: BASKET,
        participantId: owner?.id as string,
      })
    ).rejects.toBeInstanceOf(DomainException);
  });

  it('sharing again after a revoke mints a fresh link', async () => {
    const { harness, link } = await shared();
    await harness.service.revokeLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    const fresh = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });

    expect(fresh.secret).not.toBe(link.secret);
    expect(harness.links.filter((row) => !row.revokedAt)).toHaveLength(1);
  });
});

describe('a revoked participant is refused with no cache to wait out (section 3.3)', () => {
  it('refuses a credential for a different basket', async () => {
    const harness = build();
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    const joined = await harness.service.join({ secret: link.secret });

    await expect(
      harness.service.resolveParticipant({
        generatedListId: 'gl-somebody-elses',
        sessionSecret: joined.sessionSecret as string,
      })
    ).rejects.toBeInstanceOf(DomainException);
  });

  it('refuses a request presenting no credential at all', async () => {
    const harness = build();
    await expect(
      harness.service.resolveParticipant({ generatedListId: BASKET })
    ).rejects.toBeInstanceOf(DomainException);
  });
});

describe('what a participant may see (plan 0136, section 3.4)', () => {
  const sources = [
    { listId: LIST_A, zoneId: ZONE_A },
    { listId: LIST_B, zoneId: ZONE_A },
  ];

  /**
   * `seesZoneData` is deleted, and these four tests are the reversal of the four
   * that asserted it.
   *
   * It was all or nothing over **every** source list of the run, and a `LIVE`
   * basket covers every list its owner can write, so "every source list" stopped
   * being a set a second reader could be measured against. What replaces it is
   * per list and is answered by {@link GeneratedListSharingService.writableAmong},
   * which the basket read asks of the coverage: a reader is told which list a row
   * belongs to for exactly the covered lists they write themselves.
   */

  it('answers a guest no flag at all, because the question is per list now', async () => {
    const harness = build({ writable: {} });
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    const guest = await harness.service.join({ secret: link.secret });

    const context = await harness.service.resolveParticipant({
      generatedListId: BASKET,
      sessionSecret: guest.sessionSecret as string,
    });
    expect(context).not.toHaveProperty('seesZoneData');
    // A guest holds no account, so no list is served to them by name. The rows
    // themselves still are.
    expect(await harness.service.writableAmong('', [LIST_A, LIST_B])).toEqual(
      new Set()
    );
  });

  it('answers the owner no flag either, writing every covered list by construction', async () => {
    const harness = build({
      writable: { [OWNER]: [LIST_A, LIST_B] },
    });
    await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });

    const context = await harness.service.resolveParticipant({
      generatedListId: BASKET,
      userId: OWNER,
    });
    expect(context).not.toHaveProperty('seesZoneData');
    // Covered means the owner writes it, so the owner is served all of them.
    expect(
      await harness.service.writableAmong(OWNER, [LIST_A, LIST_B])
    ).toEqual(new Set([LIST_A, LIST_B]));
  });

  it('serves a registered reader every covered list they write themselves', async () => {
    const harness = build({
      writable: { [OTHER_USER]: [LIST_A, LIST_B] },
    });
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    await harness.service.join({ secret: link.secret, userId: OTHER_USER });

    const context = await harness.service.resolveParticipant({
      generatedListId: BASKET,
      userId: OTHER_USER,
    });
    expect(context).not.toHaveProperty('seesZoneData');
    expect(
      await harness.service.writableAmong(OTHER_USER, [LIST_A, LIST_B])
    ).toEqual(new Set([LIST_A, LIST_B]));
  });

  it('keeps the list it does not collapse, which is the cliff this replaced', async () => {
    // The reversal. One list where the reader holds only `READ` used to collapse
    // the whole view, and the old test asserted that cliff as accepted because it
    // failed in the safe direction. Per list, there is no cliff to accept: the
    // list they write is named and the other one is not, on the same read.
    const harness = build({
      writable: { [OTHER_USER]: [LIST_A] },
    });
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    await harness.service.join({ secret: link.secret, userId: OTHER_USER });

    const context = await harness.service.resolveParticipant({
      generatedListId: BASKET,
      userId: OTHER_USER,
    });
    expect(context).not.toHaveProperty('seesZoneData');
    expect(
      await harness.service.writableAmong(OTHER_USER, [LIST_A, LIST_B])
    ).toEqual(new Set([LIST_A]));
  });
});

describe('the device string is not presence data (section 7)', () => {
  // Who may see it is `kind === OWNER || invitedAt !== null` since plan 0136
  // section 3.4 deleted `seesZoneData`, and for the reason that flag could not
  // answer: when somebody arrived and what device they are on is a fact about
  // **them** rather than about any list, so no list's permissions decide it.
  it('shows it to the owner and hides it from a link visitor', async () => {
    const harness = build({ writable: {} });
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    const guest = await harness.service.join({
      secret: link.secret,
      userAgent: 'Pixel 8',
    });

    const owner = harness.participants.find(
      (p) => p.kind === ParticipantKind.OWNER
    );
    const asOwner = await harness.service.listParticipants({
      generatedListId: BASKET,
      asParticipantId: owner?.id as string,
    });
    const asGuest = await harness.service.listParticipants({
      generatedListId: BASKET,
      asParticipantId: guest.participant.id,
    });

    expect(
      asOwner.participants.find((p) => p.id === guest.participant.id)?.userAgent
    ).toBe('Pixel 8');
    // Absent rather than null: "you may not see this" and "there is nothing to
    // see" stay distinguishable.
    expect(
      asGuest.participants.find((p) => p.id === guest.participant.id)
    ).not.toHaveProperty('userAgent');
  });

  it('shows it to somebody the owner named and hides it from a registered link visitor', async () => {
    // The other half of plan 0136 section 3.4's rule, and the half no list's
    // permissions could ever have answered: both of these people hold an
    // account, and only one of them was invited by the owner.
    const named = {
      id: 'p-named',
      generatedListId: BASKET,
      kind: ParticipantKind.REGISTERED,
      userId: OTHER_USER,
      displayName: null,
      username: 'friend',
      guestNumber: null,
      shareLinkId: null,
      revokedAt: null,
      invitedAt: new Date('2026-01-01T00:00:00.000Z'),
      joinedAt: new Date('2026-01-01T00:00:00.000Z'),
      lastSeenAt: new Date('2026-01-01T00:00:00.000Z'),
      userAgent: 'Pixel 8',
    };
    const harness = build({ participants: [named] });
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    const visitor = await harness.service.join({
      secret: link.secret,
      userId: 'u-third',
      userAgent: 'iPhone',
    });

    const asNamed = await harness.service.listParticipants({
      generatedListId: BASKET,
      asParticipantId: named.id,
    });
    const asVisitor = await harness.service.listParticipants({
      generatedListId: BASKET,
      asParticipantId: visitor.participant.id,
    });

    expect(
      asNamed.participants.find((p) => p.id === visitor.participant.id)
        ?.userAgent
    ).toBe('iPhone');
    // Registered, and still a link visitor: an account is not an invitation.
    expect(
      asVisitor.participants.find((p) => p.id === named.id)
    ).not.toHaveProperty('userAgent');
  });

  it('never serves a session secret hash in a participant view', async () => {
    const harness = build();
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    await harness.service.join({ secret: link.secret });

    const people = await harness.service.listParticipants({
      generatedListId: BASKET,
    });
    for (const person of people.participants) {
      expect(person).not.toHaveProperty('sessionSecretHash');
    }
  });
});

describe('a link lasts twelve hours (plan 0140, section 4)', () => {
  it('mints one that ends twelve hours after it was created', async () => {
    const harness = build();
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });

    expect(link.createdAt).toBe(NOW.toISOString());
    expect(link.expiresAt).toBe(hours(12).toISOString());
  });

  it('answers no link at all once that link expired', async () => {
    // The state the share sheet draws "Share" in, and the reason it can: an
    // expired link is not a link to anybody who reads.
    const harness = build({
      links: [
        {
          id: 'link-old',
          generatedListId: BASKET,
          secret: 'expired',
          createdAt: hours(-24),
          expiresAt: hours(-12),
          revokedAt: null,
        },
      ],
    });
    await expect(
      harness.service.getLink({ userId: OWNER, generatedListId: BASKET })
    ).resolves.toEqual({});
  });

  it('revokes the expired link and mints another when share is pressed again', async () => {
    // The partial unique index cannot read a clock, so the slot an expired link
    // still holds is freed by a write. Without it, pressing share would hand
    // back a dead link.
    const harness = build({
      links: [
        {
          id: 'link-old',
          generatedListId: BASKET,
          secret: 'expired',
          createdAt: hours(-24),
          expiresAt: hours(-12),
          revokedAt: null,
        },
      ],
    });
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });

    expect(link.id).not.toBe('link-old');
    expect(link.expiresAt).toBe(hours(12).toISOString());
    expect(harness.links.find((l) => l.id === 'link-old')?.revokedAt).toEqual(
      NOW
    );
    expect(harness.links.filter((l) => !l.revokedAt)).toHaveLength(1);
  });

  it('never cascades to the people that expired link let in', async () => {
    // They carry their own expiry. Revoking a link with its people is still the
    // owner's gesture, and this is not it.
    const harness = build({
      links: [
        {
          id: 'link-old',
          generatedListId: BASKET,
          secret: 'expired',
          createdAt: hours(-24),
          expiresAt: hours(-12),
          revokedAt: null,
        },
      ],
      participants: [
        {
          id: 'p-guest',
          generatedListId: BASKET,
          kind: ParticipantKind.GUEST,
          shareLinkId: 'link-old',
          guestNumber: 1,
          expiresAt: hours(4),
          revokedAt: null,
        },
      ],
    });
    await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });

    const guest = harness.participants.find((p) => p.id === 'p-guest');
    expect(guest?.revokedAt).toBeFalsy();
    expect(guest?.expiresAt).toEqual(hours(4));
  });

  it('refuses a join through an expired link exactly as through an unknown one', async () => {
    const harness = build({
      links: [
        {
          id: 'link-old',
          generatedListId: BASKET,
          secret: 'expired',
          createdAt: hours(-24),
          expiresAt: hours(-12),
          revokedAt: null,
        },
      ],
    });
    await expect(
      harness.service.join({ secret: 'expired' })
    ).rejects.toBeInstanceOf(DomainException);
    await expect(
      harness.service.join({ secret: 'never-existed' })
    ).rejects.toBeInstanceOf(DomainException);
  });
});

describe('the people a link lets in (plan 0140, section 5)', () => {
  it('gives a guest twelve hours from their own join', async () => {
    const harness = build();
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    const joined = await harness.service.join({ secret: link.secret });

    expect(joined.participant.expiresAt).toBe(hours(12).toISOString());
  });

  it('gives a signed in visitor the same twelve hours, and no session secret', async () => {
    // "Never binds to an account" does not mean "writes no row": every
    // attribution in core is a participant. The row ends by itself instead.
    const harness = build();
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    const joined = await harness.service.join({
      secret: link.secret,
      userId: OTHER_USER,
    });

    expect(joined.participant.expiresAt).toBe(hours(12).toISOString());
    expect(joined.sessionSecret).toBeNull();
  });

  it('gives the owner opening their own link no expiry at all', async () => {
    const harness = build();
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    const joined = await harness.service.join({
      secret: link.secret,
      userId: OWNER,
    });

    expect(joined.participant.kind).toBe(ParticipantKind.OWNER);
    expect(joined.participant.expiresAt).toBeNull();
  });

  it('brings a visitor whose access expired back under the same participant id', async () => {
    // Nobody refused them, so the link may undo it, and the id has to be the
    // same one or everything they already bought is attributed to a stranger.
    const harness = build({
      participants: [
        {
          id: 'p-back',
          generatedListId: BASKET,
          kind: ParticipantKind.REGISTERED,
          userId: OTHER_USER,
          shareLinkId: 'link-old',
          expiresAt: hours(-1),
          revokedAt: hours(-1),
          endedReason: ParticipantEndedReason.EXPIRED,
        },
      ],
    });
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    const joined = await harness.service.join({
      secret: link.secret,
      userId: OTHER_USER,
    });

    expect(joined.participant.id).toBe('p-back');
    expect(joined.participant.expiresAt).toBe(hours(12).toISOString());
    expect(
      harness.participants.find((p) => p.id === 'p-back')?.revokedAt
    ).toBeNull();
  });

  it('brings back one whose expiry passed before the sweep reached them', async () => {
    const harness = build({
      participants: [
        {
          id: 'p-unswept',
          generatedListId: BASKET,
          kind: ParticipantKind.REGISTERED,
          userId: OTHER_USER,
          shareLinkId: 'link-old',
          expiresAt: hours(-1),
          revokedAt: null,
          endedReason: null,
        },
      ],
    });
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    const joined = await harness.service.join({
      secret: link.secret,
      userId: OTHER_USER,
    });

    expect(joined.participant.id).toBe('p-unswept');
    expect(joined.participant.expiresAt).toBe(hours(12).toISOString());
  });

  it('still refuses somebody the owner removed', async () => {
    const harness = build({
      participants: [
        {
          id: 'p-out',
          generatedListId: BASKET,
          kind: ParticipantKind.REGISTERED,
          userId: OTHER_USER,
          expiresAt: hours(-1),
          revokedAt: hours(-2),
          endedReason: ParticipantEndedReason.REMOVED,
        },
      ],
    });
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    await expect(
      harness.service.join({ secret: link.secret, userId: OTHER_USER })
    ).rejects.toBeInstanceOf(DomainException);
  });

  it('never shortens a live visitor’s access when they open a second link', async () => {
    const harness = build({
      participants: [
        {
          id: 'p-long',
          generatedListId: BASKET,
          kind: ParticipantKind.REGISTERED,
          userId: OTHER_USER,
          shareLinkId: 'link-old',
          expiresAt: hours(20),
          revokedAt: null,
        },
      ],
    });
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    const joined = await harness.service.join({
      secret: link.secret,
      userId: OTHER_USER,
    });

    // The window they already hold is longer, and a shorter one cannot take it
    // back: `GREATEST`, not an assignment.
    expect(joined.participant.expiresAt).toBe(hours(20).toISOString());
  });

  it('never turns a named person into a visitor', async () => {
    const harness = build({
      participants: [
        {
          id: 'p-named',
          generatedListId: BASKET,
          kind: ParticipantKind.REGISTERED,
          userId: OTHER_USER,
          shareLinkId: null,
          invitedAt: hours(-40),
          invitedByUserId: OWNER,
          expiresAt: null,
          revokedAt: null,
        },
      ],
    });
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    const joined = await harness.service.join({
      secret: link.secret,
      userId: OTHER_USER,
    });

    expect(joined.participant.expiresAt).toBeNull();
    expect(joined.participant.shareLinkId).toBeNull();
  });

  it('stops counting an expired visitor toward the room at their expiry', async () => {
    // Not at the next sweep. The seat is free when the access is.
    const harness = build({
      participants: [
        {
          id: 'p-gone',
          generatedListId: BASKET,
          kind: ParticipantKind.GUEST,
          guestNumber: 1,
          expiresAt: hours(-1),
          revokedAt: null,
        },
      ],
    });
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    const preview = await harness.service.preview({ secret: link.secret });

    // The owner's row alone. The expired guest counts for nothing.
    expect(preview.participantCount).toBe(1);
  });
});

describe('keeping somebody by adding them (plan 0140, section 6)', () => {
  const liveVisitor = () => ({
    id: 'p-visitor',
    generatedListId: BASKET,
    kind: ParticipantKind.REGISTERED,
    userId: OTHER_USER,
    shareLinkId: 'link-1',
    username: 'Dani',
    joinedAt: hours(-6),
    lastSeenAt: hours(-1),
    expiresAt: hours(6),
    revokedAt: null,
    invitedAt: null,
    invitedByUserId: null,
  });

  it('clears the expiry and keeps the participant id', async () => {
    const harness = build({ participants: [liveVisitor()] });
    const kept = await harness.service.addParticipant({
      userId: OWNER,
      generatedListId: BASKET,
      memberUserId: OTHER_USER,
    });

    expect(kept.id).toBe('p-visitor');
    expect(kept.expiresAt).toBeNull();
    expect(kept.shareLinkId).toBeNull();
  });

  it('waives the contact rule for somebody already on the basket', async () => {
    // The rule exists so that nobody is put on a basket by a stranger who
    // guessed a user id. The owner handed this person the link themselves.
    const harness = build({ participants: [liveVisitor()], contacts: {} });
    await expect(
      harness.service.addParticipant({
        userId: OWNER,
        generatedListId: BASKET,
        memberUserId: OTHER_USER,
      })
    ).resolves.toMatchObject({ id: 'p-visitor' });
  });

  it('keeps the contact rule for somebody with no live row', async () => {
    const harness = build({ contacts: {} });
    await expect(
      harness.service.addParticipant({
        userId: OWNER,
        generatedListId: BASKET,
        memberUserId: OTHER_USER,
      })
    ).rejects.toBeInstanceOf(DomainException);
  });

  it('gives a person added from the owner’s contacts no expiry', async () => {
    const harness = build({ contacts: { [OTHER_USER]: 'Dani' } });
    const added = await harness.service.addParticipant({
      userId: OWNER,
      generatedListId: BASKET,
      memberUserId: OTHER_USER,
    });

    expect(added.expiresAt).toBeNull();
  });

  it('puts them out of reach of a later revoke with its people', async () => {
    const harness = build({
      links: [
        {
          id: 'link-1',
          generatedListId: BASKET,
          secret: 'live',
          createdAt: NOW,
          expiresAt: hours(12),
          revokedAt: null,
        },
      ],
      participants: [liveVisitor()],
    });
    await harness.service.addParticipant({
      userId: OWNER,
      generatedListId: BASKET,
      memberUserId: OTHER_USER,
    });
    await harness.service.revokeLink({
      userId: OWNER,
      generatedListId: BASKET,
      revokeParticipants: true,
    });

    expect(
      harness.participants.find((p) => p.id === 'p-visitor')?.revokedAt
    ).toBeFalsy();
  });
});

describe('what an expired person is told (plan 0140, section 8)', () => {
  it('tells a visitor past their expiry that their access ended', async () => {
    const harness = build({
      participants: [
        {
          id: 'p-late',
          generatedListId: BASKET,
          kind: ParticipantKind.GUEST,
          guestNumber: 1,
          sessionSecretHash: hash('guest-secret'),
          expiresAt: hours(-1),
          revokedAt: null,
        },
      ],
    });
    await expect(
      harness.service.resolveParticipant({
        generatedListId: BASKET,
        sessionSecret: 'guest-secret',
      })
    ).rejects.toMatchObject({ code: 'participant_expired' });
  });

  it('tells one the sweep already ended the same thing', async () => {
    const harness = build({
      participants: [
        {
          id: 'p-swept',
          generatedListId: BASKET,
          kind: ParticipantKind.REGISTERED,
          userId: OTHER_USER,
          expiresAt: hours(-2),
          revokedAt: hours(-2),
          endedReason: ParticipantEndedReason.EXPIRED,
        },
      ],
    });
    await expect(
      harness.service.resolveParticipant({
        generatedListId: BASKET,
        userId: OTHER_USER,
      })
    ).rejects.toMatchObject({ code: 'participant_expired' });
  });

  it('keeps not_a_participant for somebody the owner removed', async () => {
    // A different sentence about a different thing: a person said so.
    const harness = build({
      participants: [
        {
          id: 'p-removed',
          generatedListId: BASKET,
          kind: ParticipantKind.REGISTERED,
          userId: OTHER_USER,
          expiresAt: hours(4),
          revokedAt: hours(-1),
          endedReason: ParticipantEndedReason.REMOVED,
        },
      ],
    });
    await expect(
      harness.service.resolveParticipant({
        generatedListId: BASKET,
        userId: OTHER_USER,
      })
    ).rejects.toMatchObject({ code: 'not_a_participant' });
  });

  it('keeps not_a_participant for a credential that names nobody', async () => {
    const harness = build();
    await expect(
      harness.service.resolveParticipant({
        generatedListId: BASKET,
        sessionSecret: 'never-issued',
      })
    ).rejects.toMatchObject({ code: 'not_a_participant' });
  });

  it('serves the expiry on the participants read, for everybody', async () => {
    // The people sheet offers "keep" from it, so it is not behind the device
    // rule: it is a fact the whole basket may see.
    const harness = build();
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    await harness.service.join({ secret: link.secret });

    const people = await harness.service.listParticipants({
      generatedListId: BASKET,
    });
    const owner = people.participants.find(
      (p) => p.kind === ParticipantKind.OWNER
    );
    const guest = people.participants.find(
      (p) => p.kind === ParticipantKind.GUEST
    );
    expect(owner?.expiresAt).toBeNull();
    expect(guest?.expiresAt).toBe(hours(12).toISOString());
  });
});
