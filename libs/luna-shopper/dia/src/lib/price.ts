import type { DiaPromotion, DiaRawPrices } from './types';

/** What `extra.loyalty` names the programme. Stored, and shown to no shopper. */
export const DIA_LOYALTY_PROGRAM = 'CLUB_DIA';

/** The price every shopper pays, and what the row said beside it. */
export interface DiaRegularPrice {
  price: number;
  currency: string;
  unitPrice: number | null;
  /** `measure_unit`, verbatim. `100 ML.` is never converted to litres. */
  unitPriceLabel: string | null;
  /**
   * What goes on the observation's `extra`: `loyalty` for a club row,
   * `previousPrice` for a promotion for everybody, `promotion` for the printed
   * promotion texts, and `unitPriceScaled` when D2 applied.
   */
  extra: DiaPriceExtra;
}

export interface DiaPriceExtra {
  loyalty?: { program: string; price: number; unitPrice: number | null };
  previousPrice?: number;
  /**
   * The printed promotions, with DIA's own key names. An object and not the
   * bare list, because the price history keeps `extra.promotion` only when it
   * is one (`toItemPriceDetails`).
   */
  promotion?: { entries: DiaPromotionText[] };
  unitPriceScaled?: true;
}

/** One entry of `promotions[]`, under the names DIA gives its fields. */
export interface DiaPromotionText {
  description: string | null;
  short_description: string | null;
  only_club_dia: boolean;
}

/**
 * The regular, non member price of a listing row (plan 0174, section 4).
 *
 * - **A club row** (`is_club_price`): `price` is the Club Dia price, so the
 *   regular price is `strikethrough_price`. The club price goes in
 *   `extra.loyalty` and is never written as a price.
 * - **A promotion for everybody** (`is_promo_price` without club): `price` is
 *   what every shopper pays now, and `strikethrough_price` is kept as
 *   `extra.previousPrice`.
 * - **Every other row**, a club only multi buy included: `price`.
 *
 * **D2: the unit price of a club row is scaled once, by the ratio of the two
 * prices.** `price_per_unit` is computed by DIA on `price`, so on a club row it
 * is the club unit price and writing it verbatim would state the wrong number.
 * The row is marked `unitPriceScaled`, so every scaled price can be found.
 */
export function regularPrice(
  prices: DiaRawPrices,
  promotions: readonly DiaPromotion[] = []
): DiaRegularPrice {
  const extra: DiaPriceExtra = {};
  if (promotions.length > 0) {
    extra.promotion = {
      entries: promotions.map((promotion) => ({
        description: promotion.description,
        short_description: promotion.shortDescription,
        only_club_dia: promotion.onlyClubDia,
      })),
    };
  }

  let price = prices.price;
  let unitPrice = prices.pricePerUnit;
  if (prices.isClubPrice) {
    price = prices.strikethroughPrice;
    extra.loyalty = {
      program: DIA_LOYALTY_PROGRAM,
      price: prices.price,
      unitPrice: prices.pricePerUnit,
    };
    if (unitPrice !== null && prices.price > 0 && price !== prices.price) {
      unitPrice = round2((unitPrice * price) / prices.price);
      extra.unitPriceScaled = true;
    }
  } else if (prices.isPromoPrice && prices.strikethroughPrice > prices.price) {
    extra.previousPrice = prices.strikethroughPrice;
  }

  return {
    price,
    currency: prices.currency,
    unitPrice,
    unitPriceLabel: prices.measureUnit,
    extra,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
