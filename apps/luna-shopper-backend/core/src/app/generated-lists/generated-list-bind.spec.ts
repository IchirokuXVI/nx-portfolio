import {
  GeneratedLineOrigin,
  GeneratedListStatus,
  LineApprovalStatus,
  ParticipantKind,
  RealtimeEvent,
  type LineView,
} from '@portfolio/luna-shopper/contracts';
import { DomainException } from '@portfolio/luna-shopper/platform';
import type { GeneratedListLine } from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { GeneratedListBindService } from './generated-list-bind.service';
import type { GeneratedListLineService } from './generated-list-line.service';
import type { GeneratedListSharingService } from './generated-list-sharing.service';
import type { GeneratedListService } from './generated-list.service';
import { fakeLineClaims, type FakeLineClaims } from './line-claims.fake';

/**
 * Binding an added basket line to a shopping list (plan 0058).
 *
 * The property this file exists to pin is section 4.1, and it is asserted on
 * every write case rather than once: **the zone line is created with what is
 * outstanding, and nothing is backfilled.** A binding that asked the household
 * for units already in the cupboard is the failure this plan is most likely to
 * ship with, because the obvious implementation passes the basket line's own
 * quantity and looks right in every test where nothing has been bought yet.
 *
 * Faked at the collaborator boundary in the style the origins spec established:
 * the write back is the real service's contract, stubbed, because the whole
 * point of this plan is that it reuses that path rather than writing zone rows
 * of its own. What is asserted about it is what it was **called with**.
 */

const OWNER = 'u-owner';
const CO_SHOPPER = 'u-marc';
const OWNER_PARTICIPANT = 'p-owner';
const BASKET = 'gl-1';
const BASKET_LINE = 'gll-1';
const CREATED_LINE = 'zl-new';

const LIST_A = 'l-flat';
const ZONE_A = 'z-flat';
const LIST_B = 'l-parents';
const ZONE_B = 'z-parents';
const LIST_C = 'l-office';
const ZONE_C = 'z-office';

const ZONE_OF_LIST: Record<string, string> = {
  [LIST_A]: ZONE_A,
  [LIST_B]: ZONE_B,
  [LIST_C]: ZONE_C,
};

interface PromoteCall {
  userId: string;
  targetListId: string;
  quantity: number | undefined;
}

interface Harness {
  service: GeneratedListBindService;
  basketLine: Partial<GeneratedListLine>;
  promoted: PromoteCall[];
  claims: FakeLineClaims;
  events: { event: RealtimeEvent; id?: string; payload?: unknown }[];
}

function build(
  options: {
    quantity?: number;
    settledQuantity?: number;
    origin?: GeneratedLineOrigin;
    targetListId?: string | null;
    status?: GeneratedListStatus;
    /** Which lists each user may write, at request time (section 3.1). */
    writable?: Record<string, string[]>;
    /** The (zone, list) pairs the run drew from. */
    sources?: string[];
    /** Lists that cannot be named, so a caption falls back to null. */
    unnamed?: string[];
    actorUserId?: string;
    actorKind?: ParticipantKind;
    seesZoneData?: boolean;
    /** What the ordinary add path decided about approval (section 4.3). */
    approvalStatus?: LineApprovalStatus;
  } = {}
): Harness {
  const basketLine: Partial<GeneratedListLine> = {
    id: BASKET_LINE,
    generatedListId: BASKET,
    content: 'batteries',
    quantity: options.quantity ?? 4,
    settledQuantity: options.settledQuantity ?? 0,
    itemId: null,
    origin: options.origin ?? GeneratedLineOrigin.ADDED,
    targetListId: options.targetListId ?? null,
  };

  const writable = options.writable ?? {
    [OWNER]: [LIST_A, LIST_B, LIST_C],
    [CO_SHOPPER]: [LIST_A, LIST_B, LIST_C],
  };
  const unnamed = new Set(options.unnamed ?? []);
  const sources = options.sources ?? [LIST_A];
  const events: Harness['events'] = [];
  const promoted: PromoteCall[] = [];

  const lists = {
    findOne: async () => ({
      id: BASKET,
      ownerUserId: OWNER,
      status: options.status ?? GeneratedListStatus.ACTIVE,
      sourceSnapshot: {
        profileId: null,
        sources: sources.map((listId) => ({
          listId,
          zoneId: ZONE_OF_LIST[listId],
        })),
      },
    }),
  };

  const shoppingLists = {
    find: async ({ where }: { where: { id: { _value: string[] } } }) =>
      where.id._value
        .filter((id) => !unnamed.has(id))
        .map((id) => ({
          id,
          name: `${id} list`,
          zone: { name: `${id} zone` },
        })),
  };

  const sees = options.seesZoneData ?? true;
  const actorUserId = options.actorUserId ?? OWNER;
  const sharing = {
    liveParticipantById: async () => ({
      id: OWNER_PARTICIPANT,
      kind: options.actorKind ?? ParticipantKind.OWNER,
      userId: sees ? actorUserId : null,
    }),
    seesZoneData: async () => sees,
    writableAmong: async (userId: string, listIds: readonly string[]) =>
      new Set(
        listIds.filter((listId) => (writable[userId] ?? []).includes(listId))
      ),
    writableIntersection: async (ownerUserId: string, actor: string) => {
      const owned = writable[ownerUserId] ?? [];
      const actors = new Set(writable[actor] ?? []);
      return owned
        .filter((listId) => ownerUserId === actor || actors.has(listId))
        .map((listId) => ({ listId, zoneId: ZONE_OF_LIST[listId] }));
    },
  } as unknown as GeneratedListSharingService;

  const generated = {
    basketLineViewFor: async (
      _line: unknown,
      seesZoneData: boolean
    ): Promise<unknown> => ({
      id: BASKET_LINE,
      quantity: basketLine.quantity,
      settledQuantity: basketLine.settledQuantity,
      ...(seesZoneData ? { targetListId: basketLine.targetListId } : {}),
    }),
  } as unknown as GeneratedListService;

  const lineWrites = {
    promote: async (
      userId: string,
      line: GeneratedListLine,
      targetListId: string,
      promoteOptions: { quantity?: number } = {}
    ) => {
      promoted.push({
        userId,
        targetListId,
        quantity: promoteOptions.quantity,
      });
      // The real one sets the target and saves before it returns, and the write
      // that follows reads the line back through the view, so the stub has to
      // leave the row in the same state or the response would describe a line
      // that was never written.
      line.targetListId = targetListId;
      const created: Partial<LineView> = {
        id: CREATED_LINE,
        listId: targetListId,
        quantity: promoteOptions.quantity ?? line.quantity,
        approvalStatus: options.approvalStatus ?? LineApprovalStatus.PENDING,
      };
      return {
        line: created as LineView,
        zoneId: ZONE_OF_LIST[targetListId],
        quantity: promoteOptions.quantity ?? line.quantity,
      };
    },
  } as unknown as GeneratedListLineService;

  const claims = fakeLineClaims();

  const service = new GeneratedListBindService(
    lists as never,
    { findOne: async () => basketLine } as never,
    shoppingLists as never,
    sharing,
    generated,
    lineWrites,
    claims.service,
    {
      emit: (event: RealtimeEvent, id: string, payload: unknown) =>
        events.push({ event, id, payload }),
      emitToGeneratedList: (
        event: RealtimeEvent,
        id: string,
        payload: unknown
      ) => events.push({ event, id, payload }),
      emitToUsers: (event: RealtimeEvent) => events.push({ event }),
    } as unknown as CoreEventsPublisher
  );

  return { service, basketLine, promoted, claims, events };
}

function read(harness: Harness) {
  return harness.service.lineTargets({
    generatedListId: BASKET,
    lineId: BASKET_LINE,
    participantId: OWNER_PARTICIPANT,
  });
}

function bind(harness: Harness, listId: string) {
  return harness.service.bindLine({
    generatedListId: BASKET,
    lineId: BASKET_LINE,
    participantId: OWNER_PARTICIPANT,
    listId,
  });
}

/** The code a refusal carried, which is what the client branches on. */
async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as DomainException).code;
  }
  throw new Error('expected a refusal');
}

describe('which lists a line may be sent to (plan 0058, section 3)', () => {
  it('offers every list the owner can write, with the run’s own flagged', async () => {
    const harness = build({ sources: [LIST_A] });

    const result = await read(harness);

    expect(result.targets.map((row) => row.listId).sort()).toEqual(
      [LIST_A, LIST_B, LIST_C].sort()
    );
    // The flag is the whole ergonomics of the picker: the line was remembered
    // while shopping for the lists this basket came from, so the client draws
    // those first. It is a fact and never an order.
    expect(result.targets.find((row) => row.listId === LIST_A)?.fromRun).toBe(
      true
    );
    expect(result.targets.find((row) => row.listId === LIST_C)?.fromRun).toBe(
      false
    );
  });

  it('offers a zone the run never heard of, which is an ordinary answer', async () => {
    // Section 3.1: any list the actor can write, not only the ones the run drew
    // from. Somebody in the shop remembering something for the office is the
    // case, and the office was never part of this basket.
    const harness = build({ sources: [LIST_A] });

    const result = await read(harness);

    const office = result.targets.find((row) => row.listId === LIST_C);
    expect(office).toBeDefined();
    expect(office?.zoneId).toBe(ZONE_C);
  });

  it('names each list and its zone, so two lists called Food can be told apart', async () => {
    const harness = build();

    const result = await read(harness);

    const flat = result.targets.find((row) => row.listId === LIST_A);
    expect(flat?.listName).toBe(`${LIST_A} list`);
    expect(flat?.zoneName).toBe(`${LIST_A} zone`);
  });

  it('leaves a name null rather than inventing one', async () => {
    // A list that went between the scope read and the naming read. The ordinary
    // way a set of ids outruns its captions, not an error.
    const harness = build({ unnamed: [LIST_B] });

    const result = await read(harness);

    const parents = result.targets.find((row) => row.listId === LIST_B);
    expect(parents?.listName).toBeNull();
    expect(parents?.zoneName).toBeNull();
  });

  it('gives a co-shopper the intersection of their access and the owner’s', async () => {
    // Section 3.1's narrowing, and the only case it bites on. A list the owner
    // cannot write would give the household a line every later settle skips.
    const harness = build({
      actorUserId: CO_SHOPPER,
      actorKind: ParticipantKind.REGISTERED,
      writable: {
        [OWNER]: [LIST_A, LIST_B],
        [CO_SHOPPER]: [LIST_B, LIST_C],
      },
    });

    const result = await read(harness);

    expect(result.targets.map((row) => row.listId)).toEqual([LIST_B]);
  });

  it('refuses a guest, who must never be told which household a line belongs to', async () => {
    const harness = build({
      seesZoneData: false,
      actorKind: ParticipantKind.GUEST,
    });

    expect(await codeOf(read(harness))).toBe('forbidden');
  });

  it('refuses a DERIVED line rather than offering a picker that can only fail', async () => {
    const harness = build({ origin: GeneratedLineOrigin.DERIVED });

    expect(await codeOf(read(harness))).toBe('validation_failed');
  });

  it('refuses a line that already has a target', async () => {
    const harness = build({ targetListId: LIST_A });

    expect(await codeOf(read(harness))).toBe('conflict');
  });

  it('answers for a finished basket, because reading one is not writing to it', async () => {
    // The status is a write precondition (section 4) and this read is not it.
    const harness = build({ status: GeneratedListStatus.COMPLETED });

    const result = await read(harness);

    expect(result.targets.length).toBe(3);
  });
});

describe('sending an added line to a list (plan 0058, section 4)', () => {
  it('creates the zone line through the ordinary write back and claims it', async () => {
    const harness = build();

    const result = await bind(harness, LIST_A);

    // Nothing here writes a zone row of its own: the whole plan is a picker and
    // a set of preconditions in front of the path plan 0050 already had.
    expect(harness.promoted).toEqual([
      { userId: OWNER, targetListId: LIST_A, quantity: 4 },
    ]);
    expect(result.createdLineId).toBe(CREATED_LINE);
    expect(result.zoneId).toBe(ZONE_A);
    // The household's list says somebody is out buying it (plan 0051, 5.3),
    // named as the owner and never as the actor (plan 0052, section 2).
    expect(harness.claims.announced).toEqual([
      {
        zoneId: ZONE_A,
        listId: LIST_A,
        lineId: CREATED_LINE,
        claimed: true,
        claimedByUserId: OWNER,
      },
    ]);
  });

  it('tells the basket’s room the line moved', async () => {
    const harness = build();

    await bind(harness, LIST_A);

    const announced = harness.events.filter(
      (row) => row.event === RealtimeEvent.GeneratedListLineUpdated
    );
    expect(announced.length).toBe(1);
    expect(announced[0].id).toBe(BASKET);
  });

  it('asks the household for what is outstanding, not for the whole line', async () => {
    // Section 4.1, and the property this file exists for. Four batteries, three
    // already bought: the flat is being asked for one, because the other three
    // are in the cupboard.
    const harness = build({ quantity: 4, settledQuantity: 3 });

    const result = await bind(harness, LIST_A);

    expect(harness.promoted[0].quantity).toBe(1);
    expect(result.quantity).toBe(1);
  });

  it('creates a line at zero when everything was already bought', async () => {
    // Plan 0047 section 2.2's line rather than a degenerate case: the household
    // now knows about batteries, does not currently need any, and keeps the
    // history from here on. No settlement is backfilled for the units bought
    // before the binding (section 4.1).
    const harness = build({ quantity: 4, settledQuantity: 4 });

    const result = await bind(harness, LIST_A);

    expect(result.quantity).toBe(0);
    expect(harness.promoted[0].quantity).toBe(0);
  });

  it('says when the line is waiting for the household to approve it', async () => {
    // Section 4.3. An add does not approve itself, and a reader who is not told
    // will believe their line landed when it is waiting to be agreed to.
    const harness = build({ approvalStatus: LineApprovalStatus.PENDING });

    expect((await bind(harness, LIST_A)).pendingApproval).toBe(true);
  });

  it('says when the list approved it, because the list auto approves', async () => {
    const harness = build({ approvalStatus: LineApprovalStatus.APPROVED });

    expect((await bind(harness, LIST_A)).pendingApproval).toBe(false);
  });

  it('creates the line under the account that bound it, not the owner’s', async () => {
    // Section 6: a household's list may name only accounts, and the account that
    // said which list is the honest author. The guest's typed name stays in the
    // basket, where it belongs.
    const harness = build({
      actorUserId: CO_SHOPPER,
      actorKind: ParticipantKind.REGISTERED,
    });

    await bind(harness, LIST_A);

    expect(harness.promoted[0].userId).toBe(CO_SHOPPER);
    // The claim is still the basket's, so it is still named as the owner.
    expect(harness.claims.announced[0].claimedByUserId).toBe(OWNER);
  });

  it('records who bound it on the basket line', async () => {
    const harness = build();

    await bind(harness, LIST_A);

    expect(harness.basketLine.lastEditedByParticipantId).toBe(
      OWNER_PARTICIPANT
    );
  });

  it('refuses a second binding, because binding is once', async () => {
    // Section 4.2. Setting a target twice does not create two lines, and the
    // gesture has no inverse: clearing it would not delete the line it created.
    const harness = build({ targetListId: LIST_A });

    expect(await codeOf(bind(harness, LIST_B))).toBe('conflict');
    expect(harness.promoted).toEqual([]);
  });

  it('refuses a DERIVED line with a code that says why', async () => {
    // It is already in the lists its origins name, so giving it a target would
    // ask a shared list for a second copy of a line it already holds.
    const harness = build({ origin: GeneratedLineOrigin.DERIVED });

    expect(await codeOf(bind(harness, LIST_A))).toBe('validation_failed');
    expect(harness.promoted).toEqual([]);
  });

  it('refuses a finished basket with its own code', async () => {
    const harness = build({ status: GeneratedListStatus.COMPLETED });

    expect(await codeOf(bind(harness, LIST_A))).toBe('generated_list_finished');
    expect(harness.promoted).toEqual([]);
  });

  it('refuses a guest, who is never told which lists exist', async () => {
    const harness = build({
      seesZoneData: false,
      actorKind: ParticipantKind.GUEST,
    });

    expect(await codeOf(bind(harness, LIST_A))).toBe('forbidden');
    expect(harness.promoted).toEqual([]);
  });

  it('refuses a list the owner may no longer write, at request time', async () => {
    // Not at settle time, which is the point. Binding creates an origin, and
    // every settle on it is authorized by the owner's access: a list they cannot
    // write would be skipped on every purchase for the life of the basket.
    const harness = build({
      writable: { [OWNER]: [LIST_B], [CO_SHOPPER]: [LIST_A, LIST_B] },
    });

    expect(await codeOf(bind(harness, LIST_A))).toBe('forbidden');
    expect(harness.promoted).toEqual([]);
  });

  it('refuses a list the actor may not write, even when the owner may', async () => {
    const harness = build({
      actorUserId: CO_SHOPPER,
      actorKind: ParticipantKind.REGISTERED,
      writable: { [OWNER]: [LIST_A, LIST_B], [CO_SHOPPER]: [LIST_B] },
    });

    expect(await codeOf(bind(harness, LIST_A))).toBe('forbidden');
    expect(harness.promoted).toEqual([]);
  });
});
