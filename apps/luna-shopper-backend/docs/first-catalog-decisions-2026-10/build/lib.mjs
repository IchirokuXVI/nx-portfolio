// Shared helpers of the build scripts. Nothing here knows a step of plan 0186.
//
// The source folder is the git ignored run folder of the repair
// (`.curation-runs/2026-10-audit-repair` in the checkout that did the work). Pass it as the
// first argument or in CURATION_RUN_DIR. No path of a machine is written in this folder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withOwnerDecision } from './decisions.mjs';

export const SRC = process.argv[2] || process.env.CURATION_RUN_DIR;
if (!SRC || !fs.existsSync(path.join(SRC, 'stage-a-summary.md'))) {
  console.error(
    'Usage: node build/build.mjs <path to .curation-runs/2026-10-audit-repair>\n' +
      '   or: CURATION_RUN_DIR=<that path> node build/build.mjs'
  );
  process.exit(1);
}
export const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

export const text = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
export const J = (f) => JSON.parse(text(f));
export const JL = (f) =>
  text(f)
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));

export const CHAINS = {
  '67f8bec7-f589-4afb-b9c6-e7bbb444b722': 'Mercadona',
  '2df761c8-630a-4bcb-acc9-734c7c7beec3': 'Deza',
  '7b638c0a-708b-45b3-b633-a2e6c8c27c82': 'El Jamón',
};

export const UUID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
export const firstUuid = (s) => (String(s).match(UUID) || [null])[0];

/** Every table of a markdown file, with the heading it stands under. */
export function mdTables(file) {
  const tables = [];
  let section = '';
  let current = null;
  for (const line of text(file).split(/\r?\n/)) {
    if (line.startsWith('#')) {
      section = line.replace(/^#+\s*/, '');
      current = null;
    } else if (line.startsWith('|')) {
      const cells = line
        .replace(/^\|/, '')
        .replace(/\|\s*$/, '')
        .split('|')
        .map((c) => c.trim());
      if (!current) {
        current = { section, header: cells, rows: [] };
        tables.push(current);
      } else if (!cells.every((c) => /^:?-+:?$/.test(c))) {
        const row = {};
        current.header.forEach((h, i) => (row[h] = cells[i] ?? ''));
        current.rows.push(row);
      }
    } else {
      current = null;
    }
  }
  return tables;
}

// ---------------------------------------------------------------------------------------
// Gap counting. `product()` and `row()` shape a natural key and count what is absent.
// ---------------------------------------------------------------------------------------

let gaps = null;
export function startGaps() {
  gaps = {
    products: 0,
    productsWithOnlyTheUuid: 0,
    rows: 0,
    rowsWithNoChain: 0,
    rowsWithNoSourceKind: 0,
    rowsWithNoExternalId: 0,
    rowsWithNoPrintedName: 0,
  };
}
export const takeGaps = () => gaps;

/** A product by its natural keys. `s` is any of the shapes the source files use. */
export function product(id, s) {
  gaps.products++;
  if (!s) {
    gaps.productsWithOnlyTheUuid++;
    return { localId: id };
  }
  return {
    brand: s.brand ?? null,
    nameEs: s.es,
    size: s.size ?? null,
    unit: s.unit ?? null,
    packCount: s.pack ?? null,
    barcode: s.ean ?? null,
    localId: id,
  };
}

/** Any item shape of the source files, as { brand, es, en, size, unit, pack, ean }. */
export function itemState(o) {
  const name = o.name && typeof o.name === 'object' ? o.name : {};
  return {
    brand: o.brand ?? null,
    es: o.es ?? o.nameEs ?? name.es,
    en: o.en ?? o.nameEn ?? name.en ?? null,
    size: o.size ?? o.unitSize ?? null,
    unit: o.unit ?? o.defaultUnit ?? null,
    pack: o.pack ?? o.packCount ?? null,
    ean: o.ean ?? (o.eans && o.eans[0]) ?? null,
    brandId: o.brandId ?? null,
  };
}

/** A queue row by its natural keys. */
export function row(id, s) {
  gaps.rows++;
  const r = {
    chain: s?.chain ?? null,
    sourceKind: s?.sourceKind ?? null,
    externalId: s?.externalId ?? null,
    printedName: s?.name ?? null,
    printedBrand: s?.brand ?? null,
    sizeFormat: s?.sizeFormat ?? null,
    barcode: s?.ean ?? null,
    localId: id,
  };
  if (s?.url && !r.externalId) r.url = s.url;
  if (!r.chain) gaps.rowsWithNoChain++;
  if (!r.sourceKind) gaps.rowsWithNoSourceKind++;
  if (!r.externalId) gaps.rowsWithNoExternalId++;
  if (!r.printedName) gaps.rowsWithNoPrintedName++;
  return r;
}

/** Any row shape of the source files, as the fields `row()` reads. */
export function rowState(o) {
  return {
    chain: o.chain ?? CHAINS[o.supermarketId] ?? null,
    sourceKind: o.sourceKind ?? o.kind ?? null,
    externalId: o.externalId ?? o.ext ?? null,
    name: typeof o.name === 'string' ? o.name : null,
    brand: o.brand ?? null,
    sizeFormat: o.sizeFormat ?? null,
    ean: o.ean ?? null,
    url: o.url ?? null,
  };
}

/** Several reads of one row as one: the first read that holds a field gives it. */
export function firstKnown(...states) {
  const out = {};
  for (const s of states)
    for (const [k, v] of Object.entries(s ?? {})) if (out[k] == null) out[k] = v;
  return out;
}

/**
 * Every queue row any source file prints, by id. A later file fills only the fields an
 * earlier one left empty, so the order of `files` is the order of trust.
 */
export function rowIndex(files) {
  const index = new Map();
  const add = (id, o) => {
    const s = rowState(o);
    const had = index.get(id);
    if (!had) return index.set(id, s);
    for (const k of Object.keys(s)) if (had[k] == null) had[k] = s[k];
  };
  const looksLikeARow = (o) =>
    typeof o.name === 'string' &&
    ['sourceKind', 'kind', 'ext', 'externalId', 'sizeFormat', 'status'].some(
      (k) => k in o
    );
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    if (typeof v.entryId === 'string' && v.row && typeof v.row === 'object')
      add(v.entryId, { ...v.row, ...v, name: v.row.name, brand: v.row.brand });
    else if (typeof v.id === 'string' && UUID.test(v.id) && looksLikeARow(v))
      add(v.id, v);
    Object.values(v).forEach(walk);
  };
  for (const f of files) walk(f.endsWith('.jsonl') ? JL(f) : J(f));
  return index;
}

// ---------------------------------------------------------------------------------------
// Writing. One entry on one line, so that a diff reads and the folder stays small.
// ---------------------------------------------------------------------------------------

export function writeData(file, header, entries) {
  const g = takeGaps();
  const head = { ...header, count: entries.length, naturalKeys: g };
  const lines = JSON.stringify(head, null, 2).replace(/\n}$/, ',');
  const body = entries
    .map((e) => '    ' + JSON.stringify(withOwnerDecision(e)))
    .join(',\n');
  fs.writeFileSync(
    path.join(OUT, file),
    `${lines}\n  "entries": [\n${body}\n  ]\n}\n`
  );
  return { file, step: header.step, count: entries.length, ...g };
}
