#!/usr/bin/env node
/**
 * The second checksum, demonstrated.
 *
 *   node vat-check.mjs <reading.json> --vat "10:7.74:0.77,21:0.12:0.03,4:3.65:0.15"
 *
 * `schema.json` keeps only a scalar `taxTotal`, so `validate.mjs` cannot see the
 * `DESGLOSE I.V.A.` block at all. This tool takes that block by hand and shows
 * what capturing it would buy, which is three checks the line-vs-total sum cannot
 * make:
 *
 *   1. Each VAT group is internally consistent: base * rate == tax.
 *   2. The groups gross up to the printed total: sum(base + tax) == total.
 *   3. Each group's gross is reachable as a subset of the line totals.
 *
 * Check 3 is the interesting one. A Spanish receipt is tax inclusive, so every
 * line belongs to exactly one VAT group and each group's gross is the sum of its
 * own lines. That means the tax block **partitions the lines**, and a partition
 * that cannot be satisfied localizes the error to a group rather than merely
 * saying the receipt does not add up.
 */
import { readFileSync } from 'node:fs';

const CENTS = (v) => Math.round(v * 100);
const EUR = (c) => (c / 100).toFixed(2);

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const vatArg = args[args.indexOf('--vat') + 1];

if (!file || !vatArg || args.indexOf('--vat') === -1) {
  console.error(
    'usage: node vat-check.mjs <reading.json> --vat "rate:base:tax,..."'
  );
  process.exit(2);
}

const groups = vatArg.split(',').map((part) => {
  const [rate, base, tax] = part.split(':').map(Number);
  return { rate, base, tax };
});

const reading = JSON.parse(readFileSync(file, 'utf8'));
const lines = (reading.lines ?? []).filter(
  (l) => typeof l.lineTotal === 'number' && Number.isFinite(l.lineTotal)
);
const lineCents = lines.map((l) => CENTS(l.lineTotal));
const total = CENTS(reading.total);

/** Can any subset of the line totals reach exactly `target` cents? */
function reachable(target) {
  if (target < 0) return false;
  const seen = new Uint8Array(target + 1);
  seen[0] = 1;
  for (const value of lineCents) {
    for (let i = target; i >= value; i--) {
      if (seen[i - value]) seen[i] = 1;
    }
  }
  return seen[target] === 1;
}

console.log(`${file}`);
console.log(
  `  lines ${lines.length}, line sum ${EUR(lineCents.reduce((a, b) => a + b, 0))}, total ${EUR(total)}\n`
);

let grossSum = 0;
let problems = 0;
const failed = [];

for (const group of groups) {
  const { rate, base, tax } = group;
  const expectedTax = Math.round(CENTS(base) * (rate / 100));
  const gross = CENTS(base) + CENTS(tax);
  grossSum += gross;

  const taxOk = Math.abs(expectedTax - CENTS(tax)) <= 1;
  const subsetOk = reachable(gross);
  group.gross = gross;

  console.log(
    `  ${String(rate).padStart(2)}%  base ${EUR(CENTS(base))}  tax ${EUR(CENTS(tax))}  gross ${EUR(gross)}` +
      `   ${taxOk ? 'consistent' : `INCONSISTENT (base*${rate}% = ${EUR(expectedTax)})`}` +
      `   ${subsetOk ? 'lines reach it' : 'NO SUBSET OF LINES REACHES IT'}`
  );
  if (!taxOk || !subsetOk) {
    problems++;
    failed.push(group);
  }
}

console.log('');
// Each group's tax is rounded to the cent independently, so with three groups the
// grosses can miss the printed total by a cent or two without anything being
// wrong. Ticket 9 misses by exactly 0.01 and its reading is perfect.
const drift = Math.abs(grossSum - total);
if (drift <= groups.length) {
  console.log(
    `  groups gross to ${EUR(grossSum)} == total ${EUR(total)}   OK` +
      (drift > 0 ? `   (${drift}c of per-group rounding)` : '')
  );
} else {
  console.log(
    `  groups gross to ${EUR(grossSum)} but total is ${EUR(total)}   OFF BY ${EUR(grossSum - total)}`
  );
  problems++;

  // When exactly one group failed its subset test, the others are trusted and
  // the failing group's true gross is whatever the total has left over. That
  // turns "this receipt does not add up" into "this figure was misread, and it
  // should have been this", which is the whole point of a second checksum.
  if (failed.length === 1) {
    const others = groups.filter((g) => g !== failed[0]);
    const implied = total - others.reduce((a, g) => a + g.gross, 0);
    const impliedBase = Math.round(implied / (1 + failed[0].rate / 100));
    console.log(
      `\n  the ${failed[0].rate}% group is the only one its lines cannot reach, so its true gross is\n` +
        `  ${EUR(total)} - ${others.map((g) => EUR(g.gross)).join(' - ')} = ${EUR(implied)}` +
        `   (base ${EUR(impliedBase)}, tax ${EUR(implied - impliedBase)})` +
        `${reachable(implied) ? ', which the lines do reach' : ''}`
    );
  }
}

process.exit(problems === 0 ? 0 : 1);
