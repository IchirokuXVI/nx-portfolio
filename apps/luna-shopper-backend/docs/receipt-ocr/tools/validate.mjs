#!/usr/bin/env node
/**
 * The deterministic checker. No model is involved.
 *
 *   node validate.mjs <ticketDir>          score every reading in the folder
 *   node validate.mjs --diff a.json b.json compare two readings line by line
 *
 * A till receipt carries its own checksum: the lines have to sum to the total.
 * That is what lets an extraction be scored with no ground truth and no human,
 * and it is the whole reason this approach is trustworthy enough to write
 * prices with. It catches invented numbers. It cannot catch a misread timestamp
 * or a misread product name, because nothing on the paper constrains those.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

/** Cents of slack per comparison, for the receipt's own rounding. */
const EPS = 0.02;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Half of the last decimal place the quantity was printed to, which is how far
 * the true quantity can sit from the printed one.
 *
 * An integer gets zero: `2` means two of them, not "between 1.5 and 2.5", so an
 * integer line is still checked exactly. `0.1` gets 0.05. The decimals are
 * counted off the value as read, which is the only record of how the till
 * printed it.
 */
function quantitySlack(q) {
  if (Number.isInteger(q)) return 0;
  const decimals = String(q).split('.')[1]?.length ?? 0;
  return 0.5 * 10 ** -decimals;
}

export function check(receipt) {
  const problems = [];
  const lines = receipt.lines ?? [];

  lines.forEach((line, i) => {
    const q = num(line.quantity);
    const up = num(line.unitPrice);
    const lt = num(line.lineTotal);
    const disc = num(line.discount) ?? 0;
    if (q === null || up === null || lt === null) return;

    // A weighed line's quantity is a ROUNDED DISPLAY VALUE, so q * up does not
    // equal the line total and is not meant to. Super Cash prints kg to one
    // decimal: `0'1 x 13'90 = 0'90` is a correct line for 0.0647 kg. Checking it
    // strictly flags every weighed line on that chain as an error.
    //
    // So the quantity is treated as an interval. `0.1` printed to one decimal
    // means [0.05, 0.15), and the line passes if the printed total falls in the
    // range that interval allows. An integer quantity has no slack and is
    // checked exactly, which is where a real transposition still gets caught.
    const slack = quantitySlack(q) * up;
    const expected = round2(q * up - disc);
    if (Math.abs(expected - lt) > EPS + slack) {
      const label = (line.rawText ?? '').slice(0, 26);
      problems.push(
        `line ${i + 1} "${label}": ${q} x ${up} - ${disc} = ${expected}, printed ${lt}` +
          (slack > 0 ? ` (rounding allows +/-${round2(slack)})` : '')
      );
    }
  });

  const sum = lines.reduce((acc, l) => acc + (num(l.lineTotal) ?? 0), 0);
  const missing = lines.filter((l) => num(l.lineTotal) === null).length;
  const receiptDiscount = num(receipt.receiptDiscount) ?? 0;
  const net = round2(sum - receiptDiscount);
  const total = num(receipt.total);
  const subtotal = num(receipt.subtotal);

  // Slack grows with line count: every line can carry its own half cent.
  const slack = EPS * Math.max(1, lines.length / 10);

  if (subtotal !== null && Math.abs(net - subtotal) > slack) {
    problems.push(`lines net to ${net}, subtotal says ${subtotal}`);
  }
  if (total !== null && Math.abs(net - total) > slack) {
    problems.push(`lines net to ${net}, total says ${total}`);
  }
  if (total === null) problems.push('no total read');
  if (missing > 0) problems.push(`${missing} line(s) with no lineTotal`);
  if (receipt.datetime && Number.isNaN(Date.parse(receipt.datetime))) {
    problems.push(`unparseable datetime "${receipt.datetime}"`);
  }
  if (receipt.datetime && Date.parse(receipt.datetime) > Date.now() + 864e5) {
    problems.push('datetime is in the future');
  }
  for (const line of lines) {
    if (/\d+[.,]\d{2}\s*$/.test(line.rawText ?? '')) {
      problems.push(`rawText carries a price: "${line.rawText}"`);
      break;
    }
  }

  const departments = lines.filter((l) => l.isDepartment === true);
  return {
    lines: lines.length,
    departments: departments.length,
    departmentValue: round2(
      departments.reduce((a, l) => a + (num(l.lineTotal) ?? 0), 0)
    ),
    sum: round2(sum),
    total,
    problems,
    balanced: problems.length === 0,
  };
}

const args = process.argv.slice(2);

if (args[0] === '--diff') {
  const [a, b] = args
    .slice(1, 3)
    .map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const key = (l) =>
    (l.rawText ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
  const mapA = new Map(a.lines.map((l) => [key(l), l]));
  const mapB = new Map(b.lines.map((l) => [key(l), l]));
  console.log(
    `A ${a.lines.length} lines / total ${a.total}     B ${b.lines.length} lines / total ${b.total}`
  );
  for (const k of new Set([...mapA.keys(), ...mapB.keys()])) {
    const la = mapA.get(k);
    const lb = mapB.get(k);
    if (!la) {
      console.log(`  only in B: ${k}`);
      continue;
    }
    if (!lb) {
      console.log(`  only in A: ${k}`);
      continue;
    }
    for (const field of [
      'quantity',
      'unitPrice',
      'lineTotal',
      'discount',
      'isDepartment',
    ]) {
      if ((la[field] ?? null) !== (lb[field] ?? null)) {
        console.log(
          `  ${field} differs on "${k}": A=${la[field] ?? 'null'} B=${lb[field] ?? 'null'}`
        );
      }
    }
  }
  process.exit(0);
}

const target = args[0];
if (!target) {
  console.error('usage: node validate.mjs <ticketDir>');
  process.exit(2);
}

const files =
  existsSync(target) && readdirSync(target, { withFileTypes: true }).length >= 0
    ? readdirSync(target)
        .filter((f) => f.endsWith('.json') && f !== 'usage.json')
        .map((f) => join(target, f))
    : [target];

for (const file of files) {
  let result;
  try {
    result = check(JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    console.log(`UNREADABLE  ${basename(file)}  ${error.message}`);
    continue;
  }
  const tag = result.balanced ? 'BALANCED' : 'MISMATCH';
  console.log(
    `${tag}  ${basename(file).padEnd(28)} ${result.lines} lines ` +
      `(${result.departments} dept, ${result.departmentValue}) sum ${result.sum} total ${result.total}`
  );
  for (const problem of result.problems) console.log(`    - ${problem}`);
}
