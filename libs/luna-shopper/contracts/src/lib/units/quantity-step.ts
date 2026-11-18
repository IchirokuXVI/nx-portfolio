import { productKindOf, type ProductSizing } from './line-unit';

/**
 * The steps a curator may give a product sold by the kilo or the litre, in
 * grams or millilitres (plan 0261, decision S2).
 *
 * Each one divides 1000, so every whole kilo or litre sits on the grid of any
 * step. A closed list rather than "any divisor": the back office offers a
 * choice of ten, and leaves out the steps nobody asks for at a counter.
 *
 * The migration `ItemQuantityStep` restates the list in its check
 * `item_quantity_step_allowed`, and a spec asserts the two are equal.
 *
 * Browser reachable, as the rest of `units/` is: it names no `process`.
 */
export const QUANTITY_STEPS = [
  1, 5, 10, 25, 50, 100, 200, 250, 500, 1000,
] as const;
export type QuantityStep = (typeof QUANTITY_STEPS)[number];

/** Whether the value is one of {@link QUANTITY_STEPS}. */
export function isQuantityStep(value: unknown): value is QuantityStep {
  return (QUANTITY_STEPS as readonly unknown[]).includes(value);
}

/**
 * Whether a product of these size fields may carry a step (plan 0261, S3):
 * only one sold by the kilo or by the litre. A pack and a kilo piece count
 * pieces on their own line, so a step means nothing there.
 *
 * It reads {@link productKindOf}, so the rule and the kinds of plan 0246
 * cannot drift apart. S3 says "no size, no weight" for both kinds, and
 * `productKindOf` reads no weight on a `LITER` product, so a weight is
 * refused here too. The check `item_quantity_step_on_loose` restates it.
 */
export function carriesQuantityStep(p: ProductSizing): boolean {
  const kind = productKindOf(p);
  return (
    (kind === 'BY_THE_KILO' || kind === 'BY_THE_LITRE') &&
    p.approxWeight === null
  );
}
