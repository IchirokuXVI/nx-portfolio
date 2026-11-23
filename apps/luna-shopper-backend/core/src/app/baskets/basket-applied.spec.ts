import { countAboveAsk, type DemandBuy } from './basket-applied';

/**
 * The count of plan 0275, section 5: the units bought above the ask taken
 * toward a raise, oldest buy first, never raising a buy's `applied` above
 * what it bought. The cases are the plan's table.
 */
describe('countAboveAsk (plan 0275)', () => {
  const buy = (id: string, quantity: number, applied: number): DemandBuy => ({
    id,
    quantity,
    applied,
  });

  const appliedAfter = (
    buys: readonly DemandBuy[],
    changes: Map<string, number>
  ) => buys.map((one) => changes.get(one.id) ?? one.applied);

  it.each([
    {
      name: 'case 1: asks 3, bought 4, a raise of 2',
      buys: [buy('a', 4, 3)],
      delta: 2,
      above: 1,
      counted: 1,
      applied: [4],
    },
    {
      name: 'case 2: asks 3, bought 4, a raise of 1',
      buys: [buy('a', 4, 3)],
      delta: 1,
      above: 1,
      counted: 1,
      applied: [4],
    },
    {
      name: 'case 6: more above than the raise',
      buys: [buy('a', 4, 1)],
      delta: 2,
      above: 3,
      counted: 2,
      applied: [3],
    },
    {
      name: 'case 7: two baskets, the older buy first',
      buys: [buy('a', 4, 3), buy('b', 2, 0)],
      delta: 2,
      above: 3,
      counted: 2,
      applied: [4, 1],
    },
    {
      name: 'case 8: two baskets, a raise past what is above',
      buys: [buy('a', 4, 3), buy('b', 2, 0)],
      delta: 4,
      above: 3,
      counted: 3,
      applied: [4, 2],
    },
    {
      name: 'case 9: a weight, 1500 g bought on an ask of 1000 g',
      buys: [buy('a', 1500, 1000)],
      delta: 1500,
      above: 500,
      counted: 500,
      applied: [1500],
    },
    {
      name: 'case 11: no extra',
      buys: [buy('a', 2, 2)],
      delta: 2,
      above: 0,
      counted: 0,
      applied: [2],
    },
  ])('$name', ({ buys, delta, above, counted, applied }) => {
    const count = countAboveAsk(buys, delta);

    expect(count.above).toBe(above);
    expect(count.counted).toBe(counted);
    expect(appliedAfter(buys, count.changes)).toEqual(applied);
    // Never above what a buy bought, and only the buys that move are named.
    for (const one of buys) {
      expect(appliedAfter([one], count.changes)[0]).toBeLessThanOrEqual(
        one.quantity
      );
    }
    for (const [id, value] of count.changes) {
      expect(buys.find((one) => one.id === id)?.applied).not.toBe(value);
    }
  });

  it('counts nothing on a lowering and still says what is above the ask', () => {
    const count = countAboveAsk([buy('a', 4, 3)], -1);

    expect(count).toEqual({ above: 1, counted: 0, changes: new Map() });
  });

  it('counts nothing with no buys', () => {
    expect(countAboveAsk([], 3)).toEqual({
      above: 0,
      counted: 0,
      changes: new Map(),
    });
  });
});
