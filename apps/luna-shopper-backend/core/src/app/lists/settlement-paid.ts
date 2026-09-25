import {
  SettlementOutcome,
  type SettlementPaid,
} from '@portfolio/luna-shopper/contracts';
import { isUuid, ValidationException } from '@portfolio/luna-shopper/platform';

/** ISO 4217 as catalog stores it: three upper case letters. */
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** The five columns a settle writes, on every row it writes. */
export interface SettlementPaidColumns {
  pricePaidCents: number | null;
  pricePaidCurrency: string | null;
  priceScopeId: string | null;
  supermarketLocationId: string | null;
  /** The shop's chain, set exactly when the shop is (plan 0163, section 5). */
  supermarketId: string | null;
}

/** Nothing was recorded, which is an ordinary settle. */
const NOTHING_PAID: SettlementPaidColumns = {
  pricePaidCents: null,
  pricePaidCurrency: null,
  priceScopeId: null,
  supermarketLocationId: null,
  supermarketId: null,
};

/**
 * What the two settles write into the four price columns (plan 0143, section
 * 4.3).
 *
 * **Core validates the shape and nothing else.** It never reads a price, never
 * asks catalog whether a scope is real, and never decides what a product costs:
 * the gateway did all three, as the basket's owner, before it sent the message
 * (section 4.2). The two ids are opaque here exactly as `itemId` is.
 *
 * ## `NOT_AVAILABLE` keeps the place and drops the price
 *
 * A close records the scope and the shop, because "which chain had none" is the
 * half of that outcome worth keeping, and it writes no price **even when the
 * message carried one**: the shopper bought nothing, so there is nothing that
 * was paid. `ck_line_settlements_price_bought` holds the same rule in the
 * database, so a caller that got here another way is refused rather than
 * stored.
 *
 * ## A price and its currency arrive together or not at all
 *
 * One without the other is refused rather than dropped. An amount with no
 * currency is a number, and a currency with no amount is a caller that meant
 * something this shape cannot say; both are a bug in whoever built the message,
 * and `ck_line_settlements_price` refuses them too.
 */
export function paidColumns(
  paid: SettlementPaid | undefined,
  outcome: SettlementOutcome
): SettlementPaidColumns {
  if (!paid) {
    return NOTHING_PAID;
  }

  if (!isUuid(paid.priceScopeId)) {
    throw new ValidationException('priceScopeId must be a valid scope', {
      messageArgs: { field: 'priceScopeId' },
    });
  }
  if (
    paid.supermarketLocationId !== null &&
    !isUuid(paid.supermarketLocationId)
  ) {
    throw new ValidationException(
      'supermarketLocationId must be a valid shop reference',
      { messageArgs: { field: 'supermarketLocationId' } }
    );
  }
  // The chain travels with the shop and never without it (plan 0163, section
  // 5), which `ck_line_settlements_location_scope` also holds. A chain with no
  // shop is a caller that built the message wrong, so it is refused rather
  // than dropped.
  const supermarketId = paid.supermarketId ?? null;
  if (supermarketId !== null && !isUuid(supermarketId)) {
    throw new ValidationException('supermarketId must be a valid chain', {
      messageArgs: { field: 'supermarketId' },
    });
  }
  if (supermarketId !== null && paid.supermarketLocationId === null) {
    throw new ValidationException(
      'a chain is recorded with its shop or not at all',
      { messageArgs: { field: 'supermarketId' } }
    );
  }

  const hasAmount = paid.pricePaidCents !== null;
  const hasCurrency = paid.pricePaidCurrency !== null;
  if (hasAmount !== hasCurrency) {
    throw new ValidationException(
      'a price is recorded with its currency or not at all',
      { messageArgs: { field: 'pricePaidCents' } }
    );
  }
  if (
    paid.pricePaidCents !== null &&
    (!Number.isInteger(paid.pricePaidCents) || paid.pricePaidCents < 0)
  ) {
    throw new ValidationException(
      'pricePaidCents must be a whole number of minor units, and not negative',
      { messageArgs: { field: 'pricePaidCents' } }
    );
  }
  if (
    paid.pricePaidCurrency !== null &&
    !CURRENCY_PATTERN.test(paid.pricePaidCurrency)
  ) {
    throw new ValidationException(
      'pricePaidCurrency must be an ISO 4217 code',
      { messageArgs: { field: 'pricePaidCurrency' } }
    );
  }

  // The close case, stated after the validation rather than before it: a
  // malformed message is a bug wherever it lands, and dropping the price
  // silently first would hide it on exactly the outcome nobody looks at.
  const bought = outcome === SettlementOutcome.BOUGHT;
  return {
    pricePaidCents: bought ? paid.pricePaidCents : null,
    pricePaidCurrency: bought ? paid.pricePaidCurrency : null,
    priceScopeId: paid.priceScopeId,
    supermarketLocationId: paid.supermarketLocationId,
    supermarketId,
  };
}
