import { absorbAboveAsk, type DemandBuy } from './basket-applied';

/**
 * The absorption of plan 0276, section 1 (spec 1): every unit bought above the
 * ask taken into the ask on a raise, each buy's `applied` set to what it
 * bought, oldest buy first. The cases are the plan's table.
 */
describe('absorbAboveAsk (plan 0276)', () => {
  const buy = (id: string, quantity: number, applied: number): DemandBuy => ({
    id,
    quantity,
    applied,
  });

  it.each([
    {
      name: 'case 1: asks 1, bought 4',
      buys: [buy('a', 4, 1)],
      above: 3,
      changes: [['a', 4]],
    },
    {
      name: 'case 4: asks 3, bought 5',
      buys: [buy('a', 5, 3)],
      above: 2,
      changes: [['a', 5]],
    },
    {
      name: 'case 11: two baskets, the older buy first',
      buys: [buy('a', 4, 3), buy('b', 2, 0)],
      above: 3,
      changes: [
        ['a', 4],
        ['b', 2],
      ],
    },
    {
      name: 'case 16: a weight, 1500 g bought on an ask of 1000 g',
      buys: [buy('a', 1500, 1000)],
      above: 500,
      changes: [['a', 1500]],
    },
    {
      name: 'a buy with nothing above stays where it is',
      buys: [buy('a', 2, 2), buy('b', 3, 1)],
      above: 2,
      changes: [['b', 3]],
    },
  ])('$name', ({ buys, above, changes }) => {
    const absorption = absorbAboveAsk(buys);

    expect(absorption.above).toBe(above);
    expect([...absorption.changes]).toEqual(changes);
  });

  it('moves nothing when nothing is above the ask (case 18)', () => {
    expect(absorbAboveAsk([buy('a', 2, 2)])).toEqual({
      above: 0,
      changes: new Map(),
    });
  });

  it('moves nothing with no buys', () => {
    expect(absorbAboveAsk([])).toEqual({ above: 0, changes: new Map() });
  });
});
