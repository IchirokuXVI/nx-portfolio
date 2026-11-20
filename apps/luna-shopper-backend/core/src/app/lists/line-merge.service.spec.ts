import {
  LINE_ITEM_SET_MAX,
  LineApprovalStatus,
  ListPermission,
} from '@portfolio/luna-shopper/contracts';
import { ERROR_CODES } from '@portfolio/luna-shopper/platform';
import type { EntityManager } from 'typeorm';
import { ListLine, type ShoppingList } from '../entities';
import { fakeLineChanges } from './changes/line-change.fake';
import {
  assertMergeFits,
  isEarlierLine,
  LineMergeService,
  mergedChoices,
  mergedItemIds,
} from './line-merge.service';
import { LineService } from './line.service';

/**
 * The three decisions a merge makes before it touches a row (plan 0112).
 *
 * What the merge then moves between tables is proven against Postgres in
 * `line-rename-merge.integration.spec.ts`, because a mock has no cascade and no
 * unique key to violate. These are the parts that are pure.
 */
describe('which line survives a merge (plan 0112, section 3)', () => {
  it('is the earlier by position', () => {
    expect(
      isEarlierLine({ position: 1, id: 'b' }, { position: 2, id: 'a' })
    ).toBe(true);
    expect(
      isEarlierLine({ position: 3, id: 'a' }, { position: 2, id: 'b' })
    ).toBe(false);
  });

  it('breaks a tie on position by id, as the text orders', () => {
    // Postgres orders a uuid by its bytes, which is the lowercase hex text.
    const low = '0f000000-0000-4000-8000-000000000000';
    const high = 'a0000000-0000-4000-8000-000000000000';
    expect(
      isEarlierLine({ position: 5, id: low }, { position: 5, id: high })
    ).toBe(true);
    expect(
      isEarlierLine({ position: 5, id: high }, { position: 5, id: low })
    ).toBe(false);
  });
});

describe('the products of a merged line (plan 0112, section 4)', () => {
  it('keeps the survivor’s order, then adds what it lacks, once each', () => {
    expect(mergedItemIds(['a', 'b'], ['b', 'c', 'a', 'd'])).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });
});

describe('the favourite and the chain of a merged line (plan 0199, section 2, rule 6)', () => {
  const none = { favoriteItemId: null, preferredSupermarketId: null };

  it('keeps both fields of the line that survives', () => {
    expect(
      mergedChoices(
        { favoriteItemId: 'a', preferredSupermarketId: 'chain-1' },
        { favoriteItemId: 'c', preferredSupermarketId: 'chain-2' },
        ['a', 'b', 'c']
      )
    ).toEqual({ favoriteItemId: 'a', preferredSupermarketId: 'chain-1' });
  });

  it('takes both from the line that goes away where the survivor has none', () => {
    expect(
      mergedChoices(
        none,
        { favoriteItemId: 'c', preferredSupermarketId: 'chain-2' },
        ['a', 'b', 'c']
      )
    ).toEqual({ favoriteItemId: 'c', preferredSupermarketId: 'chain-2' });
  });

  it('decides each field by itself', () => {
    expect(
      mergedChoices(
        { favoriteItemId: null, preferredSupermarketId: 'chain-1' },
        { favoriteItemId: 'c', preferredSupermarketId: 'chain-2' },
        ['a', 'c']
      )
    ).toEqual({ favoriteItemId: 'c', preferredSupermarketId: 'chain-1' });
    expect(
      mergedChoices(
        { favoriteItemId: 'a', preferredSupermarketId: null },
        { favoriteItemId: 'c', preferredSupermarketId: 'chain-2' },
        ['a', 'c']
      )
    ).toEqual({ favoriteItemId: 'a', preferredSupermarketId: 'chain-2' });
  });

  it('does not take a favourite that is not in the merged set', () => {
    expect(
      mergedChoices(
        none,
        { favoriteItemId: 'gone', preferredSupermarketId: null },
        ['a', 'b']
      )
    ).toEqual(none);
  });

  it('leaves both null when neither line names one, also on rows read before the columns existed', () => {
    expect(mergedChoices(none, none, [])).toEqual(none);
    expect(mergedChoices({} as never, {} as never, ['a'])).toEqual(none);
  });
});

describe('the product bound on a merge (plan 0112, section 2)', () => {
  it('allows a union at the cap', () => {
    expect(() => assertMergeFits(60, 40, LINE_ITEM_SET_MAX)).not.toThrow();
  });

  it('refuses a union past the cap, naming the bound', () => {
    expect(() => assertMergeFits(60, 60, LINE_ITEM_SET_MAX + 1)).toThrow(
      expect.objectContaining({
        code: 'line_merge_too_many_products',
        messageArgs: { max: LINE_ITEM_SET_MAX },
      })
    );
  });

  it('publishes the bound and the offered count as details', () => {
    // The client writes its own sentence and never reads `messageArgs`, which
    // stay on the server (velista plan 0083).
    let thrown: unknown;
    try {
      assertMergeFits(60, 60, LINE_ITEM_SET_MAX + 1);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      exposesDetails: true,
      details: { max: LINE_ITEM_SET_MAX, offered: LINE_ITEM_SET_MAX + 1 },
    });
  });

  it('lets a line its group carried past the cap absorb one that adds nothing', () => {
    // The edit rule of plan 0070, section 7: an over cap line may stay that size.
    const over = LINE_ITEM_SET_MAX + 4;
    expect(() => assertMergeFits(over, 3, over)).not.toThrow();
    expect(() => assertMergeFits(over, 3, over + 1)).toThrow(
      expect.objectContaining({ messageArgs: { max: over } })
    );
  });
});

describe('two lines of two units never merge (plan 0246, section 3.3 and M5)', () => {
  const line = (over: Partial<ListLine>): ListLine =>
    ({
      id: 'li1',
      listId: 'l1',
      content: 'Bananas',
      quantity: 1,
      unit: 'UNIT',
      itemSetHash: null,
      productGroupId: null,
      favoriteItemId: null,
      preferredSupermarketId: null,
      named: true,
      position: 1,
      approvalStatus: LineApprovalStatus.APPROVED,
      createdByUserId: 'u1',
      approvedByUserId: 'u1',
      version: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...over,
    }) as ListLine;

  /** A manager that fails the test on any read or write. */
  const untouched = {
    getRepository: () => {
      throw new Error('the merge touched a table');
    },
  } as unknown as EntityManager;

  it('refuses the merge with line_unit_differs before it touches a row', async () => {
    const merges = new LineMergeService(fakeLineChanges().recorder);

    await expect(
      merges.merge(
        untouched,
        line({ id: 'li1', unit: 'GRAM', quantity: 500 }),
        line({ id: 'li2', unit: 'UNIT', quantity: 2 }),
        {
          list: { id: 'l1', zoneId: 'z1' },
          actor: { userId: 'u1', participantId: null, basketId: null },
        }
      )
    ).rejects.toMatchObject({ code: ERROR_CODES.LINE_UNIT_DIFFERS });
  });

  it('makes the list rename planner refuse instead of summing', async () => {
    // A basket rename of "Plátanos" to "Bananas", on a list where "Bananas"
    // is weighed and "Plátanos" counted.
    const held = [
      line({ id: 'li1', content: 'Bananas', unit: 'GRAM', position: 1 }),
      line({ id: 'li2', content: 'Plátanos', unit: 'UNIT', position: 2 }),
    ];
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity !== ListLine) {
          throw new Error('the planner read past the refusal');
        }
        return {
          find: async ({ where }: { where: { listId?: string } }) =>
            where.listId ? held.map((row) => ({ ...row })) : held,
        };
      },
    } as unknown as EntityManager;
    const service = new LineService(
      ...(new Array(12).fill({}) as ConstructorParameters<typeof LineService>)
    );

    await expect(
      service.planListRename(
        manager,
        { id: 'l1', zoneId: 'z1', name: 'Groceries' } as ShoppingList,
        ['li2'],
        'Bananas',
        new Set([ListPermission.READ, ListPermission.WRITE]),
        { userId: 'u1', participantId: null, basketId: null }
      )
    ).rejects.toMatchObject({
      code: ERROR_CODES.LINE_UNIT_DIFFERS,
      messageArgs: { listName: 'Groceries', content: 'Bananas' },
    });
  });
});
