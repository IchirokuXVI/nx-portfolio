import {
  toComment,
  toLine,
  toMembership,
  toMyZone,
  toPage,
  toSessionTokens,
  toShoppingList,
  toZone,
  toZonePresence,
} from './mappers';

/**
 * Rule D4's test surface (plan 0004, section 12). Every mapper takes `unknown`, so
 * every mapper is tested against a missing field, a `null` in a non-nullable position,
 * and an enum value the app does not recognise. None of them may throw.
 */
describe('rule D4: mappers never throw and never trust', () => {
  const mappers = {
    toZone,
    toMyZone,
    toMembership,
    toShoppingList,
    toLine,
    toComment,
    toZonePresence,
    toSessionTokens,
  };

  const hostile: unknown[] = [
    undefined,
    null,
    0,
    '',
    'a string',
    [],
    {},
    { id: null },
    { id: 42 },
    { id: 'x', name: null, status: null, version: null },
    Object.create(null),
  ];

  it.each(Object.entries(mappers))(
    '%s survives every hostile input',
    (_name, map) => {
      for (const input of hostile) {
        expect(() => map(input)).not.toThrow();
      }
    }
  );
});

describe('toZone', () => {
  it('maps a well formed zone', () => {
    expect(
      toZone({
        id: 'z1',
        name: 'Flat',
        joinCode: 'ABC123',
        status: 'ACTIVE',
        ownerUserId: 'u1',
      })
    ).toEqual({
      id: 'z1',
      name: 'Flat',
      joinCode: 'ABC123',
      status: 'ACTIVE',
      ownerUserId: 'u1',
    });
  });

  it('drops a record with no id, because nothing can be tapped or reconciled', () => {
    expect(toZone({ name: 'Flat' })).toBeNull();
  });

  it('defaults a missing name rather than dropping the record', () => {
    expect(toZone({ id: 'z1' })?.name).toBe('');
  });

  it('maps an unrecognised status to UNKNOWN, not to ACTIVE', () => {
    // A newer backend can send a status this build has never heard of. Guessing
    // ACTIVE would offer a tap into a zone that may already be torn down.
    expect(
      toZone({ id: 'z1', status: 'ARCHIVED_PENDING_REVIEW' })?.status
    ).toBe('UNKNOWN');
    expect(toZone({ id: 'z1' })?.status).toBe('UNKNOWN');
  });

  it('collapses a null owner to null rather than to a string', () => {
    expect(toZone({ id: 'z1', ownerUserId: null })?.ownerUserId).toBeNull();
  });
});

describe('toMyZone', () => {
  it('falls back to the least privileged role for an unknown one', () => {
    expect(toMyZone({ id: 'z1', myRole: 'SUPERUSER' })?.myRole).toBe('MEMBER');
  });

  it('falls back to PENDING for an unknown membership status', () => {
    // PENDING renders as "waiting to be let in": no content, not tappable through.
    expect(toMyZone({ id: 'z1', myStatus: 'PROVISIONAL' })?.myStatus).toBe(
      'PENDING'
    );
  });

  it('falls back to zeroes when the counts block is missing entirely', () => {
    // The gateway always sends it now, but "always" is a promise about the current
    // deploy: a phone on a cached bundle can still meet an older one, and a card of
    // zeroes beats a crash.
    expect(toMyZone({ id: 'z1' })?.counts).toEqual({
      memberCount: 0,
      listCount: 0,
      pendingRequestCount: null,
      firstPendingRequesterName: null,
    });
  });

  it('maps the counts and the list preview', () => {
    const zone = toMyZone({
      id: 'z1',
      myRole: 'OWNER',
      myStatus: 'APPROVED',
      counts: {
        memberCount: 3,
        listCount: 2,
        pendingRequestCount: 3,
        firstPendingRequesterName: 'Ines',
      },
      lists: [{ id: 'l1', name: 'Weekly', lineCount: 12, readyCount: 7 }],
    });

    expect(zone?.counts).toEqual({
      memberCount: 3,
      listCount: 2,
      pendingRequestCount: 3,
      firstPendingRequesterName: 'Ines',
    });
    expect(zone?.lists).toEqual([
      { id: 'l1', name: 'Weekly', lineCount: 12, readyCount: 7 },
    ]);
  });

  it('keeps a null pending count as null rather than collapsing it to zero', () => {
    // Null means "you may not see who is waiting". Zero would mean "nobody is",
    // which is a different claim and would hide the row from somebody entitled to
    // it the moment the two were confused.
    const zone = toMyZone({
      id: 'z1',
      counts: {
        memberCount: 2,
        listCount: 1,
        pendingRequestCount: null,
        firstPendingRequesterName: null,
      },
    });

    expect(zone?.counts.pendingRequestCount).toBeNull();
  });

  it('never reports more ready than there are lines', () => {
    // "9 of 5 ready" reads as a bug and costs the user their trust in every other
    // number on the page.
    const zone = toMyZone({
      id: 'z1',
      lists: [{ id: 'l1', lineCount: 5, readyCount: 9 }],
    });

    expect(zone?.lists[0]).toMatchObject({
      lineCount: 5,
      readyCount: 5,
    });
  });

  it('drops a malformed list from the preview without losing the rest', () => {
    const zone = toMyZone({
      id: 'z1',
      lists: [{ name: 'no id' }, { id: 'l2', name: 'fine' }],
    });

    expect(zone?.lists).toHaveLength(1);
    expect(zone?.lists[0].id).toBe('l2');
  });
});

/**
 * Payloads captured verbatim from the running gateway on 2026-08-26, after backend
 * plans 0017 and 0018.
 *
 * The rest of this file tests the mappers against shapes **this repository** believes
 * in, which is exactly the assumption rule D4 exists to distrust. These two are the
 * other half: if the gateway's contract drifts, one of them fails and names the field.
 * Re-capture them rather than editing them by hand when the API changes on purpose.
 */
describe('against payloads captured from the live gateway', () => {
  const ownerView = {
    id: '4467bd80-5d2a-445b-88ce-ea3cab119964',
    name: 'Velista verify',
    joinCode: 'ESFWZNDR',
    status: 'ACTIVE',
    ownerUserId: 'c21a2046-f941-49df-be23-976c576c4ae8',
    config: {},
    createdAt: '2026-08-26T13:22:45.467Z',
    updatedAt: '2026-08-26T13:22:45.467Z',
    myRole: 'OWNER',
    myStatus: 'APPROVED',
    counts: {
      memberCount: 1,
      listCount: 0,
      pendingRequestCount: 1,
      firstPendingRequesterName: 'Tidal Knot',
    },
    lists: [],
  };

  /** The same zone, as the pending non-staff joiner sees it. */
  const joinerView = {
    ...ownerView,
    myRole: 'MEMBER',
    myStatus: 'PENDING',
    counts: {
      memberCount: 1,
      listCount: 0,
      pendingRequestCount: null,
      firstPendingRequesterName: null,
    },
    lists: [],
  };

  it('maps what an owner receives, join request included', () => {
    const zone = toMyZone(ownerView);

    expect(zone).toMatchObject({
      id: '4467bd80-5d2a-445b-88ce-ea3cab119964',
      name: 'Velista verify',
      status: 'ACTIVE',
      myRole: 'OWNER',
      myStatus: 'APPROVED',
      counts: {
        memberCount: 1,
        pendingRequestCount: 1,
        firstPendingRequesterName: 'Tidal Knot',
      },
    });
  });

  it('maps what a pending non-staff member receives', () => {
    // The two nulls are the backend saying "you may not see who is waiting", and
    // they are what the join request row keys off. If they ever arrive as 0 instead,
    // an ordinary member would start seeing governance data.
    const zone = toMyZone(joinerView);

    expect(zone?.myStatus).toBe('PENDING');
    expect(zone?.counts.pendingRequestCount).toBeNull();
    expect(zone?.counts.firstPendingRequesterName).toBeNull();
  });

  it('maps the token pair the guest handshake returns', () => {
    // `username` is generated by the backend when the request omits it, which is
    // what keeps the anonymous entry actions to one tap.
    const tokens = toSessionTokens({
      userId: 'c21a2046-f941-49df-be23-976c576c4ae8',
      kind: 'TEMPORARY',
      username: 'Windward Beacon',
      accessToken: 'header.payload.signature',
      refreshToken: 'oWQBrYXK0c-OVAJVpTJqW48Za2nPbnd8KpHMRgepsq8',
    });

    expect(tokens).toMatchObject({
      kind: 'TEMPORARY',
      username: 'Windward Beacon',
    });
  });

  it('maps a page of them', () => {
    const page = toPage({ items: [ownerView], nextCursor: null }, toMyZone);

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });
});

describe('toLine', () => {
  const valid = {
    id: 'ln1',
    listId: 'l1',
    content: 'Milk',
    quantity: 2,
    itemId: null,
    position: 3,
    approvalStatus: 'APPROVED',
    status: 'READY',
    createdByUserId: 'u1',
    approvedByUserId: 'u2',
    version: 7,
  };

  it('maps a well formed line', () => {
    expect(toLine(valid)).toEqual(valid);
  });

  it('drops a line with no list id, since it cannot be placed', () => {
    expect(toLine({ ...valid, listId: undefined })).toBeNull();
  });

  it('defaults a missing version to 0 so it loses races rather than winning them', () => {
    // Overwriting somebody else's edit because a field was absent is the one outcome
    // worth defaulting against (plan 0004, section 7.2).
    expect(toLine({ ...valid, version: undefined })?.version).toBe(0);
  });

  it('rejects NaN and Infinity, which pass a typeof number check', () => {
    expect(toLine({ ...valid, quantity: Number.NaN })?.quantity).toBe(1);
    expect(
      toLine({ ...valid, position: Number.POSITIVE_INFINITY })?.position
    ).toBe(0);
  });

  it('falls back to PENDING for an unknown line status', () => {
    expect(toLine({ ...valid, status: 'ON_ORDER' })?.status).toBe('PENDING');
  });
});

describe('toComment', () => {
  it('parses the timestamp', () => {
    const comment = toComment({
      id: 'c1',
      lineId: 'ln1',
      authorUserId: 'u1',
      body: 'got it',
      createdAt: '2026-08-26T10:00:00.000Z',
    });

    expect(comment?.createdAt).toEqual(new Date('2026-08-26T10:00:00.000Z'));
  });

  it('drops a comment whose timestamp will not parse', () => {
    // A string Date accepts but turns into an Invalid Date is what surfaces as
    // "NaN/NaN/NaN" in the UI, so it is rejected at the boundary instead.
    expect(
      toComment({ id: 'c1', lineId: 'ln1', createdAt: 'last tuesday' })
    ).toBeNull();
  });
});

describe('toSessionTokens', () => {
  it('maps a complete pair, username included', () => {
    expect(
      toSessionTokens({
        userId: 'u1',
        kind: 'REGISTERED',
        username: 'dani',
        accessToken: 'a',
        refreshToken: 'r',
      })
    ).toEqual({
      userId: 'u1',
      kind: 'REGISTERED',
      username: 'dani',
      accessToken: 'a',
      refreshToken: 'r',
    });
  });

  it('accepts a pair with no username rather than signing the user out', () => {
    // A pair written to storage before backend plan 0018 landed has none. Rejecting
    // it would clear the session of every existing user on deploy, which is a far
    // worse outcome than an app bar with no initial for one session.
    const tokens = toSessionTokens({
      userId: 'u1',
      kind: 'REGISTERED',
      accessToken: 'a',
      refreshToken: 'r',
    });

    expect(tokens).not.toBeNull();
    expect(tokens?.username).toBe('');
  });

  it.each(['userId', 'accessToken', 'refreshToken'])(
    'rejects a pair missing %s outright',
    (field) => {
      const raw: Record<string, unknown> = {
        userId: 'u1',
        kind: 'REGISTERED',
        accessToken: 'a',
        refreshToken: 'r',
      };
      delete raw[field];

      expect(toSessionTokens(raw)).toBeNull();
    }
  );

  it('falls back to TEMPORARY for an unknown kind, so the guest banner shows', () => {
    // Being told to secure an already secure account is a small annoyance. Not being
    // told, and then losing the phone, loses everything.
    expect(
      toSessionTokens({
        userId: 'u1',
        kind: 'SERVICE_ACCOUNT',
        accessToken: 'a',
        refreshToken: 'r',
      })?.kind
    ).toBe('TEMPORARY');
  });
});

describe('toPage', () => {
  it('maps items and carries the cursor', () => {
    expect(
      toPage({ items: [{ id: 'z1' }], nextCursor: 'abc' }, toZone)
    ).toEqual({ items: [{ ...toZone({ id: 'z1' }) }], nextCursor: 'abc' });
  });

  it('drops unmappable items without losing the page', () => {
    const page = toPage(
      { items: [{ id: 'z1' }, 'nope', null], nextCursor: null },
      toZone
    );

    expect(page.items).toHaveLength(1);
  });

  it('turns a body that is not a page into an empty terminal page', () => {
    // A null cursor reads to the caller as "no more data" and stops a pagination
    // loop rather than spinning it.
    expect(toPage('<html>502</html>', toZone)).toEqual({
      items: [],
      nextCursor: null,
    });
  });
});

describe('toMembership', () => {
  it('requires all three identifiers', () => {
    expect(toMembership({ id: 'm1', zoneId: 'z1' })).toBeNull();
    expect(
      toMembership({ id: 'm1', zoneId: 'z1', userId: 'u1' })
    ).not.toBeNull();
  });
});

describe('toShoppingList', () => {
  it('maps a list', () => {
    expect(
      toShoppingList({
        id: 'l1',
        zoneId: 'z1',
        name: 'Weekly',
        createdByUserId: 'u1',
      })
    ).toEqual({
      id: 'l1',
      zoneId: 'z1',
      name: 'Weekly',
      createdByUserId: 'u1',
    });
  });
});

describe('toZonePresence', () => {
  it('drops malformed people rather than the whole payload', () => {
    const presence = toZonePresence({
      zoneId: 'z1',
      online: [{ userId: 'u1', username: 'Ana' }, {}, 7],
    });

    expect(presence?.online).toEqual([{ userId: 'u1', username: 'Ana' }]);
  });
});
