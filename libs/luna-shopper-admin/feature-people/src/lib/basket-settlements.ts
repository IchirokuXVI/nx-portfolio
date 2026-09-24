/**
 * What a basket row was settled as, in this app's own shape (admin plan 0033;
 * backend plan 0160).
 *
 * `line_settlements` carried the paid price all along and no screen showed it,
 * so plan 0150 read it with psql. The mapper takes `unknown`, as rule D4 asks,
 * and drops what it cannot draw rather than throwing.
 */

/** How a settlement ended, and `UNKNOWN` for a value this build does not know. */
export type SettlementOutcome = 'BOUGHT' | 'NOT_AVAILABLE' | 'UNKNOWN';

/** One settlement of one basket row. */
export interface BasketSettlementView {
  readonly id: string;
  readonly outcome: SettlementOutcome;
  readonly quantity: number;
  /** The amount paid, in the currency's own units, or `null` for no price. */
  readonly paid: number | null;
  readonly currency: string | null;
  readonly supermarketLocationId: string | null;
  readonly settledByUserId: string | null;
  readonly settledByParticipantId: string | null;
  readonly settledAt: string;
  /** When it was taken back, or `null` for one that stands. */
  readonly revertedAt: string | null;
}

export function toSettlementOutcome(value: unknown): SettlementOutcome {
  return value === 'BOUGHT' || value === 'NOT_AVAILABLE' ? value : 'UNKNOWN';
}

/** One settlement off the wire, or `null` for one with no id. */
export function toBasketSettlement(
  value: unknown
): BasketSettlementView | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const id = stringOrNull(row['id']);
  if (id === null) {
    return null;
  }
  const cents = row['pricePaidCents'];

  return {
    id,
    outcome: toSettlementOutcome(row['outcome']),
    quantity: typeof row['quantity'] === 'number' ? row['quantity'] : 0,
    paid:
      typeof cents === 'number' && Number.isFinite(cents) ? cents / 100 : null,
    currency: stringOrNull(row['pricePaidCurrency']),
    supermarketLocationId: stringOrNull(row['supermarketLocationId']),
    settledByUserId: stringOrNull(row['settledByUserId']),
    settledByParticipantId: stringOrNull(row['settledByParticipantId']),
    settledAt: stringOrNull(row['settledAt']) ?? '',
    revertedAt: stringOrNull(row['revertedAt']),
  };
}

/** Every settlement of a row that can be drawn, from whatever it carried. */
export function basketSettlements(
  value: unknown
): readonly BasketSettlementView[] {
  return Array.isArray(value)
    ? value
        .map(toBasketSettlement)
        .filter((row): row is BasketSettlementView => row !== null)
    : [];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}
