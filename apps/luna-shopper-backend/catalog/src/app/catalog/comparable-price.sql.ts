import type { EntityManager } from 'typeorm';

/**
 * The SQL translation of `comparablePriceOf` (plan 0245, sections 1 and 3)
 * over `supermarket_items` aliased `si` joined to `items` aliased `i`.
 *
 * The size is put in its base unit first, as `toBaseUnit` does: a `KILOGRAM`
 * or `LITER` size is multiplied by 1000 and rounded to four decimals. A
 * `KILOGRAM` product with no positive size is priced per kilo already. Every
 * figure is rounded half up to four decimals, which `round(numeric, 4)` does.
 *
 * `comparable-price.integration.spec.ts` seeds every kind of row and proves
 * this equal to the function. The migration that added the columns carries
 * its own frozen copy, as migrations do.
 */
const BASE_SIZE = `(CASE
    WHEN i."defaultUnit" IN ('KILOGRAM', 'LITER') THEN round(i."unitSize" * 1000, 4)
    ELSE i."unitSize"
  END)`;

const COUNT = `(CASE
    WHEN i."unitSize" > 0 THEN i."unitSize"
    WHEN i."packCount" > 0 THEN i."packCount"
    ELSE 1
  END)`;

export const COMPARABLE_PRICE_SQL = `(CASE
    WHEN si."price" IS NULL THEN NULL
    WHEN i."defaultUnit" = 'KILOGRAM' AND coalesce(i."unitSize", 0) <= 0
      THEN round(si."price", 4)
    WHEN i."defaultUnit" IN ('GRAM', 'KILOGRAM', 'MILLILITER', 'LITER')
      THEN CASE WHEN ${BASE_SIZE} > 0
                THEN round(si."price" * 1000 / ${BASE_SIZE}, 4) END
    ELSE round(si."price" / ${COUNT}, 4)
  END)`;

export const COMPARABLE_BASIS_SQL = `(CASE
    WHEN si."price" IS NULL THEN NULL
    WHEN i."defaultUnit" = 'KILOGRAM' AND coalesce(i."unitSize", 0) <= 0
      THEN 'KILOGRAM'
    WHEN i."defaultUnit" IN ('GRAM', 'KILOGRAM')
      THEN CASE WHEN ${BASE_SIZE} > 0 THEN 'KILOGRAM' END
    WHEN i."defaultUnit" IN ('MILLILITER', 'LITER')
      THEN CASE WHEN ${BASE_SIZE} > 0 THEN 'LITER' END
    ELSE 'UNIT'
  END)::"comparable_basis"`;

/**
 * Rewrite the comparison pair of every materialized row of these items (plan
 * 0245, section 3), inside the caller's transaction.
 *
 * The pair depends on the item and `price` does not, so an edit of the item's
 * size, unit, pack count or weight that leaves every price alone calls this.
 * One `UPDATE` joined to `items`, and a row whose pair already holds is not
 * written, so a second call writes nothing.
 */
export async function recomputeComparablePrices(
  manager: EntityManager,
  itemIds: readonly string[]
): Promise<void> {
  if (itemIds.length === 0) {
    return;
  }
  await manager.query(
    `UPDATE "supermarket_items" si
        SET "comparablePrice" = ${COMPARABLE_PRICE_SQL},
            "comparableBasis" = ${COMPARABLE_BASIS_SQL}
       FROM "items" i
      WHERE i."id" = si."itemId"
        AND si."itemId" = ANY($1::uuid[])
        AND (si."comparablePrice", si."comparableBasis")
            IS DISTINCT FROM (${COMPARABLE_PRICE_SQL}, ${COMPARABLE_BASIS_SQL})`,
    [[...new Set(itemIds)]]
  );
}

/**
 * The basis block of a row in an order that crosses products (plan 0245,
 * decision C5): kilo and litre figures first, counted figures after them.
 */
export const COMPARABLE_BLOCK_OFFSET = 1_000_000_000;

/**
 * One sortable number for a row's place across products: its figure in the
 * kilo and litre block, or its figure plus {@link COMPARABLE_BLOCK_OFFSET} in
 * the counted block, and null for a row with no figure. `numeric(12,4)` holds
 * at most 10^8, so the two blocks never overlap, and the lowest of these over
 * a product's rows is its lowest kilo or litre figure when it has one and its
 * lowest counted figure otherwise. The listing's cursor carries it as it is,
 * so one number holds the block and the figure.
 */
export function comparableSortSql(alias: string): string {
  return `(CASE ${alias}."comparableBasis"
      WHEN 'UNIT' THEN ${alias}."comparablePrice" + ${COMPARABLE_BLOCK_OFFSET}
      ELSE ${alias}."comparablePrice"
    END)`;
}

/** The block of a row by its basis, for an `ORDER BY`: 0, 1, or 2 for none. */
export function comparableBlockSql(alias: string): string {
  return `(CASE ${alias}."comparableBasis"
      WHEN 'KILOGRAM' THEN 0 WHEN 'LITER' THEN 0 WHEN 'UNIT' THEN 1 ELSE 2
    END)`;
}
