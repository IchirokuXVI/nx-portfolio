/**
 * How often two rows in one batch would collide (plan 0002, "What was
 * measured").
 *
 * The table in that plan is the output of this file, and it is checked in so
 * that the table can be re-run rather than believed. A batched walk is only
 * worth building if the re-ask rate is small, and the rate is a property of a
 * real assortment rather than of the design, so it has to be counted.
 *
 * The artifact is the catalog dump, whose rows are in creation order, so it is
 * a record of a real run's CREATE decisions. A collision is counted when a row's
 * query would retrieve a row earlier in its own batch. The predicate is
 * Postgres's own stemming, read out of the `search_es` tsvector the dump
 * carries, and a retrieval is every lexeme of the query name appearing in the
 * other document, which is what `to_tsquery` does with an AND.
 *
 * It over counts on purpose. The literal recheck and the top 8 limit both narrow
 * the real search and are not modeled, `normalizeName` strips accents the index
 * keeps so some real queries answer fewer rows, and every row here is a creation
 * while a real queue is part LINK. The one effect the other way is the trigram
 * branch. See the plan for what that means for the number.
 *
 * Usage: node libs/luna-shopper/curation-cli/tools/collision-rate.mjs [dump.sql]
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import { readFileSync } from 'node:fs';

const DUMP =
  process.argv[2] ?? 'D:/Projects/catalog-seed/catalog-seed-20260902.sql';

const normalizeName = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function splitValues(body) {
  const fields = [];
  let i = 0;
  let cur = '';
  let inStr = false;
  while (i < body.length) {
    const c = body[i];
    if (inStr) {
      if (c === "'" && body[i + 1] === "'") {
        cur += "'";
        i += 2;
        continue;
      }
      if (c === "'") {
        inStr = false;
        i++;
        continue;
      }
      cur += c;
      i++;
      continue;
    }
    if (c === "'") {
      inStr = true;
      i++;
      continue;
    }
    if (c === ',') {
      fields.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  fields.push(cur.trim());
  return fields;
}

const rows = [];
for (const line of readFileSync(DUMP, 'utf8').split('\n')) {
  if (!line.startsWith('INSERT INTO public.items VALUES (')) continue;
  const open = line.indexOf('VALUES (') + 'VALUES ('.length;
  const close = line.lastIndexOf(') ON CONFLICT');
  if (close < 0) continue;
  const f = splitValues(line.slice(open, close));
  let name;
  try {
    name = JSON.parse(f[3]);
  } catch {
    continue;
  }
  const lex = new Set();
  for (const m of (f[12] ?? '').matchAll(/'([^']+)':([0-9A-D,]+)/g)) {
    if (/A/.test(m[2])) lex.add(m[1]);
  }
  rows.push({ es: name.es ?? '', key: normalizeName(name.es ?? ''), lex });
}

/** Row i retrieves row j when every lexeme of i's name is in j's document. */
const retrieves = (i, j) =>
  i.lex.size > 0 && [...i.lex].every((l) => j.lex.has(l));

/** Fixed windows: take them in order, W at a time. */
function fixedBatches(w) {
  const out = [];
  for (let i = 0; i < rows.length; i += w) out.push(rows.slice(i, i + w));
  return out;
}

/**
 * Composed batches: fill up to W, but never admit a row whose normalized name
 * already sits in this batch. A deferred row waits for the next batch, which is
 * where the sequential walk would have seen the earlier one's creation anyway.
 */
function composedBatches(w) {
  const out = [];
  const pending = [...rows];
  while (pending.length > 0) {
    const batch = [];
    const keys = new Set();
    const deferred = [];
    while (pending.length > 0 && batch.length < w) {
      const row = pending.shift();
      if (keys.has(row.key)) {
        deferred.push(row);
        continue;
      }
      keys.add(row.key);
      batch.push(row);
    }
    out.push(batch);
    pending.unshift(...deferred);
  }
  return out;
}

function measure(batches) {
  let collisions = 0;
  let considered = 0;
  for (const batch of batches) {
    for (let i = 1; i < batch.length; i++) {
      considered++;
      for (let j = 0; j < i; j++) {
        if (retrieves(batch[i], batch[j])) {
          collisions++;
          break;
        }
      }
    }
  }
  return { collisions, considered, rate: collisions / considered };
}

console.log(
  `${rows.length} creations in order, ${new Set(rows.map((r) => r.key)).size} distinct names\n`
);
console.log(
  '        fixed windows          composed batches (same name never shares a batch)'
);
console.log(
  'width   re-ask%   speedup     re-ask%   speedup   batches   avg width'
);
for (const w of [2, 4, 6, 8]) {
  const fixed = measure(fixedBatches(w));
  const comp = composedBatches(w);
  const c = measure(comp);
  const avg = rows.length / comp.length;
  const sp = (r) => (2.25 / (1 + r)).toFixed(2);
  console.log(
    `${String(w).padStart(5)}   ${(fixed.rate * 100).toFixed(1).padStart(6)}%   ${sp(fixed.rate).padStart(5)}x     ` +
      `${(c.rate * 100).toFixed(1).padStart(6)}%   ${sp(c.rate).padStart(5)}x   ${String(comp.length).padStart(7)}   ${avg.toFixed(2).padStart(9)}`
  );
}
