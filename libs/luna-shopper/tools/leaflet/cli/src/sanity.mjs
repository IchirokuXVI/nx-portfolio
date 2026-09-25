/**
 * Six checks against what a printed page can support, run over every reading
 * whatever produced it.
 *
 * A warning that says a reading may be wrong is worth much less than one that
 * says which rows, so every check names the page, the product and the rule. The
 * checks are arithmetic and structural, so they hold for any chain and any
 * model, and every model has a systematic defect of its own: only the defect
 * differs. `gemma4:12b` invented a single unit price on 9 of 9 price drop tiles,
 * and Gemini halved a second unit tile's total.
 *
 * **Nothing here edits a row and nothing drops one.** A leaflet is allowed to
 * print something strange and the pages are the authority, not this table. What
 * the run owes the operator is a list of places to look. The drift check in step
 * 7 is the one that refuses.
 *
 * **Every row is read through `readRow`** (`reading.mjs`), the same function
 * the builder reads it with. Every chain prompt asks for one shape now, and the
 * readings El Jamon's prompt produced in the older flat shape still read, so a
 * check never passes a whole chain because it was reading a key that is not
 * there.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import { warning } from './read-pages.mjs';
import { readRow } from './reading.mjs';

export { readRow };

/** Two prices are the same number when they are this close. */
const CENT = 0.005;

/** How a row is named in a warning. */
const label = (read, index) => read.name ?? `row ${index + 1}`;

/**
 * The six checks, each named exactly as the plan's table names it.
 *
 * Each one takes one page's rows and answers warnings. They are separate
 * functions because each is tested against a reading built to break exactly
 * that one.
 */
export const CHECKS = [
  {
    name: 'price drop with an invented quantity or unit price',
    run(page, rows) {
      const out = [];
      rows.forEach((row, index) => {
        const read = readRow(row);
        if (read.promotion?.type !== 'price_drop') {
          return;
        }
        const invented = [];
        if (read.promotion.requiredQuantity !== null) {
          invented.push(`required_quantity ${read.promotion.requiredQuantity}`);
        }
        if (read.promotion.singleUnitPrice !== null) {
          invented.push(`single_unit_price ${read.promotion.singleUnitPrice}`);
        }
        if (invented.length === 0) {
          return;
        }
        out.push(
          warning(
            this.name,
            page,
            `a price drop tile prints neither, and this row carries ${invented.join(' and ')}. ` +
              'to-harvest-document.mjs reads single_unit_price to decide what one unit costs, so an invented one becomes a price in the catalog.',
            label(read, index)
          )
        );
      });
      return out;
    },
  },
  {
    name: 'second unit price does not add up',
    run(page, rows) {
      const out = [];
      rows.forEach((row, index) => {
        const read = readRow(row);
        if (read.promotion?.type !== 'second_unit_discount') {
          return;
        }
        const { totalPrice, singleUnitPrice } = read.promotion;
        if (
          read.price === null ||
          totalPrice === null ||
          singleUnitPrice === null
        ) {
          return;
        }
        const expected = totalPrice - singleUnitPrice;
        if (Math.abs(read.price - expected) <= CENT) {
          return;
        }
        out.push(
          warning(
            this.name,
            page,
            `price ${read.price} is not total_price ${totalPrice} minus single_unit_price ${singleUnitPrice}, which is ${Math.round(expected * 100) / 100}`,
            label(read, index)
          )
        );
      });
      return out;
    },
  },
  {
    name: 'was price is not above the price',
    run(page, rows) {
      const out = [];
      rows.forEach((row, index) => {
        const read = readRow(row);
        if (read.wasPrice === null || read.price === null) {
          return;
        }
        if (read.wasPrice > read.price) {
          return;
        }
        out.push(
          warning(
            this.name,
            page,
            `was_price ${read.wasPrice} is not above price ${read.price}, which is a swap or a misread digit`,
            label(read, index)
          )
        );
      });
      return out;
    },
  },
  {
    name: 'row with no number at all',
    run(page, rows) {
      const out = [];
      rows.forEach((row, index) => {
        const read = readRow(row);
        if (read.price !== null || read.unitPrice !== null) {
          return;
        }
        // A loyalty gated tile is the one row that states no number on
        // purpose: a card price is not the price a non member pays, so the
        // rules keep it off the document and that is its reason.
        if (read.loyalty) {
          return;
        }
        out.push(
          warning(
            this.name,
            page,
            'the row has no price, no unit price and no loyalty flag to explain it, so it is a tile the model saw and could not read',
            label(read, index)
          )
        );
      });
      return out;
    },
  },
  {
    name: 'unit price with no basis',
    run(page, rows) {
      const out = [];
      rows.forEach((row, index) => {
        const read = readRow(row);
        if (read.unitPrice === null || read.unitPriceBasis) {
          return;
        }
        out.push(
          warning(
            this.name,
            page,
            `unit_price ${read.unitPrice} names no basis, and a unit price that cannot be compared has no purpose`,
            label(read, index)
          )
        );
      });
      return out;
    },
  },
  {
    name: 'two rows share a name and a price',
    run(page, rows) {
      const out = [];
      const seen = new Map();
      rows.forEach((row, index) => {
        const read = readRow(row);
        if (read.name === null) {
          return;
        }
        const key = `${read.name.trim().toLowerCase()}|${read.price}`;
        if (!seen.has(key)) {
          seen.set(key, index);
          return;
        }
        out.push(
          warning(
            this.name,
            page,
            `the same name and price as row ${seen.get(key) + 1} on this page, which is the duplicate a merge or a re-read leaves behind`,
            label(read, index)
          )
        );
      });
      return out;
    },
  },
];

/**
 * Every check over every page, in page order.
 *
 * `readings` is a Map of page number to the rows read for it, which is what the
 * page loop and the manual pick up both answer.
 */
export function sanityPass(readings, checks = CHECKS) {
  const warnings = [];
  for (const page of [...readings.keys()].sort((a, b) => a - b)) {
    const rows = readings.get(page) ?? [];
    for (const check of checks) {
      warnings.push(...check.run(page, rows));
    }
  }
  return warnings;
}
