import type { CatalogSuggestion } from '@portfolio/velista/models';
import {
  toAssistantReply,
  toBasketFromView,
  toBasketRun,
  toBasketSummary,
  toCatalogItem,
  toCatalogSuggestion,
  toCatalogSuggestions,
  toComment,
  toLine,
  toLineSettlement,
  toListAccessEntries,
  toListIdResult,
  toListPermissions,
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
      lists: [{ id: 'l1', name: 'Weekly', lineCount: 12, wantedCount: 7 }],
    });

    expect(zone?.counts).toEqual({
      memberCount: 3,
      listCount: 2,
      pendingRequestCount: 3,
      firstPendingRequesterName: 'Ines',
    });
    expect(zone?.lists).toEqual([
      { id: 'l1', name: 'Weekly', lineCount: 12, wantedCount: 7 },
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
      lists: [{ id: 'l1', lineCount: 5, wantedCount: 9 }],
    });

    expect(zone?.lists[0]).toMatchObject({
      lineCount: 5,
      wantedCount: 5,
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
    // A product set, where this was a single nullable `itemId` that was null on every
    // line ever created (backend plan 0048, section 1.1).
    itemIds: ['item-milk'],
    // The subscription, and which of the products the catalog put there (backend
    // plan 0070, section 9).
    productGroupId: 'group-milk',
    groupItemIds: ['item-milk'],
    position: 3,
    approvalStatus: 'APPROVED',
    // The two derived indicators, which replaced the trip status (backend plan 0047,
    // section 5). There is no `status` on a line any more.
    boughtCount: 4,
    lastSettlementOutcome: 'BOUGHT',
    // The third one (backend plan 0052, section 4), which the other two cannot
    // stand in for: bought is history and this is right now.
    claimed: true,
    claimedByUserId: 'u9',
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

  it('reads a free text line as a free text line', () => {
    // Empty and null are what the server sends for a line carrying no products, and
    // both have to survive: a set that arrived as something else must not become a
    // product reference nobody can resolve.
    expect(toLine({ ...valid, itemIds: [] })?.itemIds).toEqual([]);
    expect(toLine({ ...valid, itemIds: undefined })?.itemIds).toEqual([]);
    expect(toLine({ ...valid, itemIds: [1, null, 'ok'] })?.itemIds).toEqual([
      'ok',
    ]);
  });

  it('reads no history at all as no history, in the safe direction', () => {
    // Both default to "nothing has ever happened to this line", which draws no
    // indicator. Defaulting the other way would put a bought mark on a line over an
    // absent field.
    const bare = toLine({
      ...valid,
      boughtCount: undefined,
      lastSettlementOutcome: undefined,
    });

    expect(bare?.boughtCount).toBe(0);
    expect(bare?.lastSettlementOutcome).toBeNull();
  });

  it('reads an absent subscription as a hand made set', () => {
    // The safe direction, and the same answer for two different servers: one that
    // predates backend `0070` and one describing a line that follows no group. Both
    // are lines nothing syncs, so neither draws a provenance heading or a `Keep`
    // control, and the two need no distinction.
    const bare = toLine({
      ...valid,
      productGroupId: undefined,
      groupItemIds: undefined,
    });

    expect(bare?.productGroupId).toBeNull();
    expect(bare?.groupItemIds).toEqual([]);
  });

  it('drops a group product id that is not a string', () => {
    // The same rule `itemIds` follows: a reference nobody can resolve is not a
    // product, and keeping it as a hole would put an unnamed chip in the catalog's
    // cluster for something that is not on the line.
    expect(
      toLine({ ...valid, groupItemIds: [1, null, 'ok'] })?.groupItemIds
    ).toEqual(['ok']);
  });

  it('reads an absent claim as nobody buying it, in the safe direction', () => {
    // Same rule as the two above. A row that said somebody was out buying this over
    // a missing field would be read as the line having been dealt with.
    const bare = toLine({
      ...valid,
      claimed: undefined,
      claimedByUserId: undefined,
    });

    expect(bare?.claimed).toBe(false);
    expect(bare?.claimedByUserId).toBeNull();
  });

  it('keeps a claim whose owner has left the zone, without the name', () => {
    // Backend plan 0052, section 6: the household still needs to know somebody has
    // it, and who that was has stopped being this reader's to have.
    const anonymous = toLine({ ...valid, claimedByUserId: null });

    expect(anonymous?.claimed).toBe(true);
    expect(anonymous?.claimedByUserId).toBeNull();
  });

  it('reads an outcome it has never heard of as the quiet one', () => {
    // `NOT_AVAILABLE` moves no quantity and counts as no purchase, so an unknown value
    // reports a trip that happened and claims nothing about what the household has.
    expect(
      toLine({ ...valid, lastSettlementOutcome: 'REFUNDED' })
        ?.lastSettlementOutcome
    ).toBe('NOT_AVAILABLE');
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
        autoApproveLines: true,
        sharedWithZone: true,
      })
    ).toEqual({
      id: 'l1',
      zoneId: 'z1',
      name: 'Weekly',
      createdByUserId: 'u1',
      autoApproveLines: true,
      sharedWithZone: true,
    });
  });

  it('reads anything but a literal true as not shared with the zone', () => {
    // The same safe direction, for the switch a person flips rather than for a row the
    // page draws: a list assumed shared would draw the control on for a list nobody
    // opened, and turning it off from there revokes nobody but does say something
    // untrue about who can use it.
    expect(
      toShoppingList({ id: 'l1', zoneId: 'z1', sharedWithZone: 'yes' })
    ).toMatchObject({ sharedWithZone: false });
    expect(toShoppingList({ id: 'l1', zoneId: 'z1' })).toMatchObject({
      sharedWithZone: false,
    });
  });

  it('reads anything but a literal true as not auto-approving', () => {
    // The safe direction: a list assumed to auto-approve would have its optimistic rows
    // drawn already approved and corrected a frame later, which is the defect backend
    // plan 0037 exists to remove, pointing the other way.
    for (const raw of [undefined, null, 0, 1, 'true', {}]) {
      expect(
        toShoppingList({ id: 'l1', zoneId: 'z1', autoApproveLines: raw })
          ?.autoApproveLines
      ).toBe(false);
    }
  });
});

/**
 * The set with no fallback (plan 0030, section 2).
 *
 * Every other enum in this app lands an unrecognised value on a defined member, because
 * a single value has to be something. A set does not: it keeps what it understood and
 * drops the rest, which is both strictly correct and the safe direction, since a client
 * that does not know a permission draws no control for it.
 */
describe('toListPermissions', () => {
  it('keeps the members it recognises, in the order they arrived', () => {
    expect(toListPermissions(['READ', 'DECIDE'])).toEqual(['READ', 'DECIDE']);
  });

  it('drops an unrecognised member and keeps the rest', () => {
    expect(
      toListPermissions(['READ', 'TELEPORT', 'WRITE', 'read', 'MANAGE'])
    ).toEqual(['READ', 'WRITE', 'MANAGE']);
  });

  it('drops members that are not strings at all', () => {
    expect(
      toListPermissions(['READ', 42, null, undefined, {}, ['WRITE']])
    ).toEqual(['READ']);
  });

  it('answers the empty set for anything that is not an array', () => {
    // Absent, unreadable, or an object where an array was promised: all of them mean
    // the client knows of no permission, and the page reads that as read only rather
    // than offering controls and learning from a refusal.
    for (const raw of [undefined, null, 0, '', 'READ', {}, { 0: 'READ' }]) {
      expect(toListPermissions(raw)).toEqual([]);
    }
  });

  it('never throws, whatever it is handed', () => {
    for (const raw of [Object.create(null), new Map(), Symbol('x')]) {
      expect(() => toListPermissions(raw)).not.toThrow();
    }
  });
});

describe('toListAccessEntries', () => {
  it('reads the endpoint envelope and drops an entry that names nobody', () => {
    expect(
      toListAccessEntries({
        listId: 'l1',
        entries: [
          { membershipId: 'm1', permissions: ['READ', 'WRITE'] },
          { permissions: ['READ'] },
          { membershipId: 'm2', permissions: ['READ', 'TELEPORT'] },
        ],
      })
    ).toEqual([
      { membershipId: 'm1', permissions: ['READ', 'WRITE'] },
      { membershipId: 'm2', permissions: ['READ'] },
    ]);
  });

  it('keeps a row whose permissions are unreadable, with an empty set', () => {
    // A row with no access is a real row in the share sheet: dropping it would hide a
    // member the caller can grant access to.
    expect(toListAccessEntries({ entries: [{ membershipId: 'm1' }] })).toEqual([
      { membershipId: 'm1', permissions: [] },
    ]);
  });

  it('accepts the bare array, which is the same fact in the PUT shape', () => {
    expect(
      toListAccessEntries([{ membershipId: 'm1', permissions: ['READ'] }])
    ).toEqual([{ membershipId: 'm1', permissions: ['READ'] }]);
  });

  it('answers an empty list for anything unreadable', () => {
    for (const raw of [undefined, null, 0, 'entries', {}, { entries: 3 }]) {
      expect(toListAccessEntries(raw)).toEqual([]);
    }
  });
});

describe('toListIdResult', () => {
  // What `PUT /v1/lists/:id/access` answers. Reading it as a list summary threw after
  // a save that had landed, and the share sheet drew an error over it.
  it('reads the list id the access route answers', () => {
    expect(toListIdResult({ listId: 'l1' })).toBe('l1');
  });

  it('answers null for anything else', () => {
    for (const raw of [undefined, null, 'l1', {}, { id: 'l1' }]) {
      expect(toListIdResult(raw)).toBeNull();
    }
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

/**
 * The one link and the answers under a question (plan 0042, section 9).
 *
 * The wire shape changed under this app in `0046`, so the cases worth having are the
 * ones a type cannot state: a link that cannot address a list, an old backend's fields,
 * and the difference between a zone the server named and one it deliberately did not.
 */
describe('toAssistantReply', () => {
  it('reads the one link, and the zone only when the server named it', () => {
    expect(
      toAssistantReply({
        reply: 'It is not on the weekly shop, so I have added it.',
        link: {
          zoneId: 'z1',
          listId: 'l1',
          label: 'Compra semanal',
          zoneLabel: 'Casa',
        },
        choices: [],
      })
    ).toEqual({
      text: 'It is not on the weekly shop, so I have added it.',
      link: {
        zoneId: 'z1',
        listId: 'l1',
        label: 'Compra semanal',
        zoneLabel: 'Casa',
      },
      choices: [],
    });
  });

  it('keeps a null zoneLabel null rather than composing one', () => {
    // Section 3.1: whether the zone is worth naming is the server's rule, and this
    // side counts nothing. A null here has to survive as a null.
    const reply = toAssistantReply({
      reply: 'Added.',
      link: { zoneId: 'z1', listId: 'l1', label: 'Weekly', zoneLabel: null },
    });

    expect(reply?.link?.zoneLabel).toBeNull();
  });

  it('drops a link that is missing its listId (rule A3)', () => {
    // A link this app cannot address would 404, which is the thing rule A3 exists to
    // prevent, so it is dropped rather than half built.
    const reply = toAssistantReply({
      reply: 'There.',
      link: { zoneId: 'z1', listId: null, label: 'Weekly', zoneLabel: null },
    });

    expect(reply).toEqual({ text: 'There.', link: null, choices: [] });
  });

  it('reads the answers to a question', () => {
    const reply = toAssistantReply({
      reply: 'Which list did you mean?',
      listResolution: 'ASKED',
      link: null,
      choices: [
        { label: 'Compra semanal · Casa', message: 'the weekly shop' },
        { label: 'Compra · Oficina', message: 'the office one' },
      ],
    });

    expect(reply).toEqual({
      text: 'Which list did you mean?',
      listResolution: 'asked',
      link: null,
      choices: [
        { label: 'Compra semanal · Casa', message: 'the weekly shop' },
        { label: 'Compra · Oficina', message: 'the office one' },
      ],
    });
  });

  it('drops a choice with no message, since tapping it would say nothing', () => {
    const reply = toAssistantReply({
      reply: 'Which one?',
      choices: [
        { label: 'Weekly', message: 'the weekly shop' },
        { label: 'Other' },
      ],
    });

    expect(reply?.choices).toEqual([
      { label: 'Weekly', message: 'the weekly shop' },
    ]);
  });

  it('reads an old backend as an answer with nothing under it', () => {
    // Section 8. `link` absent is null, `choices` absent is empty, and a stray
    // `references` array is ignored rather than read. Nobody sees an error.
    expect(
      toAssistantReply({
        reply: 'Yes.',
        references: [
          { kind: 'LIST', zoneId: 'z1', listId: 'l1', label: 'Weekly' },
        ],
      })
    ).toEqual({ text: 'Yes.', link: null, choices: [] });
  });
});

/**
 * Generated shopping lists (plan 0045), which is rule D4 applied to the two shapes the
 * listing and the create answer with.
 */
describe('toBasketSummary', () => {
  const wire = {
    id: 'gl1',
    kind: 'GENERATED',
    name: 'Saturday big shop',
    status: 'OPEN',
    generatedAt: '2026-08-21T10:00:00.000Z',
    lineCount: 12,
    settledLineCount: 4,
    boughtLineCount: 3,
    notAvailableLineCount: 1,
    presentCount: 2,
  };

  it('maps the listing shape', () => {
    expect(toBasketSummary(wire)).toEqual({
      id: 'gl1',
      kind: 'GENERATED',
      name: 'Saturday big shop',
      status: 'OPEN',
      generatedAt: new Date('2026-08-21T10:00:00.000Z'),
      lineCount: 12,
      settledLineCount: 4,
      boughtLineCount: 3,
      notAvailableLineCount: 1,
      presentCount: 2,
    });
  });

  /**
   * A server older than backend `0053` sends none of the three, and the row has to
   * survive it (velista plan 0049, section 2).
   *
   * Zero for all three, which is not a lucky default: it makes the two outcome counts
   * fail to account for four finished lines, so `outcomeBreakdown` answers null and the
   * screens say "finished" exactly as they did before the field existed. A fabricated
   * breakdown would claim three purchases nobody made.
   */
  it('reads a summary with no breakdown as zeroes rather than dropping it', () => {
    const mapped = toBasketSummary({
      id: 'gl1',
      kind: 'GENERATED',
      name: null,
      status: 'OPEN',
      generatedAt: '2026-08-21T10:00:00.000Z',
      lineCount: 12,
      settledLineCount: 4,
    });

    expect(mapped).not.toBeNull();
    expect(mapped?.boughtLineCount).toBe(0);
    expect(mapped?.notAvailableLineCount).toBe(0);
    expect(mapped?.presentCount).toBe(0);
  });

  // Null is a basket nobody named, which the client displays as its generation date.
  // Collapsing it to an empty string would erase the difference between unnamed and
  // named nothing.
  it('keeps a null name as null rather than as an empty string', () => {
    expect(toBasketSummary({ ...wire, name: null })?.name).toBeNull();
  });

  it('drops a body that is not a record, and one with no id', () => {
    expect(toBasketSummary(null)).toBeNull();
    expect(toBasketSummary('gl1')).toBeNull();
    expect(toBasketSummary({ ...wire, id: undefined })).toBeNull();
  });

  /**
   * The one strict field. The date is not decoration on this object: the history is
   * ordered by it and an unnamed basket's whole display name is built from it, so a row
   * that kept a fabricated `new Date()` would sort itself to the top of somebody's
   * history and title itself today.
   */
  it('drops a summary whose date cannot be read, rather than inventing one', () => {
    expect(toBasketSummary({ ...wire, generatedAt: 'soon' })).toBeNull();
    expect(toBasketSummary({ ...wire, generatedAt: null })).toBeNull();
  });

  // An unrecognised status must never read as ACTIVE, which would put a basket the
  // server considers finished back on the dashboard.
  it('falls back to UNKNOWN for a status this build does not know', () => {
    expect(toBasketSummary({ ...wire, status: 'PAUSED' })?.status).toBe(
      'UNKNOWN'
    );
  });

  it('reads a missing count as zero rather than dropping the row', () => {
    const mapped = toBasketSummary({
      ...wire,
      lineCount: undefined,
      settledLineCount: undefined,
    });

    expect(mapped?.lineCount).toBe(0);
    expect(mapped?.settledLineCount).toBe(0);
  });
});

describe('toBasketFromView', () => {
  const line = (quantity: number, settled: number) => ({
    id: `l${quantity}${settled}`,
    content: 'Milk',
    quantity,
    settledQuantity: settled,
  });

  const view = {
    id: 'gl1',
    name: null,
    status: 'ACTIVE',
    generatedAt: '2026-08-21T10:00:00.000Z',
    lines: [line(2, 2), line(1, 0), line(3, 1)],
  };

  /**
   * The create and the two owner realtime events answer the whole basket, which carries
   * no counts because it sent the lines themselves. They are derived in one place so the
   * three call sites cannot disagree.
   */
  it('counts the lines and the finished ones off the basket itself', () => {
    const mapped = toBasketFromView(view);

    expect(mapped?.lineCount).toBe(3);
    expect(mapped?.settledLineCount).toBe(1);
  });

  // A NOT_AVAILABLE outcome closes the outstanding amount without claiming anything was
  // bought, so the line is done and the card should say so.
  it('counts a line settled past what was asked for as finished', () => {
    const mapped = toBasketFromView({
      ...view,
      lines: [line(2, 5)],
    });

    expect(mapped?.settledLineCount).toBe(1);
  });

  // Zero is not an amount somebody worked through, and counting it would let an empty
  // basket report itself finished.
  it('does not count a line asking for nothing', () => {
    const mapped = toBasketFromView({ ...view, lines: [line(0, 0)] });

    expect(mapped?.lineCount).toBe(1);
    expect(mapped?.settledLineCount).toBe(0);
  });

  it('reads a basket with no lines as empty rather than dropping it', () => {
    const mapped = toBasketFromView({ ...view, lines: [] });

    expect(mapped?.lineCount).toBe(0);
  });

  it('drops a body it cannot read at all', () => {
    expect(toBasketFromView(null)).toBeNull();
    expect(toBasketFromView({ ...view, generatedAt: 'soon' })).toBeNull();
  });
});

describe('toBasketRun', () => {
  const run = {
    basket: {
      id: 'gl1',
      kind: 'GENERATED',
      name: null,
      status: 'OPEN',
      generatedAt: '2026-08-21T10:00:00.000Z',
      lines: [{ id: 'l1', content: 'Milk', quantity: 1, settledQuantity: 0 }],
    },
  };

  /**
   * The basket, and nothing else. A run used to answer what it had refused as
   * well, and backend `0133` section 7 deleted the refusal: it was about two
   * frozen copies of one line and false of two views of it.
   */
  it('keeps the basket the run made', () => {
    const mapped = toBasketRun(run);

    expect(mapped).toEqual({ list: expect.objectContaining({ id: 'gl1' }) });
  });

  // Backend 0159 answers the basket under `basket`, with the old `list` key
  // beside it for one release. This client reads only `basket`.
  it('reads the basket under basket and never under the old list key', () => {
    expect(toBasketRun({ list: run.basket })).toBeNull();
    expect(
      toBasketRun({ ...run, list: { ...run.basket, id: 'old-key' } })?.list.id
    ).toBe('gl1');
  });

  it('reads an unknown kind as UNKNOWN rather than dropping the run', () => {
    // A kind this build has never heard of must not read as the permanent
    // basket, which is the safe direction the enum's fallback takes.
    const mapped = toBasketRun({
      basket: { ...run.basket, kind: 'SOMETHING_NEW' },
    });

    expect(mapped?.list.kind).toBe('UNKNOWN');
  });

  it('drops a run whose basket cannot be read', () => {
    expect(toBasketRun({ ...run, basket: null })).toBeNull();
    expect(toBasketRun(null)).toBeNull();
  });
});

/**
 * How big the packet is, which the catalog has always sent and this mapper used to
 * drop.
 *
 * The catalog holds **one record per size**, so a search for "leche" answers with the
 * same name and the same brand once per carton. With `unitSize` dropped here, every
 * field that reached a suggestion row was identical across those records and the
 * dropdown looked like it was repeating itself.
 */
describe('toCatalogItem: the size the catalog was always sending', () => {
  const item = {
    id: 'item-milk-1l',
    name: { es: 'Leche entera', en: 'Whole milk' },
    brand: 'Hacendado',
    unitSize: 0.5,
    defaultUnit: 'LITER',
    productGroupId: 'group-milk',
  };

  it('reads the size and the unit off the wire', () => {
    expect(toCatalogItem(item)).toEqual({
      id: 'item-milk-1l',
      name: { es: 'Leche entera', en: 'Whole milk' },
      brand: 'Hacendado',
      size: 0.5,
      unit: 'LITER',
      productGroupId: 'group-milk',
      // Absent on this fixture, so it falls back (velista `0082`).
      category: 'OTHER',
      offer: null,
      chainPrices: [],
      imageUrl: null,
      packCount: null,
      unitBasis: null,
    });
  });

  /**
   * Absent is a fact worth keeping: a product whose size the catalog does not know is
   * not a product of size zero, and no default could stand in for it without stating
   * something about the packet that nobody measured.
   */
  it('keeps an unknown size as null rather than defaulting it', () => {
    expect(toCatalogItem({ ...item, unitSize: undefined })?.size).toBeNull();
    expect(toCatalogItem({ ...item, unitSize: null })?.size).toBeNull();
    expect(toCatalogItem({ ...item, unitSize: 'a lot' })?.size).toBeNull();
    // `NaN` passes a typeof check and then renders in the middle of a row.
    expect(toCatalogItem({ ...item, unitSize: Number.NaN })?.size).toBeNull();
  });

  /**
   * A unit this build has never heard of lands on the count, which is the value whose
   * size is suppressed below two, so an unrecognised unit draws nothing rather than
   * announcing a number in a unit nobody here can name.
   */
  it('falls back to a count for a unit it does not recognise', () => {
    expect(toCatalogItem({ ...item, defaultUnit: 'FURLONG' })?.unit).toBe(
      'UNIT'
    );
    expect(toCatalogItem({ ...item, defaultUnit: undefined })?.unit).toBe(
      'UNIT'
    );
  });

  it('carries the size through a suggestion, which is where it is drawn', () => {
    const mapped = toCatalogSuggestion({ kind: 'item', group: null, item });

    expect(mapped).toEqual({
      kind: 'item',
      item: expect.objectContaining({ size: 0.5, unit: 'LITER' }),
    });
  });
});

/**
 * Velista `0082`, section 3: the zone list page shows one category at a time, so the
 * catalog's category is read rather than dropped, by the basket mapper's rule.
 */
describe('toCatalogItem: the category', () => {
  const item = {
    id: 'item-milk-1l',
    name: { es: 'Leche entera', en: 'Whole milk' },
    category: 'DAIRY',
  };

  it('reads the category off the wire', () => {
    expect(toCatalogItem(item)?.category).toBe('DAIRY');
  });

  it('reads a category it has never heard of, or none, as OTHER', () => {
    expect(toCatalogItem({ ...item, category: 'BABY_FOOD' })?.category).toBe(
      'OTHER'
    );
    expect(toCatalogItem({ ...item, category: undefined })?.category).toBe(
      'OTHER'
    );
  });
});

/**
 * The price the suggestion row draws (velista `0063`).
 *
 * It was on the wire as `bestOffer` from backend `0048` and dropped here, which
 * is why three screens searched the catalog and answered with no prices at all.
 *
 * The one distinction worth a test of its own: **an absent offer and an offer
 * with no price are different values and the same nothing on screen.** A scope
 * can carry a product with no number on it, and that is an offer whose `price`
 * is null rather than an absence, so no caller has to know which one it got.
 */
describe('toCatalogItem: the price it used to drop', () => {
  const item = {
    id: 'item-milk-1l',
    name: { es: 'Leche entera', en: 'Whole milk' },
    brand: 'Hacendado',
    unitSize: 1,
    defaultUnit: 'LITER',
    productGroupId: 'group-milk',
    bestOffer: {
      price: 1.05,
      currency: 'EUR',
      unitPrice: 1.05,
      unitPriceLabel: 'EUR/L',
      observedAt: '2026-09-01T08:00:00.000Z',
      sourceKind: 'OFFICIAL_WEB',
      stale: true,
      priceScopeId: 'scope-cordoba',
    },
  };

  it('maps the whole offer, not only the number on it', () => {
    expect(toCatalogItem(item)?.offer).toEqual({
      price: 1.05,
      currency: 'EUR',
      unitPrice: 1.05,
      unitPriceLabel: 'EUR/L',
      observedAt: new Date('2026-09-01T08:00:00.000Z'),
      sourceKind: 'OFFICIAL_WEB',
      // Read off the wire (backend plan 0080, section 5), never inferred.
      stale: true,
      priceScopeId: 'scope-cordoba',
    });
  });

  /**
   * Every product in staging and production, where the harvester is off on
   * purpose, and the row is the row it has always been.
   */
  it('reads an absent offer as no offer', () => {
    expect(toCatalogItem({ ...item, bestOffer: undefined })?.offer).toBeNull();
    expect(toCatalogItem({ ...item, bestOffer: null })?.offer).toBeNull();
  });

  it('keeps an offer whose price is null as an offer', () => {
    const mapped = toCatalogItem({
      ...item,
      bestOffer: { ...item.bestOffer, price: null },
    });

    expect(mapped?.offer).not.toBeNull();
    expect(mapped?.offer?.price).toBeNull();
    expect(mapped?.offer?.priceScopeId).toBe('scope-cordoba');
  });

  it('carries the offer through an item suggestion', () => {
    const mapped = toCatalogSuggestion({ kind: 'item', group: null, item });

    expect(mapped?.kind === 'item' ? mapped.item.offer?.price : null).toBe(
      1.05
    );
  });
});

/**
 * The composer's dropdown, where a group row is only worth drawing because of the
 * products it carries: choosing one adds a line with the group's whole set
 * attached (backend plan 0048, section 1.1).
 *
 * The field names here are the wire's, and that is the point of the test. The
 * mapper read `itemIds` off the offer while nothing on the server ever wrote one,
 * so every group row offered to add zero products and added none.
 */
describe('toCatalogSuggestion', () => {
  const offer = {
    kind: 'group',
    group: {
      group: { id: 'g1', name: { en: 'Milk', es: 'Leche' } },
      cheapestItem: null,
      offer: null,
      itemIds: ['i1', 'i2'],
    },
    item: null,
  };

  it("carries the group's products, which choosing it attaches whole", () => {
    const mapped = toCatalogSuggestion(offer);

    expect(mapped?.kind).toBe('group');
    expect(mapped?.kind === 'group' ? mapped.itemIds : null).toEqual([
      'i1',
      'i2',
    ]);
  });

  it('reads an offer that names no products as an empty set, not a failure', () => {
    // A legitimate suggestion: it adds a line with the group's name and no set,
    // which the line page can fill in later.
    const mapped = toCatalogSuggestion({
      ...offer,
      group: { ...offer.group, itemIds: undefined },
    });

    expect(mapped?.kind === 'group' ? mapped.itemIds : null).toEqual([]);
  });

  it('drops a group suggestion with no group on it', () => {
    expect(toCatalogSuggestion({ ...offer, group: null })).toBeNull();
  });

  it('maps an item suggestion to the one product', () => {
    const mapped = toCatalogSuggestion({
      kind: 'item',
      group: null,
      item: {
        id: 'i1',
        name: { en: 'Milk', es: 'Leche' },
        brand: 'Pascual',
        productGroupId: 'g1',
      },
    });

    expect(mapped?.kind === 'item' ? mapped.item.id : null).toBe('i1');
  });

  const priced = {
    price: 1.05,
    currency: 'EUR',
    unitPrice: 1.05,
    unitPriceLabel: 'EUR/L',
    observedAt: '2026-09-01T08:00:00.000Z',
    sourceKind: 'OFFICIAL_WEB',
    stale: false,
    priceScopeId: 'scope-cordoba',
  };

  it("carries the group's best price, which the row draws labelled", () => {
    const mapped = toCatalogSuggestion({
      ...offer,
      group: { ...offer.group, offer: priced },
    });

    expect(mapped?.kind === 'group' ? mapped.offer?.price : null).toBe(1.05);
  });

  /**
   * **The wire calls a group's price `offer` and an item's `bestOffer`**, and
   * they are the same shape, so a copy paste between the two branches of the
   * mapper produces a null that looks like an unpriced catalog rather than like
   * a mistake. This is the assertion that catches it.
   */
  it('reads only `offer` on a group, never `bestOffer`', () => {
    const mapped = toCatalogSuggestion({
      ...offer,
      group: { ...offer.group, offer: null, bestOffer: priced },
    });

    expect(mapped?.kind === 'group' ? mapped.offer : 'wrong kind').toBeNull();
  });

  /**
   * Every group in a cluster with the harvester off, and any group none of whose
   * members is priced at the reader's scopes. The row is the row it is today.
   */
  it('reads a group with no priced member as no offer', () => {
    const mapped = toCatalogSuggestion(offer);

    expect(mapped?.kind === 'group' ? mapped.offer : 'wrong kind').toBeNull();
  });
});

/**
 * The suggest response as a whole (velista `0101`, backend `0161`): the card
 * names chains, so every offer is resolved against the response's own scope
 * map while the map is in hand.
 */
describe('toCatalogSuggestions', () => {
  const at = (priceScopeId: string, price: number | null, stale = false) => ({
    price,
    currency: 'EUR',
    unitPrice: price,
    unitPriceLabel: 'EUR/L',
    observedAt: '2026-09-20T08:00:00.000Z',
    sourceKind: 'OFFICIAL_WEB',
    stale,
    priceScopeId,
  });
  const chain = (priceScopeId: string, id: string, name: string) => ({
    priceScopeId,
    supermarketId: id,
    supermarketName: { es: name, en: name },
  });
  const milk = {
    id: 'i1',
    name: { es: 'Leche entera', en: 'Whole milk' },
    brand: 'Asturiana',
    imageUrl: 'https://img.example/i1.jpg',
    bestOffer: at('s-merc-1', 1.19),
    offers: [
      at('s-dia', 1.29),
      at('s-merc-2', 1.25),
      at('s-merc-1', 1.19),
      at('s-unknown', 0.5),
      at('s-lidl', null),
    ],
  };
  const body = {
    suggestions: [{ kind: 'item', group: null, item: milk }],
    scopes: [
      chain('s-merc-1', 'mercadona', 'Mercadona'),
      chain('s-merc-2', 'mercadona', 'Mercadona'),
      chain('s-dia', 'dia', 'Dia'),
      chain('s-lidl', 'lidl', 'Lidl'),
    ],
  };

  function chainsOf(mapped: readonly CatalogSuggestion[]): unknown[] {
    const first = mapped[0];
    return first?.kind === 'item'
      ? first.item.chainPrices.map((one) => [one.chain.id, one.offer.price])
      : [];
  }

  it('names one row per chain, cheapest first, a chain keeping its cheapest scope', () => {
    expect(chainsOf(toCatalogSuggestions(body))).toEqual([
      ['mercadona', 1.19],
      ['dia', 1.29],
      ['lidl', null],
    ]);
  });

  it('drops an offer whose scope the map does not name, never guessing a chain', () => {
    const names = chainsOf(toCatalogSuggestions(body)).map(
      (row) => (row as unknown[])[0]
    );
    expect(names).not.toContain(undefined);
    expect(names).toHaveLength(3);
  });

  it('names no chain at all when the map is absent or empty', () => {
    expect(chainsOf(toCatalogSuggestions({ ...body, scopes: [] }))).toEqual([]);
    expect(
      chainsOf(toCatalogSuggestions({ suggestions: body.suggestions }))
    ).toEqual([]);
  });

  it('reads the photograph, and null where there is none', () => {
    const [first] = toCatalogSuggestions(body);
    expect(first?.kind === 'item' ? first.item.imageUrl : 'x').toBe(
      'https://img.example/i1.jpg'
    );
    expect(toCatalogItem({ id: 'i2' })?.imageUrl).toBeNull();
  });

  it("carries a group's members with their chains resolved", () => {
    const [group] = toCatalogSuggestions({
      ...body,
      suggestions: [
        {
          kind: 'group',
          item: null,
          group: {
            group: { id: 'g1', name: { es: 'Leche', en: 'Milk' } },
            itemIds: ['i1', 'i2', 'i3'],
            offer: at('s-merc-1', 1.19),
            members: [milk, { nope: true }],
          },
        },
      ],
    });

    expect(group?.kind).toBe('group');
    if (group?.kind === 'group') {
      expect(group.members.map((one) => one.id)).toEqual(['i1']);
      expect(group.members[0]?.chainPrices[0]?.chain.name.es).toBe('Mercadona');
    }
  });

  it('reads a group with no members as an empty reveal', () => {
    const [group] = toCatalogSuggestions({
      suggestions: [
        {
          kind: 'group',
          item: null,
          group: {
            group: { id: 'g1', name: { es: 'Leche', en: 'Milk' } },
            itemIds: [],
            offer: null,
          },
        },
      ],
    });
    expect(group?.kind === 'group' ? group.members : null).toEqual([]);
  });

  it("reads a group's synonyms, so a card can say which one matched (velista 0108)", () => {
    const [group, older] = toCatalogSuggestions({
      suggestions: [
        {
          kind: 'group',
          item: null,
          group: {
            group: {
              id: 'g1',
              name: { es: 'Discos desmaquillantes', en: 'Cotton Pads' },
              synonyms: { en: ['cotton pads', 7, ' '], es: ['algodón'] },
            },
            itemIds: [],
            offer: null,
          },
        },
        {
          kind: 'group',
          item: null,
          group: {
            group: { id: 'g2', name: { es: 'Leche', en: 'Milk' } },
            itemIds: [],
            offer: null,
          },
        },
      ],
    });
    expect(group?.kind === 'group' ? group.synonyms : null).toEqual({
      en: ['cotton pads'],
      es: ['algodón'],
    });
    // A gateway that sends none reads as a group with none.
    expect(older?.kind === 'group' ? older.synonyms : older).toEqual({
      en: [],
      es: [],
    });
  });

  it('answers nothing for a body that is not a response', () => {
    expect(toCatalogSuggestions(null)).toEqual([]);
    expect(toCatalogSuggestions('oops')).toEqual([]);
  });
});

/** Backend `0162`: how many units a pack holds, a whole number from 2. */
describe('toCatalogItem: the pack count', () => {
  it('reads a whole number from 2 and nothing else', () => {
    expect(toCatalogItem({ id: 'i', packCount: 6 })?.packCount).toBe(6);
    expect(toCatalogItem({ id: 'i', packCount: 1 })?.packCount).toBeNull();
    expect(toCatalogItem({ id: 'i', packCount: 2.5 })?.packCount).toBeNull();
    expect(toCatalogItem({ id: 'i', packCount: '6' })?.packCount).toBeNull();
    expect(toCatalogItem({ id: 'i' })?.packCount).toBeNull();
  });
});

describe('toLineSettlement, what one unit cost (velista 0095, section 7)', () => {
  const RAW = {
    id: 'st-1',
    lineId: 'l-1',
    listId: 'list-1',
    itemId: null,
    outcome: 'BOUGHT',
    quantity: 3,
    settledByUserId: null,
    settledAt: '2026-09-20T10:00:00.000Z',
    revertedAt: null,
    pricePaidCents: 115,
    pricePaidCurrency: 'EUR',
    priceScopeId: 'scope-1',
  };

  it('maps the unit price and its currency', () => {
    const settlement = toLineSettlement(RAW);

    expect(settlement?.unitPriceCents).toBe(115);
    expect(settlement?.currency).toBe('EUR');
  });

  it('maps a price with no currency, or none at all, to two nulls', () => {
    for (const raw of [
      { ...RAW, pricePaidCurrency: null },
      { ...RAW, pricePaidCents: null, pricePaidCurrency: null },
      { ...RAW, pricePaidCents: undefined, pricePaidCurrency: undefined },
    ]) {
      const settlement = toLineSettlement(raw);
      expect(settlement?.unitPriceCents).toBeNull();
      expect(settlement?.currency).toBeNull();
    }
  });
});
