import {
  GeneratedLineOrigin,
  GeneratedListStatus,
  ParticipantKind,
  RealtimeEvent,
  type GeneratedListBasketLineView,
} from '@portfolio/luna-shopper/contracts';
import {
  GeneratedListFinishedException,
  UnauthorizedException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import type {
  GeneratedList,
  GeneratedListLine,
  GeneratedListParticipant,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { GeneratedListBasketService } from './generated-list-basket.service';
import type { GeneratedListLineService } from './generated-list-line.service';
import type { GeneratedListSharingService } from './generated-list-sharing.service';
import type { GeneratedListService } from './generated-list.service';

/**
 * Adding a line to a shared basket, as any live participant (plan 0055,
 * section 3).
 *
 * The basket is the thing somebody carries around a shop, and until this plan
 * the one thing they could not do with it was put something in it. Every write
 * on the participant surface settled a line that was already there or swapped
 * its product, and creating one was on the owner's account surface, resolved by
 * `ownerUserId`, which cannot answer a guest at all.
 *
 * ## The property this file exists to pin
 *
 * **A guest's line never reaches a household.** It is created `ADDED` with no
 * target, so it changes nothing shared, and the basket's `defaultTargetListId`
 * is applied for the owner and for nobody else (section 3.2). That is the rule
 * plan 0050 section 5 protects, and the way it breaks is silent: a guest types
 * "batteries", a household's shopping list quietly grows a line under the
 * owner's name, and nothing on anybody's screen says where it came from.
 */

const OWNER = 'u-owner';
const BASKET = 'gl-1';
const TARGET_LIST = 'l-flat';
const OWNER_PARTICIPANT = 'p-owner';
const GUEST_PARTICIPANT = 'p-guest';

interface Harness {
  service: GeneratedListBasketService;
  /** Every line handed to the repository's `save`, in order. */
  saved: Partial<GeneratedListLine>[];
  /** Option rows inserted beside a created line. */
  inserted: { generatedListLineId: string; itemId: string }[];
  /** Every promotion into a zone list, which a guest must never cause. */
  promotions: { userId: string; targetListId: string }[];
  events: { event: RealtimeEvent; generatedListId?: string }[];
}

function build(
  options: {
    status?: GeneratedListStatus;
    defaultTargetListId?: string | null;
    /** The acting participant, or null for one that has been revoked. */
    participant?: Partial<GeneratedListParticipant> | null;
    lineCount?: number;
    profileId?: string | null;
  } = {}
): Harness {
  const list = {
    id: BASKET,
    ownerUserId: OWNER,
    name: null,
    status: options.status ?? GeneratedListStatus.ACTIVE,
    generatedAt: new Date('2026-09-01T10:00:00.000Z'),
    sourceSnapshot: {
      profileId: options.profileId === undefined ? null : options.profileId,
      sources: [],
    },
    defaultTargetListId: options.defaultTargetListId ?? null,
    idempotencyKey: null,
  } as GeneratedList;

  const participant =
    options.participant === null
      ? null
      : ({
          id: GUEST_PARTICIPANT,
          generatedListId: BASKET,
          kind: ParticipantKind.GUEST,
          userId: null,
          revokedAt: null,
          ...options.participant,
        } as GeneratedListParticipant);

  const saved: Harness['saved'] = [];
  const inserted: Harness['inserted'] = [];
  const promotions: Harness['promotions'] = [];
  const events: Harness['events'] = [];

  const lineRepo = {
    findOne: async () => null,
    create: (data: Partial<GeneratedListLine>) => ({ ...data }),
    save: async (row: Partial<GeneratedListLine>) => {
      const stored = { ...row, id: row.id ?? 'gll-new' };
      saved.push(stored);
      return stored;
    },
    count: async () => options.lineCount ?? 0,
    createQueryBuilder: () => ({
      select: () => ({
        where: () => ({ getRawOne: async () => ({ max: '4' }) }),
      }),
    }),
  };

  const optionRepo = {
    findOne: async () => null,
    insert: async (rows: Harness['inserted']) => {
      inserted.push(...rows);
    },
  };

  const generated = {
    // The view is not what this file is about; the row that was written is.
    basketLineViewFor: async (row: GeneratedListLine) =>
      ({ id: row.id }) as GeneratedListBasketLineView,
  } as unknown as GeneratedListService;

  const sharing = {
    liveParticipantById: async () => participant,
    seesZoneData: async () => false,
  } as unknown as GeneratedListSharingService;

  const lineWrites = {
    promote: async (
      userId: string,
      _line: GeneratedListLine,
      targetListId: string
    ) => {
      promotions.push({ userId, targetListId });
    },
  } as unknown as GeneratedListLineService;

  const publisher = {
    emitToGeneratedList: (event: RealtimeEvent, generatedListId: string) => {
      events.push({ event, generatedListId });
    },
  } as unknown as CoreEventsPublisher;

  const service = new GeneratedListBasketService(
    { findOne: async () => list } as never,
    lineRepo as never,
    optionRepo as never,
    {} as never,
    generated,
    sharing,
    lineWrites,
    publisher
  );

  return { service, saved, inserted, promotions, events };
}

function add(
  harness: Harness,
  overrides: Partial<{
    content: string;
    quantity: number;
    itemId: string;
    options: string[];
    participantId: string;
  }> = {}
) {
  return harness.service.addLine({
    generatedListId: BASKET,
    participantId: overrides.participantId ?? GUEST_PARTICIPANT,
    content: overrides.content ?? 'Milk',
    quantity: overrides.quantity,
    itemId: overrides.itemId,
    options: overrides.options,
  });
}

describe('a participant adds a line (section 3)', () => {
  it('creates it in the basket alone: ADDED, no target, nothing settled', async () => {
    const harness = build();
    await add(harness);

    expect(harness.saved).toHaveLength(1);
    expect(harness.saved[0]).toMatchObject({
      generatedListId: BASKET,
      content: 'Milk',
      quantity: 1,
      settledQuantity: 0,
      origin: GeneratedLineOrigin.ADDED,
      targetListId: null,
    });
  });

  it('puts it at the end of the basket, where a line just typed belongs', async () => {
    const harness = build();
    await add(harness);
    expect(harness.saved[0].position).toBe(5);
  });

  it('trims the content and defaults the quantity to one', async () => {
    const harness = build();
    await add(harness, { content: '  Bread  ' });

    expect(harness.saved[0].content).toBe('Bread');
    expect(harness.saved[0].quantity).toBe(1);
  });

  it('takes a quantity and a pick when the composer offered one', async () => {
    const harness = build();
    await add(harness, { quantity: 3, itemId: 'item-1' });

    expect(harness.saved[0].quantity).toBe(3);
    expect(harness.saved[0].itemId).toBe('item-1');
  });

  it('attaches the product set a group suggestion carries', async () => {
    const harness = build();
    await add(harness, { options: ['item-1', 'item-2', 'item-1'] });

    // Deduplicated, because a group can name the same product twice and a line
    // offering one product twice is a dropdown with a repeated row.
    expect(harness.inserted).toHaveLength(2);
    expect(harness.inserted.map((row) => row.itemId)).toEqual([
      'item-1',
      'item-2',
    ]);
  });

  it('appends rather than replaces, on its own event', async () => {
    // Reusing `lineUpdated` was considered and dropped (section 8): a client
    // receiving it has to decide whether to replace a row or append one, and
    // that decision is exactly what the event name is for.
    const harness = build();
    await add(harness);

    expect(harness.events).toEqual([
      {
        event: RealtimeEvent.GeneratedListLineAdded,
        generatedListId: BASKET,
      },
    ]);
  });

  it('refuses a line with no text, naming the field', async () => {
    const harness = build();
    await expect(add(harness, { content: '   ' })).rejects.toBeInstanceOf(
      ValidationException
    );
  });

  it('refuses a quantity of zero, which is not a thing anybody adds', async () => {
    const harness = build();
    await expect(add(harness, { quantity: 0 })).rejects.toBeInstanceOf(
      ValidationException
    );
  });

  it('refuses more options than a line may offer (section 7)', async () => {
    const harness = build();
    const tooMany = Array.from({ length: 60 }, (_, i) => `item-${i}`);
    await expect(add(harness, { options: tooMany })).rejects.toBeInstanceOf(
      ValidationException
    );
  });

  it('refuses a basket that is already full, which is what caps the damage', async () => {
    const harness = build({ lineCount: 500 });
    await expect(add(harness)).rejects.toBeInstanceOf(ValidationException);
  });
});

describe('who put this here (section 4)', () => {
  it('records the participant who added it', async () => {
    const harness = build();
    await add(harness);
    expect(harness.saved[0].createdByParticipantId).toBe(GUEST_PARTICIPANT);
  });

  it('records the actor and not the owner, when a guest adds it', async () => {
    // The column has to name the person in the shop rather than the account the
    // basket belongs to, or a line nobody recognises has no answer at all.
    const harness = build();
    await add(harness);
    expect(harness.saved[0].createdByParticipantId).not.toBe(OWNER_PARTICIPANT);
  });

  it('leaves the last editor unset, because nobody has touched it yet', async () => {
    // The two columns answer different questions and this is the moment they
    // are furthest apart: the line has an author and no editor.
    const harness = build();
    await add(harness);
    expect(harness.saved[0].lastEditedByParticipantId).toBeUndefined();
  });
});

describe("the basket's default target is the owner's alone (section 3.2)", () => {
  it('never promotes a guest’s line, whatever the basket is configured to do', async () => {
    // The accident plan 0050 section 5 exists to prevent, arriving through the
    // back door: a zone write the guest cannot see, cannot explain and did not
    // ask for, made under the owner's access.
    const harness = build({ defaultTargetListId: TARGET_LIST });
    await add(harness);

    expect(harness.promotions).toEqual([]);
    expect(harness.saved[0].targetListId).toBeNull();
  });

  it('never promotes a registered participant’s line either', async () => {
    // They can bind one on purpose through plan 0058, which is a gesture with a
    // list picker in front of it, and that is the honest way for it to land.
    const harness = build({
      defaultTargetListId: TARGET_LIST,
      participant: { kind: ParticipantKind.REGISTERED, userId: 'u-flatmate' },
    });
    await add(harness);

    expect(harness.promotions).toEqual([]);
  });

  it('promotes the owner’s line, as it does on their own surface', async () => {
    const harness = build({
      defaultTargetListId: TARGET_LIST,
      participant: {
        id: OWNER_PARTICIPANT,
        kind: ParticipantKind.OWNER,
        userId: OWNER,
      },
    });
    await add(harness, { participantId: OWNER_PARTICIPANT });

    // Through the ordinary write back and under the owner's own access, so
    // `WRITE` is checked at this moment like every other promotion.
    expect(harness.promotions).toEqual([
      { userId: OWNER, targetListId: TARGET_LIST },
    ]);
  });

  it('promotes nothing for the owner when the basket names no default', async () => {
    const harness = build({
      participant: {
        id: OWNER_PARTICIPANT,
        kind: ParticipantKind.OWNER,
        userId: OWNER,
      },
    });
    await add(harness, { participantId: OWNER_PARTICIPANT });
    expect(harness.promotions).toEqual([]);
  });
});

describe('a basket that is finished takes no new lines (section 3.3)', () => {
  it('refuses a COMPLETED basket with a code the client can explain', async () => {
    const harness = build({ status: GeneratedListStatus.COMPLETED });
    await expect(add(harness)).rejects.toBeInstanceOf(
      GeneratedListFinishedException
    );
  });

  it('refuses an ARCHIVED one the same way', async () => {
    const harness = build({ status: GeneratedListStatus.ARCHIVED });
    await expect(add(harness)).rejects.toBeInstanceOf(
      GeneratedListFinishedException
    );
  });

  it('writes nothing when it refuses', async () => {
    const harness = build({ status: GeneratedListStatus.COMPLETED });
    await expect(add(harness)).rejects.toBeInstanceOf(
      GeneratedListFinishedException
    );
    expect(harness.saved).toEqual([]);
    expect(harness.events).toEqual([]);
  });

  it('accepts a DRAFT, which is a basket nobody has started shopping', async () => {
    const harness = build({ status: GeneratedListStatus.DRAFT });
    await add(harness);
    expect(harness.saved).toHaveLength(1);
  });
});

describe('a revoked participant is refused on their next action', () => {
  it('refuses the add, because the row is read live and not cached', async () => {
    const harness = build({ participant: null });
    await expect(add(harness)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(harness.saved).toEqual([]);
  });

  it('refuses the search too, so a revoked link is not a catalog proxy', async () => {
    const harness = build({ participant: null });
    await expect(
      harness.service.searchScope({
        generatedListId: BASKET,
        participantId: GUEST_PARTICIPANT,
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('where a search inside the basket is priced (section 5.1)', () => {
  it('answers the run’s profile, never the caller’s', async () => {
    const harness = build({ profileId: 'sp-1' });
    const scope = await harness.service.searchScope({
      generatedListId: BASKET,
      participantId: GUEST_PARTICIPANT,
    });

    expect(scope).toEqual({ ownerUserId: OWNER, profileId: 'sp-1' });
  });

  it('answers no profile when the run named its sources outright', async () => {
    // Section 5.1's third row, and the fallback rather than an error: the search
    // runs unscoped and comes back with products and no prices.
    const harness = build({ profileId: null });
    const scope = await harness.service.searchScope({
      generatedListId: BASKET,
      participantId: GUEST_PARTICIPANT,
    });

    expect(scope.profileId).toBeNull();
  });
});
