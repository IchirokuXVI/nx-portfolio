import { BasketKind, ParticipantKind } from '@portfolio/luna-shopper/contracts';
import { NotFoundException } from '@portfolio/luna-shopper/platform';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { LineService } from '../lists/line.service';
import type { ProfileService } from '../profiles/profile.service';
import { BasketLineAddService } from './basket-line-add.service';
import type { BasketEntry, BasketRow } from './basket-row-resolver';
import type { BasketWriteContext } from './basket-write.context';

/**
 * The answer a settle reads its price from (plan 0151, section 1).
 *
 * `basket.searchScope` used to answer only whose basket it is and where it is
 * priced. A settle that names no `itemId` now also sends the row, and core
 * answers which product that row records, because core is the service that
 * writes it. These cases hold the answer to the settle's own rule
 * (`resolvePick`), so the gateway prices what is recorded.
 */

const OWNER = 'u-owner';
const BASKET = 'b-1';
const PARTICIPANT = 'p-owner';
const MILK = 'item-milk';
const OAT = 'item-oat';

const entry = (lineId: string, itemIds: string[]): BasketEntry =>
  ({ lineId, itemIds, quantity: 1 }) as unknown as BasketEntry;

function build(rows: Record<string, BasketEntry[]>) {
  const asked: string[] = [];
  const context = {
    open: jest.fn(async () => ({
      basket: {
        id: BASKET,
        kind: BasketKind.GENERATED,
        ownerUserId: OWNER,
        pricingProfileId: 'prof-home',
      },
      participant: { kind: ParticipantKind.OWNER, invitedAt: null },
      row: jest.fn(async (rowKey: string): Promise<BasketRow> => {
        asked.push(rowKey);
        const entries = rows[rowKey];
        if (!entries) {
          throw new NotFoundException('Row not found');
        }
        return { key: rowKey, anchor: entries[0], entries } as BasketRow;
      }),
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
    });
    expect(w.asked).toEqual([]);
  });

  it('answers the only product of a row with one option', async () => {
    const w = build({ 'row-1': [entry('l-1', [MILK]), entry('l-2', [MILK])] });

    const scope = await w.service.searchScope({
      basketId: BASKET,
      participantId: PARTICIPANT,
      rowKey: 'row-1',
    });

    expect(scope.pick).toEqual({ pickedItemId: MILK, optionCount: 1 });
  });

  it('answers no product, and how many there are, for a row with several', async () => {
    const w = build({ 'row-1': [entry('l-1', [MILK]), entry('l-2', [OAT])] });

    const scope = await w.service.searchScope({
      basketId: BASKET,
      participantId: PARTICIPANT,
      rowKey: 'row-1',
    });

    expect(scope.pick).toEqual({ pickedItemId: null, optionCount: 2 });
  });

  it('answers no product for a free text row', async () => {
    const w = build({ 'row-1': [entry('l-1', [])] });

    const scope = await w.service.searchScope({
      basketId: BASKET,
      participantId: PARTICIPANT,
      rowKey: 'row-1',
    });

    expect(scope.pick).toEqual({ pickedItemId: null, optionCount: 0 });
  });

  it('refuses a row outside the basket rather than answering for it', async () => {
    const w = build({});

    await expect(
      w.service.searchScope({
        basketId: BASKET,
        participantId: PARTICIPANT,
        rowKey: 'row-elsewhere',
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
