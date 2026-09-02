import {
  GeneratedListStatus,
  ParticipantKind,
  RealtimeEvent,
} from '@portfolio/luna-shopper/contracts';
import { DomainException } from '@portfolio/luna-shopper/platform';
import { createHash } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { GeneratedListParticipant, GeneratedListShareLink } from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { GeneratedListSharingService } from './generated-list-sharing.service';
import {
  BASKET_SOURCE_LISTS_SQL,
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
  events: { event: RealtimeEvent; generatedListId?: string }[];
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
    sourceLists?: { listId: string; zoneId: string }[];
    /** userId -> the lists that user may write, at request time. */
    writable?: Record<string, string[]>;
    /** Make the next link insert lose the partial unique index. */
    loseTheLinkRace?: Partial<GeneratedListShareLink>;
  } = {}
): Harness {
  const links = [...(options.links ?? [])];
  const participants = [...(options.participants ?? [])];
  const events: Harness['events'] = [];
  const sourceLists = options.sourceLists ?? [];
  const writable = options.writable ?? {};

  const list = {
    id: BASKET,
    ownerUserId: OWNER,
    name: 'Saturday',
    status: options.status ?? GeneratedListStatus.ACTIVE,
    generatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  let nextId = 0;
  const id = (prefix: string) => `${prefix}-${++nextId}`;

  const query = async (sql: string, params: unknown[]): Promise<unknown[]> => {
    if (sql === BASKET_SOURCE_LISTS_SQL) {
      return sourceLists;
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
    if (sql.includes('FOR UPDATE')) {
      return [{ id: BASKET }];
    }
    throw new Error(`unmocked query: ${sql.slice(0, 60)}`);
  };

  const liveLinkFor = () => links.find((link) => !link.revokedAt) ?? null;

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

  let linkSaves = 0;
  const linkRepo = {
    findOne: async ({ where }: { where: Record<string, unknown> }) => {
      if (where['secret'] !== undefined) {
        return links.find((link) => link.secret === where['secret']) ?? null;
      }
      return liveLinkFor();
    },
    create: (data: Partial<GeneratedListShareLink>) => ({ ...data }),
    save: async (row: Partial<GeneratedListShareLink>) => {
      linkSaves += 1;
      if (options.loseTheLinkRace && linkSaves === 1) {
        // The index refused ours; the winner's row is what the re-read finds.
        links.push(options.loseTheLinkRace);
        throw uniqueViolation();
      }
      const saved = { ...row, id: id('link'), createdAt: new Date() };
      links.push(saved);
      return saved;
    },
  };

  const matches = (
    row: Partial<Record<string, unknown>>,
    where: Record<string, unknown>
  ): boolean =>
    Object.entries(where).every(([key, value]) => {
      const actual = (row as Record<string, unknown>)[key];
      // `IsNull()` is an object rather than a literal, so it is recognised by
      // shape: every `where` here uses it for exactly one thing.
      if (value && typeof value === 'object' && '@instanceof' in value) {
        return actual === null || actual === undefined;
      }
      return actual === value;
    });

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
    save: async (row: Partial<GeneratedListParticipant>) => {
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
  } as unknown as DataSource;

  const service = new GeneratedListSharingService(
    dataSource,
    listRepo as never,
    linkRepo as never,
    participantRepo as never,
    {
      emitToGeneratedList: (event: RealtimeEvent, generatedListId: string) =>
        events.push({ event, generatedListId }),
    } as unknown as CoreEventsPublisher
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
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: null,
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
          expiresAt: new Date('2020-01-01T00:00:00.000Z'),
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
      status: GeneratedListStatus.COMPLETED,
      links: [
        { id: 'l', generatedListId: BASKET, secret: 'live', revokedAt: null },
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

describe('what a participant may see (section 5.2)', () => {
  const sources = [
    { listId: LIST_A, zoneId: ZONE_A },
    { listId: LIST_B, zoneId: ZONE_A },
  ];

  it('never lets a guest see zone data, having no account to hold access with', async () => {
    const harness = build({ sourceLists: sources, writable: {} });
    const link = await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });
    const guest = await harness.service.join({ secret: link.secret });

    const context = await harness.service.resolveParticipant({
      generatedListId: BASKET,
      sessionSecret: guest.sessionSecret as string,
    });
    expect(context.seesZoneData).toBe(false);
  });

  it('lets the owner see it by construction (section 2)', async () => {
    const harness = build({ sourceLists: sources, writable: {} });
    await harness.service.ensureLink({
      userId: OWNER,
      generatedListId: BASKET,
    });

    const context = await harness.service.resolveParticipant({
      generatedListId: BASKET,
      userId: OWNER,
    });
    expect(context.seesZoneData).toBe(true);
  });

  it('lets a registered participant see it only with WRITE everywhere', async () => {
    const harness = build({
      sourceLists: sources,
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
    expect(context.seesZoneData).toBe(true);
  });

  it('collapses the whole view when one source is only readable', async () => {
    // The known cliff, accepted because it fails in the safe direction.
    const harness = build({
      sourceLists: sources,
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
    expect(context.seesZoneData).toBe(false);
  });
});

describe('the device string is not presence data (section 7)', () => {
  it('shows it to a reader who passes section 5.2 and hides it from a guest', async () => {
    const harness = build({ sourceLists: [], writable: {} });
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
