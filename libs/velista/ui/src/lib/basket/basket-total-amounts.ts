import type { BasketTotal } from '@portfolio/velista/models';
import { formatMoney } from '@portfolio/velista/platform';

/** The three amounts of a {@link BasketTotal}, as money in the reader's language. */
export interface BasketTotalAmounts {
  readonly bought: string;
  readonly left: string;
  readonly total: string;
}

/**
 * The sum is kept in integer cents (velista `0132`, section 2), and this is the
 * one place it becomes major units again. No tilde here: `basket.total.amount`
 * adds it, so a language can move it, and the accessible names say "about"
 * instead.
 */
export function basketTotalAmounts(
  total: BasketTotal,
  locale: string
): BasketTotalAmounts {
  const money = (cents: number) =>
    formatMoney(cents / 100, total.currency, locale);

  return {
    bought: money(total.boughtCents),
    left: money(total.leftCents),
    total: money(total.totalCents),
  };
}

/**
 * How much of the total is bought, from 0 to 100. A total of zero is an empty
 * bar and never a division by it.
 */
export function boughtShare(total: BasketTotal): number {
  if (total.totalCents <= 0) {
    return 0;
  }
  const share = (total.boughtCents / total.totalCents) * 100;
  return Math.min(100, Math.max(0, share));
}
