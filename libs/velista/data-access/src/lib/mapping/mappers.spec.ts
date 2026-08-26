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

  it('leaves the summary undefined when the API did not send one', () => {
    // Absent is the truth; zero members would be a claim. The API has no summary
    // fields today at all (plan 0003 section 5.2).
    expect(toMyZone({ id: 'z1' })?.summary).toBeUndefined();
  });

  it('maps a summary when one is present', () => {
    const zone = toMyZone({
      id: 'z1',
      myRole: 'OWNER',
      myStatus: 'APPROVED',
      summary: {
        memberCount: 3,
        listCount: 2,
        pendingRequestCount: 3,
        firstPendingRequesterName: 'Ines',
        lists: [{ id: 'l1', name: 'Weekly', lineCount: 12, readyCount: 7 }],
      },
    });

    expect(zone?.summary).toEqual({
      memberCount: 3,
      listCount: 2,
      pendingRequestCount: 3,
      firstPendingRequesterName: 'Ines',
      lists: [{ id: 'l1', name: 'Weekly', lineCount: 12, readyCount: 7 }],
    });
  });

  it('never reports more ready than there are lines', () => {
    // "9 of 5 ready" reads as a bug and costs the user their trust in every other
    // number on the page.
    const zone = toMyZone({
      id: 'z1',
      summary: { lists: [{ id: 'l1', lineCount: 5, readyCount: 9 }] },
    });

    expect(zone?.summary?.lists[0]).toMatchObject({
      lineCount: 5,
      readyCount: 5,
    });
  });

  it('drops a malformed list from the preview without losing the summary', () => {
    const zone = toMyZone({
      id: 'z1',
      summary: { lists: [{ name: 'no id' }, { id: 'l2', name: 'fine' }] },
    });

    expect(zone?.summary?.lists).toHaveLength(1);
    expect(zone?.summary?.lists[0].id).toBe('l2');
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
  it('maps a complete pair', () => {
    expect(
      toSessionTokens({
        userId: 'u1',
        kind: 'REGISTERED',
        accessToken: 'a',
        refreshToken: 'r',
      })
    ).toEqual({
      userId: 'u1',
      kind: 'REGISTERED',
      accessToken: 'a',
      refreshToken: 'r',
    });
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
