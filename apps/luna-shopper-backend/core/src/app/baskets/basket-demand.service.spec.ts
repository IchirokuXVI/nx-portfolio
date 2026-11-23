import { rebalanceApplied, type DemandBuy } from './basket-demand.service';

/**
 * The split of an ask between the line and this basket's buys (plan 0274,
 * section 5). The writes around it are proved against Postgres in
 * `basket-applied.integration.spec.ts`.
 */
describe('rebalanceApplied', () => {
  const buy = (id: string, quantity: number, applied: number): DemandBuy => ({
    id,
    quantity,
    applied,
  });

  it('holds the rest of the ask on the line when the buys met all they bought', () => {
    const plan = rebalanceApplied([buy('a', 2, 2)], 5);

    expect(plan.left).toBe(3);
    expect(plan.changes.size).toBe(0);
  });

  it('asks nothing of the line and lowers the newest buy first below what was met', () => {
    const plan = rebalanceApplied([buy('a', 2, 2), buy('b', 2, 2)], 1);

    expect(plan.left).toBe(0);
    expect([...plan.changes]).toEqual([
      ['b', 0],
      ['a', 1],
    ]);
  });

  it('gives units above the ask back to it, oldest buy first, before the line holds any', () => {
    const plan = rebalanceApplied([buy('a', 3, 1), buy('b', 2, 0)], 4);

    expect(plan.left).toBe(0);
    expect([...plan.changes]).toEqual([
      ['a', 3],
      ['b', 1],
    ]);
  });

  it('holds the whole ask on the line with no buys', () => {
    expect(rebalanceApplied([], 3)).toEqual({ left: 3, changes: new Map() });
  });
});
