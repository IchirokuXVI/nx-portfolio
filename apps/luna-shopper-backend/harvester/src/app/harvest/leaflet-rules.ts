import {
  HarvestWarningCode,
  type LeafletOffer,
  type LeafletPromotionType,
} from '@portfolio/luna-shopper/contracts';
import { normalizeName } from './matching';

/**
 * The three import rules (plan 0081, section 6), measured on the two committed
 * El Jamon outputs: 219 offers from the text layer and 48 read by a model.
 *
 * They run in the order the plan states, and the order is not arbitrary: a
 * loyalty gated tile is dropped before anybody asks which of its numbers is the
 * price, because the answer for a card holder is not a price a shopper pays.
 */

/** The alias key separator, so the two halves cannot run together. */
const KEY_SEPARATOR = '|';

/**
 * The key one printed tile resolves through (section 2.1).
 *
 * `normalizeName(product.name)`, a pipe, then `normalizeName(format.raw ?? '')`,
 * with the **same** `normalizeName` the discovery matcher uses so the two agree
 * about accents, case and punctuation.
 *
 * **Brand is not in it.** `product.brand` is present on 0 of the 219 text layer
 * offers and 43 of the 48 vision ones, so a key including brand would resolve
 * one product one way from one extractor and another way from the other.
 *
 * **Format is in it.** Two offers with the same printed name are told apart by
 * their format: zero collisions on name plus format in both outputs, against one
 * on name alone. `format.raw` is absent on 10 of 219, and those fall back to the
 * name alone, which is what an empty second half is.
 */
export function aliasKeyFor(offer: LeafletOffer): string {
  return [
    normalizeName(offer.product.name ?? ''),
    normalizeName(offer.product.format?.raw ?? ''),
  ].join(KEY_SEPARATOR);
}

/** What section 6 decided about one tile. */
export interface OfferPricing {
  /** What the till charges for one pack, or null when the tile states none. */
  price: number | null;
  currency: string | null;
  /** The source's own comparison figure, verbatim and never converted. */
  unitPrice: number | null;
  /** Text, never a unit (plan 0038, section 2.4). */
  unitPriceLabel: string | null;
}

export type OfferDecision =
  | { kind: 'write'; pricing: OfferPricing }
  | { kind: 'skip'; code: HarvestWarningCode; message: string }
  | { kind: 'queue'; code: HarvestWarningCode; message: string };

/**
 * The promotion types whose headline price is **not** what one unit costs
 * (section 6.2). 36 of the 219 text layer offers carry one.
 *
 * The Radler tile is the case the rule exists for: `price: 0.39` with
 * `single_unit_price: 0.79`. A shopper buying one can is charged 0.79, so
 * writing 0.39 as the product's price is wrong.
 */
const CONDITIONAL_PROMOTIONS: readonly LeafletPromotionType[] = [
  'second_unit_discount',
  'multibuy_unit_price',
  'multibuy_total',
  'buy_n_get_free',
];

/** A basis that prices a weight or a volume rather than a pack (section 6.1). */
const MEASURED_BASES = new Set(['kg', 'l']);

/**
 * What to write for one offer, or why to write nothing.
 *
 * The three rules in the order section 8 gives them:
 *
 * 1. **Loyalty** (6.3). A card price is not the price a non member pays, and
 *    the owner decided loyalty is stored and not implemented, so the offer is
 *    dropped with a warning naming it rather than written with a number most
 *    shoppers cannot have.
 * 2. **The promotion** (6.2). For a conditional mechanic the headline price is
 *    the second unit's or the bulk unit's, so `single_unit_price` is what a
 *    shopper pays for one. A conditional tile without it queues: the only
 *    number on it is one nobody can pay for a single unit.
 * 3. **The basis** (6.1). A `kg` or `l` basis is not what the till charges for
 *    one pack, so it writes a unit price and **no** till price. That is 42% of
 *    this leaflet reaching no basket line, which backlog `0011` records and the
 *    owner accepted.
 */
export function decideOffer(offer: LeafletOffer): OfferDecision {
  if (offer.loyalty?.required === true) {
    const program = offer.loyalty.program ? ` (${offer.loyalty.program})` : '';
    return {
      kind: 'skip',
      code: HarvestWarningCode.LOYALTY_REQUIRED,
      message:
        `This price needs the chain's loyalty card${program}, so nothing ` +
        'was written: a card price is not the price a non member pays.',
    };
  }

  const currency = offer.pricing.price?.currency ?? null;
  const unitPrice = offer.pricing.unit_price;
  const comparison: Pick<OfferPricing, 'unitPrice' | 'unitPriceLabel'> = {
    unitPrice: typeof unitPrice?.amount === 'number' ? unitPrice.amount : null,
    unitPriceLabel: unitPrice?.per ?? null,
  };

  const promotionType = offer.promotion?.type;
  const conditional =
    promotionType !== undefined &&
    CONDITIONAL_PROMOTIONS.includes(promotionType);
  if (conditional) {
    const single = offer.promotion?.single_unit_price;
    if (typeof single?.amount !== 'number') {
      return {
        kind: 'queue',
        code: HarvestWarningCode.CONDITIONAL_PRICE,
        message:
          `The printed price is conditional (${promotionType}) and the tile ` +
          'states no single unit price, so the only number on it is one a ' +
          'shopper cannot pay for one unit.',
      };
    }
    return {
      kind: 'write',
      pricing: {
        price: single.amount,
        currency: single.currency ?? currency,
        ...comparison,
      },
    };
  }

  if (MEASURED_BASES.has(offer.pricing.basis)) {
    // A price per kilogram is not what the till charges for one pack (plan
    // 0038, section 2.4), so it is written where a comparison figure belongs
    // and the till price stays null. Plan 0067 met the same shape at the fish
    // counter and wrote it the same way.
    return {
      kind: 'write',
      pricing: {
        price: null,
        currency,
        unitPrice: comparison.unitPrice ?? offer.pricing.price?.amount ?? null,
        unitPriceLabel: comparison.unitPriceLabel ?? offer.pricing.basis,
      },
    };
  }

  return {
    kind: 'write',
    pricing: {
      price: offer.pricing.price?.amount ?? null,
      currency,
      ...comparison,
    },
  };
}
