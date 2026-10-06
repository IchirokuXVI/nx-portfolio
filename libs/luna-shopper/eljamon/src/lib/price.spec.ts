import { UnitOfMeasure } from '@portfolio/luna-shopper/contracts';
import {
  contradictsItsSizeTenfold,
  parseSpanishPrice,
  parseUnitPrice,
} from './price';
import { splitSize } from './size';

describe('parseSpanishPrice', () => {
  it.each([
    ['3,49 €', 3.49],
    ['3,49\u00a0€', 3.49],
    ['3,49&nbsp;€', 3.49],
    ['1.234,5 €', 1234.5],
    ['65 €', 65],
  ])('%s', (printed, expected) => {
    expect(parseSpanishPrice(printed)).toBe(expected);
  });

  it('answers null rather than zero for text with no price', () => {
    expect(parseSpanishPrice('')).toBeNull();
    expect(parseSpanishPrice('POR SÓLO')).toBeNull();
    expect(parseSpanishPrice(null)).toBeNull();
  });
});

describe('parseUnitPrice', () => {
  it('splits the amount from the unit, keeping the label verbatim', () => {
    expect(parseUnitPrice(' 15,31 €/Kilo ')).toEqual({
      unitPrice: 15.31,
      unitPriceLabel: 'Kilo',
    });
    expect(parseUnitPrice('1,36\u00a0€/100gr')).toEqual({
      unitPrice: 1.36,
      unitPriceLabel: '100gr',
    });
  });

  it('answers null when either half is missing', () => {
    expect(parseUnitPrice('15,31 €')).toBeNull();
    expect(parseUnitPrice('/Kilo')).toBeNull();
  });
});

describe('contradictsItsSizeTenfold (plan 0189)', () => {
  /** A row as the listing prints it: a name with its size, a price, a unit price. */
  const contradicts = (description: string, price: number, printed: string) => {
    const unit = parseUnitPrice(printed);
    if (unit === null) {
      throw new Error(`not a unit price: ${printed}`);
    }
    return contradictsItsSizeTenfold(price, unit, splitSize(description));
  };

  // Rows of the first catalog (plan 0186, step A5): the name, the price and
  // the unit price as they were stored from the page, in `a5.read.json`.
  it.each([
    ['ajo troceado, 70g', 2.89, '41,29 €/100gr'],
    ['caña de lomo, 40g', 1.2, '30 €/100gr'],
    ['empanada atún, 700g', 4.95, '7,07 €/100gr'],
    ['pouch ecológico fruta variada, 100g', 1.59, '15,9 €/100gr'],
    ['smoothie mango y melocotón, 250ml', 1.75, '7 €/100ml'],
    ['dentífrico protección caries, 100ml', 1.99, '19,9 €/100ml'],
  ])('%s at %s printed %s is ten times the figure', (name, price, printed) => {
    expect(contradicts(name, price, printed)).toBe(true);
  });

  it.each([
    ['queso edam loncha, 100g', 1.5, '1,5 €/Kilo'],
    ['queso roquefort cuña, 95g', 1.95, '2,05 €/Kilo'],
    ['ventresca atún claro en aceite girasol, 72g', 1.99, '2,76 €/Kilo'],
    ['azafrán molido, 0,40g', 3.85, '96,25 €/100gr'],
    // The chain divided by a size it had rounded, so this one is 1.3% off.
    ['azafrán hebras, 0,375g', 4.45, '117,11 €/100gr'],
  ])('%s at %s printed %s is a tenth of the figure', (name, price, printed) => {
    expect(contradicts(name, price, printed)).toBe(true);
  });

  it.each([
    // The printed figure is the figure. Rows of the two captured listing
    // pages, `category-page-1.html` and `category-page-2.html`.
    ['bacalao ahumado skandia, 80g', 4.25, '5,31 €/100gr'],
    ['queso burgos natural, 900g', 4.25, '4,72 €/Kilo'],
    ['gazpacho fresco de la huerta, 750ml', 3.19, '4,25 €/Litro'],
    // Off, and not by ten: another defect, which this rule does not judge.
    // Rows of `a5.read.json`.
    ['noodles de arroz, 375g', 3.5, '4,67 €/Kilo'],
    ['tostadas trigo sarraceno, 100g', 2.85, '14,25 €/Kilo'],
    ['tarrito frutas variadas, 190g', 1, '1,11 €/Kilo'],
    // Nothing to judge by: no size, or a count. The first three are rows of
    // the captured pages and the last two are rows of `a5.read.json`.
    ['bacon original, kg', 8.95, '8,95 €/Kilo'],
    ['jamón serrano gran reserva, pza', 65, '65,00 €/Unidad'],
    ['burger vacuno alta proteínas 130g, pk-2', 5.95, '22,88 €/Kilo'],
    ['tiritas infantiles, 10ud', 0.52, '0,52 €/Unidad'],
    ['bacon en tiras family 2x100g, pk-2', 1.69, '0,85 €/Kilo'],
  ])('%s at %s printed %s keeps its unit price', (name, price, printed) => {
    expect(contradicts(name, price, printed)).toBe(false);
  });

  it('judges nothing when the size is of another kind than the label', () => {
    // Not a row any page printed: a volume beside a price per kilo, made up
    // here because neither the captures nor the audit hold one.
    expect(contradicts('made up, 200ml', 1.5, '0,75 €/Kilo')).toBe(false);
  });

  it('judges nothing without a price', () => {
    expect(
      contradictsItsSizeTenfold(
        null,
        { unitPrice: 41.29, unitPriceLabel: '100gr' },
        { unitSize: 70, sizeUnit: UnitOfMeasure.GRAM }
      )
    ).toBe(false);
  });
});
