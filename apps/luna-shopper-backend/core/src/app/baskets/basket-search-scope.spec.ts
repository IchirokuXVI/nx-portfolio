import { BasketKind, ParticipantKind } from '@portfolio/luna-shopper/contracts';
import { NotFoundException } from '@portfolio/luna-shopper/platform';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { LineService } from '../lists/line.service';
import type { ProfileService } from '../profiles/profile.service';
import { BasketLineAddService } from './basket-line-add.service';
import type { BasketRow } from './basket-row-resolver';
import type { BasketEntry } from './basket-rows';
import { resolvePick } from './basket-settle.service';
import type { BasketWriteContext } from './basket-write.context';

/**
 * The answer a settle reads its price from (plan 0151, section 1).
 *
 * `basket.searchScope` used to answer only whose basket it is and where it is
 * priced. A settle that names no `itemId` now also sends its lines, and core
 * answers which product those lines record, because core is the service that
 * writes it. These cases hold the answer to the settle's own rule
 * (`resolvePick`), so the gateway prices what is recorded.
 *
 * Since plan 0201 the lines agree on one product or the settle records none,
 * so `optionCount` is 1 or 0 and never more.
 */

const OWNER = 'u-owner';
const BASKET = 'b-1';
const PARTICIPANT = 'p-owner';
const MILK = 'item-milk';
const OAT = 'item-oat';

const entry = (
  lineId: string,
  itemIds: string[],
  over: Partial<BasketEntry> = {}
): BasketEntry =>
  ({
    lineId,
    itemIds,
    quantity: 1,
    content: 'Milk',
    favoriteItemId: null,
    tripItemId: null,
    ...over,
  }) as unknown as BasketEntry;

const rowOf = (...entries: BasketEntry[]): BasketRow =>
  ({ anchor: entries[0], entries }) as BasketRow;

const SHOP = '9a1d73b4-e2c6-4a81-b37d-95f80b2c6e4f';

function build(
  /** The lines the basket draws, by id. */
  lines: Record<string, BasketEntry>,
  basket: { supermarketLocationId?: string | null } = {},
  participant: { kind: ParticipantKind; invitedAt: Date | null } = {
    kind: ParticipantKind.OWNER,
    invitedAt: null,
  }
) {
  const asked: string[][] = [];
  const context = {
    open: jest.fn(async () => ({
      basket: {
        id: BASKET,
        kind: BasketKind.GENERATED,
        ownerUserId: OWNER,
        pricingProfileId: 'prof-home',
        supermarketLocationId: null,
        ...basket,
      },
      participant,
      row: jest.fn(
        async (rowKey: string, lineIds: string[]): Promise<BasketRow> => {
          asked.push([rowKey, ...lineIds]);
          // One refusal for the whole request, as the resolver gives it.
          if (lineIds.some((lineId) => !lines[lineId])) {
            throw new NotFoundException('Row not found');
          }
          return rowOf(...lineIds.map((lineId) => lines[lineId]));
        }
      ),
    })),
  };
  const service = new BasketLineAddService(
    context as unknown as BasketWriteContext,
    {} as LineService,
    {} as ProfileService,
    {} as CoreEventsPublisher
  );
  return { service, asked };
}

describe('basket.searchScope (plan 0151)', () => {
  it('answers no pick, and reads no row, when no row was named', async () => {
    const w = build({});

    const scope = await w.service.searchScope({
      basketId: BASKET,
      participantId: PARTICIPANT,
    });

    expect(scope).toEqual({
      ownerUserId: OWNER,
      profileId: 'prof-home',
      servesLocations: true,
      supermarketLocationId: null,
    });
    expect(w.asked).toEqual([]);
  });

  // Plan 0163, section 5: the settle records the basket's own shop when it
  // names none, and refuses another. It learns the shop here, on the question
  // it already asks, rather than by reading the whole basket.
  it("answers the basket's own shop", async () => {
    const w = build({}, { supermarketLocationId: SHOP });

    const scope = await w.service.searchScope({
      basketId: BASKET,
      participantId: PARTICIPANT,
    });

    expect(scope.supermarketLocationId).toBe(SHOP);
  });

  // Plan 0163, section 4: a link visitor, guest or registered, is served shops,
  // so a settle they make at a shop records it.
  it.each([
    ['a guest', ParticipantKind.GUEST],
    ['a registered link visitor', ParticipantKind.REGISTERED],
  ])('serves shops to %s', async (_name, kind) => {
    const w = build({}, {}, { kind, invitedAt: null });

    const scope = await w.service.searchScope({
      basketId: BASKET,
      participantId: PARTICIPANT,
    });

    expect(scope.servesLocations).toBe(true);
  });

  it('answers the product the named lines agree on', async () => {
    const w = build({
      'l-1': entry('l-1', [MILK]),
      'l-2': entry('l-2', [MILK, OAT]),
    });

    const scope = await w.service.searchScope({
      basketId: BASKET,
      participantId: PARTICIPANT,
      lineIds: ['l-1', 'l-2'],
    });

    expect(scope.pick).toEqual({ pickedItemId: MILK, optionCount: 1 });
    // The first named line is the address, as on the route of a settle.
    expect(w.asked).toEqual([['l-1', 'l-1', 'l-2']]);
  });

  it('answers the favourite of a line that holds several', async () => {
    const w = build({
      'l-1': entry('l-1', [MILK, OAT], { favoriteItemId: OAT }),
    });

    const scope = await w.service.searchScope({
      basketId: BASKET,
      participantId: PARTICIPANT,
      lineIds: ['l-1'],
    });

    expect(scope.pick).toEqual({ pickedItemId: OAT, optionCount: 1 });
  });

  it('answers no product, and none to choose from, when the lines disagree', async () => {
    // Before plan 0201 this row offered two options. A row is one product now,
    // so lines that count as two products were never one row.
    const w = build({
      'l-1': entry('l-1', [MILK]),
      'l-2': entry('l-2', [OAT]),
    });

    const scope = await w.service.searchScope({
      basketId: BASKET,
      participantId: PARTICIPANT,
      lineIds: ['l-1', 'l-2'],
    });

    expect(scope.pick).toEqual({ pickedItemId: null, optionCount: 0 });
  });

  it('answers no product for a free text row', async () => {
    const w = build({ 'l-1': entry('l-1', []) });

    const scope = await w.service.searchScope({
      basketId: BASKET,
      participantId: PARTICIPANT,
      lineIds: ['l-1'],
    });

    expect(scope.pick).toEqual({ pickedItemId: null, optionCount: 0 });
  });

  it('refuses a line outside the basket rather than answering for it', async () => {
    const w = build({ 'l-1': entry('l-1', [MILK]) });

    await expect(
      w.service.searchScope({
        basketId: BASKET,
        participantId: PARTICIPANT,
        lineIds: ['l-1', 'l-elsewhere'],
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('resolvePick (plan 0201, section 4)', () => {
  it('records a named product as named, also one that is on no line', () => {
    // A change "for this trip only". The gateway refuses an id the catalog
    // does not know before core is asked.
    const row = rowOf(entry('l-1', [MILK]));

    expect(resolvePick(row, OAT)).toBe(OAT);
    expect(resolvePick(rowOf(entry('l-1', [])), OAT)).toBe(OAT);
  });

  it('records the one product the lines agree on when none is named', () => {
    expect(
      resolvePick(
        rowOf(entry('l-1', [MILK]), entry('l-2', [MILK, OAT])),
        undefined
      )
    ).toBe(MILK);
  });

  it('counts a line with several products and no favourite as its first', () => {
    // Core holds no price, so it cannot name the cheapest. A client that drew
    // another product sends it.
    expect(resolvePick(rowOf(entry('l-1', [OAT, MILK])), undefined)).toBe(OAT);
  });

  it('follows the product the line was already bought as in this trip', () => {
    expect(
      resolvePick(rowOf(entry('l-1', [MILK], { tripItemId: OAT })), undefined)
    ).toBe(OAT);
  });

  it('records none when the lines disagree', () => {
    expect(
      resolvePick(rowOf(entry('l-1', [MILK]), entry('l-2', [OAT])), undefined)
    ).toBeNull();
    // A line with a product and a line with none do not agree either.
    expect(
      resolvePick(rowOf(entry('l-1', [MILK]), entry('l-2', [])), undefined)
    ).toBeNull();
  });

  it('records none for lines with no product', () => {
    expect(
      resolvePick(rowOf(entry('l-1', []), entry('l-2', [])), undefined)
    ).toBeNull();
  });
});
