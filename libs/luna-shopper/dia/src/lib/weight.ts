import type { SourceSizeUnit } from '@portfolio/luna-shopper/contracts';
import { regularPrice, type DiaRegularPrice } from './price';
import type { DiaSize } from './size';
import type { DiaPromotion, DiaRawPrices } from './types';

/**
 * What a DIA row states about its weight, and so what it writes as its size
 * (plan 0244, section 5.3).
 *
 * DIA prints the weight of a piece that varies as `800 g aprox.` at the end of
 * the name, a price for the piece, and a `price_per_unit` with its
 * `measure_unit`. Three kinds follow:
 *
 * | `approximate` | `measure_unit` | Sold by weight | `unitSize` | `approxWeight` |
 * | --- | --- | --- | --- | --- |
 * | true | `KILO` | yes | null | the grams |
 * | true | anything else | no | null | the grams |
 * | false | any | no | as printed | null |
 *
 * The first is a piece sold by the kilo: its price is the price of a kilo
 * ({@link weighedPrice}), and every read derives the piece price from the
 * weight. The second is a piece priced as one, as a LIDL tray is: the weight
 * is information and the price is the piece. A size the chain promises is a
 * size, as before.
 *
 * An approximate format that is not a weight (`1 L aprox.`) states no weight
 * and keeps its size, because a weight in grams is the only thing the column
 * holds.
 */
export interface DiaWeight {
  soldByWeight: boolean;
  /** {@link DiaSize.approxWeight}, in grams. */
  approxWeight: number | null;
  /** The size the row writes: null beside a weight. */
  unitSize: number | null;
  /** The unit of {@link unitSize}: null beside a weight. */
  sizeUnit: SourceSizeUnit | null;
}

/** The `measure_unit` of a price per kilo. Verbatim, as DIA prints it. */
const PER_KILO = 'KILO';

/**
 * Whether the row is a piece sold by the kilo (plan 0244, section 5.3).
 *
 * The weight must be approximate, `measure_unit` must be `KILO`, and the row
 * must carry a `price_per_unit`. Without that figure there is no price of a
 * kilo to write, and the price it prints is the price of the piece.
 */
export function isSoldByWeight(
  size: DiaSize,
  prices: DiaRawPrices | null
): boolean {
  return size.approxWeight !== null && comparesPerKilo(prices);
}

/** Whether the prices carry a `price_per_unit` whose unit is `KILO`. */
function comparesPerKilo(prices: DiaRawPrices | null): boolean {
  return (
    prices !== null &&
    prices.pricePerUnit !== null &&
    prices.measureUnit?.trim().toUpperCase() === PER_KILO
  );
}

/** The weight and the size one row writes. See {@link DiaWeight}. */
export function weightOf(
  size: DiaSize,
  prices: DiaRawPrices | null
): DiaWeight {
  const weighed = size.approxWeight !== null;
  return {
    soldByWeight: isSoldByWeight(size, prices),
    approxWeight: size.approxWeight,
    unitSize: weighed ? null : size.unitSize,
    sizeUnit: weighed ? null : size.sizeUnit,
  };
}

/**
 * The price a row writes for one scope: {@link regularPrice}, with the price
 * of a kilo as the price when the row is sold by weight.
 *
 * The price of a kilo is the `unitPrice` that {@link regularPrice} answers,
 * so on a club row it is the figure D2 of plan 0174 scaled to the regular
 * price, and never the club figure. The piece price DIA prints is not
 * written (plan 0244, D1), as Mercadona's is not. `unitPrice` and its label
 * stay what they were.
 *
 * `extra` is left as {@link regularPrice} wrote it, so it still holds the
 * figures DIA printed for the piece: `previousPrice` is the piece before the
 * promotion, and `loyalty` carries the club piece price beside the club price
 * of a kilo. Nothing reads them as the row's price.
 */
export function weighedPrice(
  prices: DiaRawPrices,
  promotions: readonly DiaPromotion[],
  size: DiaSize
): DiaRegularPrice {
  const regular = regularPrice(prices, promotions);
  if (!isSoldByWeight(size, prices) || regular.unitPrice === null) {
    return regular;
  }
  return { ...regular, price: regular.unitPrice };
}

/**
 * The price one scope writes when the row decided "sold by weight" once, from
 * its identity row ({@link weightOf}), and not again from each scope's
 * listing.
 *
 * Not sold by weight: {@link regularPrice}, the price of the piece or pack,
 * whatever the scope's comparison says. Sold by weight: the scope's price of
 * a kilo, as {@link weighedPrice} answers it, and `null` when the scope's
 * listing carries no `price_per_unit` per `KILO`. The only other figure that
 * scope prints is the piece price, which D1 of plan 0244 never writes, and
 * the identity row's price of a kilo belongs to another store. So that scope
 * writes no price, and keeps what an earlier run said.
 */
export function scopePrice(
  prices: DiaRawPrices,
  promotions: readonly DiaPromotion[],
  soldByWeight: boolean
): DiaRegularPrice | null {
  const regular = regularPrice(prices, promotions);
  if (!soldByWeight) {
    return regular;
  }
  if (!comparesPerKilo(prices) || regular.unitPrice === null) {
    return null;
  }
  return { ...regular, price: regular.unitPrice };
}
