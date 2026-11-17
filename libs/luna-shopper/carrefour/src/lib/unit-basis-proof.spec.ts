import { UnitOfMeasure, unitBasisOf } from '@portfolio/luna-shopper/contracts';
import overTheCeiling from './__fixtures__/listing-over-the-ceiling.json';
import listingPage from './__fixtures__/listing-page.json';
import productPage from './__fixtures__/product-page.json';
import { readCard, splitCardName } from './listing';
import { priceToCents } from './price';
import type { CarrefourCard } from './types';

/**
 * The fixture proof of backend plan 0264: the comparison price of a Carrefour
 * card is a price per its `measure_unit`, so the label the adapter builds from
 * it may name that basis.
 *
 * **The proof tests the basis, not the cent** (the owner, 2026-11-11). For
 * each priced card measured in `kg`, `l` or `ud`, price divided by
 * `price_per_unit` must be within 10% of the size the name prints, read with
 * the adapter's own {@link splitCardName}. A wrong basis is off by a factor of
 * ten, a hundred or the pack count, so it still fails here. The chain rounds,
 * and on one can it computed with 33 cl where the name prints 35,5 cl.
 *
 * A card whose name states no size in its own `measure_unit`'s family is left
 * out by that rule, and only by that rule: no card is named as an exception.
 * The count of measured cards is asserted, so a later capture or a parser
 * change that reads fewer sizes cannot make the rule pass by skipping them.
 */

/** Every card of the three captured pages, whatever page shape holds it. */
function cardsOf(document: unknown): CarrefourCard[] {
  const found: CarrefourCard[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node === null || typeof node !== 'object') {
      return;
    }
    const record = node as Record<string, unknown>;
    if (
      typeof record['product_id'] === 'string' &&
      typeof record['name'] === 'string' &&
      typeof record['measure_unit'] === 'string'
    ) {
      found.push(record as unknown as CarrefourCard);
    }
    Object.values(record).forEach(walk);
  };
  walk(document);
  return found;
}

/** The family of a `measure_unit`, as the catalog unit a size states it in. */
const FAMILY: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  // Litres, from a size stated in litres or in millilitres.
  l: { [UnitOfMeasure.LITER]: 1, [UnitOfMeasure.MILLILITER]: 0.001 },
  kg: { [UnitOfMeasure.KILOGRAM]: 1 },
  ud: { [UnitOfMeasure.UNIT]: 1 },
};

const BASIS_OF_MEASURE: Readonly<Record<string, string>> = {
  l: 'LITER',
  kg: 'KILOGRAM',
  ud: 'UNIT',
};

interface PricedCard {
  card: CarrefourCard;
  measure: string;
  price: number;
  perUnit: number;
}

/** The priced `kg`, `l` and `ud` cards, one per product. */
function pricedCards(): PricedCard[] {
  const byProduct = new Map<string, PricedCard>();
  for (const card of [
    ...cardsOf(listingPage),
    ...cardsOf(overTheCeiling),
    ...cardsOf(productPage),
  ]) {
    const measure = (card.measure_unit ?? '').trim().toLowerCase();
    const price = priceToCents(card.price);
    const perUnit = priceToCents(card.price_per_unit);
    if (
      FAMILY[measure] === undefined ||
      price === null ||
      perUnit === null ||
      perUnit === 0 ||
      byProduct.has(card.product_id)
    ) {
      continue;
    }
    byProduct.set(card.product_id, { card, measure, price, perUnit });
  }
  return [...byProduct.values()];
}

/** The size the name prints, in the card's own `measure_unit`, or null. */
function printedSize({ card, measure }: PricedCard): number | null {
  const split = splitCardName(card.name, card.measure_unit);
  const factor =
    split.sizeUnit === null ? undefined : FAMILY[measure][split.sizeUnit];
  if (split.unitSize === null || factor === undefined) {
    return null;
  }
  return split.unitSize * factor;
}

describe('a Carrefour comparison price is per its measure_unit (plan 0264)', () => {
  const cards = pricedCards();
  const measured = cards
    .map((priced) => ({ priced, size: printedSize(priced) }))
    .filter(
      (row): row is { priced: PricedCard; size: number } => row.size !== null
    );

  it('reads every priced kg, l and ud card of the fixtures', () => {
    expect(cards).toHaveLength(58);
    const byMeasure = (measure: string) =>
      cards.filter((priced) => priced.measure === measure).length;
    expect([byMeasure('l'), byMeasure('kg'), byMeasure('ud')]).toEqual([
      45, 12, 1,
    ]);
  });

  it('measures all but the cards whose name states no size in their family', () => {
    expect(measured).toHaveLength(57);
  });

  it.each(measured.map(({ priced, size }) => [priced.card.name, priced, size]))(
    '%s: price over price per unit is the printed size, within 10%%',
    (_name, priced, size) => {
      const { price, perUnit } = priced as PricedCard;
      const implied = price / perUnit;
      expect(
        Math.abs(implied - (size as number)) / (size as number)
      ).toBeLessThan(0.1);
    }
  );

  it('names, from the label the adapter builds, the basis of its measure_unit', () => {
    for (const { card, measure } of cards) {
      const label = readCard(card, []).unitPriceLabel;
      expect(unitBasisOf(label)).toBe(BASIS_OF_MEASURE[measure]);
    }
  });
});
