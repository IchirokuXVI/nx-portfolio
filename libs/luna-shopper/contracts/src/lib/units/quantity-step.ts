import { productKindOf, type ProductSizing } from './line-unit';

/**
 * The steps a curator may give a product sold by the kilo, in grams (plan
 * 0261, decision S2).
 *
 * Each one divides 1000, so every whole kilo sits on the grid of any step. A closed list rather than "any divisor": the back office offers a
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
 * only one sold by the kilo, with no size and no weight. A pack and a kilo
 * piece count pieces on their own line, so a step means nothing there.
 *
 * **No product by the litre carries a step** (the owner's ruling of
 * 2026-11-17). `LITER` is not a base unit: a write that names it is refused
 * with `item_unit_not_base`, and a liquid is stored in millilitres with a
 * size, which is a pack counted in pieces. The `BY_THE_LITRE` branch below
 * is kept as built, and it admits only a legacy `LITER` row with no size
 * and no weight, on an edit that names no unit and no size.
 *
 * It reads {@link productKindOf}, so the rule and the kinds of plan 0246
 * cannot drift apart. The check `item_quantity_step_on_loose` restates it.
 */
export function carriesQuantityStep(p: ProductSizing): boolean {
  const kind = productKindOf(p);
  return (
    (kind === 'BY_THE_KILO' || kind === 'BY_THE_LITRE') &&
    p.approxWeight === null
  );
}
