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

  it('moves no buy on a rising ask and holds the rest on the line (plan 0276, spec 2)', () => {
    // Asks 1, bought 5 across two buys: a rising ask to 4 no longer gives
    // the extra back to it. The line holds 3, and the raise that writes it
    // takes the extra in.
    const plan = rebalanceApplied([buy('a', 3, 1), buy('b', 2, 0)], 4);

    expect(plan.left).toBe(3);
    expect(plan.changes.size).toBe(0);
  });

  it("writes the owner's example as the line's 2 (plan 0276, case 4)", () => {
    // Asks 3, bought 5, set to 5: `left` 2, and no buy moves.
    expect(rebalanceApplied([buy('a', 5, 3)], 5)).toEqual({
      left: 2,
      changes: new Map(),
    });
  });

  it('keeps the lowering of plan 0274 below what the buys meet', () => {
    const plan = rebalanceApplied([buy('a', 5, 3)], 1);

    expect(plan.left).toBe(0);
    expect([...plan.changes]).toEqual([['a', 1]]);
  });

  it('holds the whole ask on the line with no buys', () => {
    expect(rebalanceApplied([], 3)).toEqual({ left: 3, changes: new Map() });
  });
});
