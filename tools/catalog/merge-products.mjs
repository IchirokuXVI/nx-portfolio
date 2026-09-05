// Turns leaflet offers into catalog products, one reviewed batch at a time.
//
//   node tools/catalog/merge-products.mjs next  --catalog c.json --offers a.json b.json --section perfumeria
//   node tools/catalog/merge-products.mjs apply --catalog c.json --offers a.json b.json --decisions d.json
//   node tools/catalog/merge-products.mjs check --catalog c.json --offers a.json b.json
//   node tools/catalog/merge-products.mjs stats --catalog c.json
//
// The judgment stays with the reader. Deciding that two printed names are one
// product needs to know that Hacendado is a Mercadona label and that a 200 ml
// spray is not a 50 ml roll on, and a script that guessed at either would be
// wrong quietly. So this does the two things around the judgment instead.
//
// `next` builds the work packet: the offers still undecided, and for each one
// every product already in the catalog that could plausibly be it, with the
// brand and the format already compared. That lookup is the expensive half, it
// is the half a reader gets wrong by skimming, and it is pure mechanics.
//
// `apply` refuses a decision that breaks a rule: a name that still carries its
// own brand or its own size, a merge onto a different format, a slug that
// repeats. A batch is written whole or not at all, so a rejected file leaves
// the catalog exactly as it was.
//
// Written by hand, like `tools/openapi` and `tools/release`, and for the same
// reason: the shapes are two leaflet documents this repository produced itself.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// --- the vocabulary the catalog is written in --------------------------------

/** `ItemCategory` in `@portfolio/luna-shopper/contracts`. */
const CATEGORIES = new Set([
  'PRODUCE',
  'DAIRY',
  'BAKERY',
  'MEAT',
  'SEAFOOD',
  'FROZEN',
  'PANTRY',
  'BEVERAGES',
  'SNACKS',
  'HOUSEHOLD',
  'PERSONAL_CARE',
  'OTHER',
]);

/** `UnitOfMeasure` in the same file. */
const UNITS = new Set([
  'UNIT',
  'GRAM',
  'KILOGRAM',
  'MILLILITER',
  'LITER',
  'PACK',
]);

/**
 * Own labels and the chain that sells them, so a candidate that cannot be real
 * says so.
 *
 * A private label does not cross a chain, which is what makes most of these
 * comparisons decidable at all: four pairs in the receipt catalog have
 * identical names across two chains and are four different products, because
 * one says Hacendado and the other says Alteza.
 *
 * This is observed from the leaflets and receipts in hand, not a fact about
 * Spanish retail, so a hit only **warns**. The reader can merge over it and
 * `apply` will take the decision; what it will not do is let the merge happen
 * without anybody noticing that it crossed a label.
 */
const PRIVATE_LABELS = new Map(
  Object.entries({
    hacendado: 'mercadona',
    bosqueverde: 'mercadona',
    deliplus: 'mercadona',
    delikuit: 'mercadona',
    compy: 'mercadona',
    nuske: 'mercadona',
    steinburg: 'mercadona',
    comotu: 'mercadona',
    alteza: 'deza',
    rikisssimo: 'deza',
    eliges: 'el-jamon',
    ifaeliges: 'el-jamon',
    ifasabe: 'el-jamon',
    ifaunnia: 'el-jamon',
    ifaamigo: 'el-jamon',
    eljamon: 'el-jamon',
  })
);

// --- normalizing, which is the whole of the mechanical half ------------------

/** Lowercase, unaccented, single spaced. Spanish makes the accents mandatory. */
const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** A brand compares without its spaces and punctuation: `ElPozo` is `El Pozo`. */
const brandKey = (s) => fold(s).replace(/[^a-z0-9]/g, '');

/** Bigram Dice coefficient, for "these two strings are nearly the same word". */
function dice(a, b) {
  const A = fold(a);
  const B = fold(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const grams = (s) => {
    const out = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };
  const ga = grams(A);
  const gb = grams(B);
  let shared = 0;
  let total = 0;
  for (const n of ga.values()) total += n;
  for (const [g, n] of gb) {
    total += n;
    shared += Math.min(n, ga.get(g) ?? 0);
  }
  return total === 0 ? 0 : (2 * shared) / total;
}

/**
 * A format reduced to a dimension and one number, so 1.5 L and 1500 ml compare.
 *
 * Returns null when the source printed no format at all, which is a real state
 * and not a zero: a hair dye sold by the box has no volume, and two of them
 * are not therefore the same size.
 */
function formatKey(unit, size, packCount) {
  const u = String(unit ?? '').toUpperCase();
  const n = Number(size);
  if (u === 'PACK' || packCount) {
    const count = Number(packCount ?? size);
    return Number.isFinite(count) && count > 0
      ? { dim: 'count', base: count }
      : null;
  }
  if (!Number.isFinite(n) || n <= 0) return null;
  if (u === 'MILLILITER') return { dim: 'volume', base: n };
  if (u === 'LITER') return { dim: 'volume', base: n * 1000 };
  if (u === 'GRAM') return { dim: 'mass', base: n };
  if (u === 'KILOGRAM') return { dim: 'mass', base: n * 1000 };
  if (u === 'UNIT') return { dim: 'count', base: n };
  return null;
}

const sameFormat = (a, b) =>
  a && b && a.dim === b.dim && Math.abs(a.base - b.base) < 1e-6;

const showFormat = (k) =>
  k
    ? `${k.base} ${{ volume: 'ml', mass: 'g', count: 'ud' }[k.dim]}`
    : 'no format';

/** The leaflet's own unit words, mapped onto the catalog's enum. */
function unitFromLeaflet(format) {
  const raw = fold(format?.unit);
  if (format?.pack_count) return 'PACK';
  if (raw === 'ml') return 'MILLILITER';
  if (raw === 'l' || raw === 'litro' || raw === 'litros') return 'LITER';
  if (raw === 'g' || raw === 'gr' || raw === 'gramos') return 'GRAM';
  if (raw === 'kg' || raw === 'kilo' || raw === 'kilos') return 'KILOGRAM';
  if (raw === 'unit' || raw === 'ud' || raw === 'uds') return 'UNIT';
  return null;
}

// --- reading the two file shapes --------------------------------------------

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/**
 * Every offer in a leaflet document, flattened and stamped with its chain.
 *
 * Both documents this repository produces share `offers[].product` and
 * `offers[].pricing`, so one reader covers Deza and El Jamón. The chain comes
 * from `retailer.chain_id` rather than the filename, because the filename is
 * whatever somebody typed.
 */
function readOffers(paths) {
  const out = [];
  for (const path of paths) {
    const doc = readJson(path);
    const chain = doc.retailer?.chain_id;
    if (!chain) throw new Error(`${path}: no retailer.chain_id`);
    for (const o of doc.offers ?? []) {
      const f = o.product?.format ?? {};
      out.push({
        key: `${chain}/${o.id}`,
        chain,
        id: o.id,
        page: o.page ?? null,
        section: o.section ?? null,
        printedName: o.product?.name ?? '',
        printedBrand: o.product?.brand ?? null,
        variants: o.product?.variants ?? [],
        formatRaw: f.raw ?? null,
        unit: unitFromLeaflet(f),
        size: f.pack_count ?? f.quantity ?? null,
        packCount: f.pack_count ?? null,
        price: o.pricing?.price?.amount ?? null,
        rawText: o.raw_text ?? null,
        file: path,
      });
    }
  }
  return out;
}

function readCatalog(path) {
  try {
    const doc = readJson(path);
    return { version: 1, products: [], ...doc };
  } catch (err) {
    if (err.code === 'ENOENT') return { version: 1, products: [] };
    throw err;
  }
}

function writeCatalog(path, catalog) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
}

// --- next: the work packet ---------------------------------------------------

/**
 * Products this offer could be, best first.
 *
 * The rule the reader is applying is "same brand and same format merges, and
 * nothing else does", so that pair decides the order: an exact brand with an
 * exact format is a real candidate and everything else is context. A fuzzy
 * brand is still listed, because `ElPozo` and `El Pozo` were two brands in the
 * catalog until somebody noticed.
 */
function candidatesFor(offer, products) {
  const offerFormat = formatKey(offer.unit, offer.size, offer.packCount);
  const oBrand = brandKey(offer.printedBrand);
  const out = [];

  for (const p of products) {
    const pBrand = brandKey(p.brand);
    const brandMatch =
      oBrand && pBrand && oBrand === pBrand
        ? 'exact'
        : oBrand && pBrand && dice(oBrand, pBrand) >= 0.7
          ? 'fuzzy'
          : null;
    const nameScore = Math.max(
      dice(offer.printedName, p.name?.es ?? ''),
      dice(offer.printedName, p.name?.en ?? '')
    );
    if (!brandMatch && nameScore < 0.45) continue;

    const pFormat = formatKey(p.defaultUnit, p.unitSize, null);
    const formatMatch = sameFormat(offerFormat, pFormat)
      ? 'exact'
      : !offerFormat || !pFormat
        ? 'unknown'
        : 'differs';

    const label = PRIVATE_LABELS.get(pBrand);
    out.push({
      slug: p.slug,
      name: p.name,
      brand: p.brand,
      format: showFormat(pFormat),
      brandMatch,
      formatMatch,
      nameScore: Number(nameScore.toFixed(2)),
      mergeable: brandMatch === 'exact' && formatMatch === 'exact',
      blocked:
        label && label !== offer.chain
          ? `${p.brand} is an own label of ${label}, so it cannot be on a ${offer.chain} shelf`
          : null,
    });
  }

  const rank = (c) =>
    (c.mergeable ? 0 : 1) * 100 +
    (c.brandMatch === 'exact' ? 0 : c.brandMatch === 'fuzzy' ? 10 : 20) -
    c.nameScore;
  return out.sort((a, b) => rank(a) - rank(b)).slice(0, 6);
}

function cmdNext(opts) {
  const catalog = readCatalog(opts.catalog);
  const offers = readOffers(opts.offers);
  const decided = new Set(
    catalog.products.flatMap((p) =>
      (p.offers ?? []).map((o) => `${o.chain}/${o.id}`)
    )
  );

  let pool = offers.filter((o) => !decided.has(o.key));
  if (opts.section) {
    const want = fold(opts.section);
    pool = pool.filter(
      (o) => fold(o.section) === want || String(o.page) === opts.section
    );
  }
  if (opts.pages) {
    const pages = new Set(opts.pages.split(',').map((p) => Number(p.trim())));
    pool = pool.filter((o) => pages.has(o.page));
  }
  const limit = Number(opts.limit ?? 40);
  const batch = pool.slice(0, limit);

  const packet = {
    batch: {
      requested: limit,
      offered: batch.length,
      remainingAfter: pool.length - batch.length,
      section: opts.section ?? null,
      pages: opts.pages ?? null,
    },
    catalogSize: catalog.products.length,
    offers: batch.map((o) => ({
      key: o.key,
      chain: o.chain,
      id: o.id,
      page: o.page,
      section: o.section,
      printedName: o.printedName,
      printedBrand: o.printedBrand,
      variants: o.variants,
      printedFormat: o.formatRaw,
      unit: o.unit,
      size: o.size,
      price: o.price,
      rawText: o.rawText,
      candidates: candidatesFor(o, catalog.products),
    })),
  };
  process.stdout.write(JSON.stringify(packet, null, 2) + '\n');
}

// --- apply: the rules a decision has to survive ------------------------------

const SIZE_IN_NAME =
  /(^|[\s(,])\d+([.,]\d+)?\s?(g|gr|kg|ml|cl|l|litros?|uds?|unidades)\b|\bpack\b|\b\d+\s?x\s?\d+/i;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Check one authored product, returning the problems with it.
 *
 * Every rule here is one somebody already got wrong once, which is why it is a
 * refusal and not a warning: a name that repeats its own brand was in the seed
 * catalog for months, and a size inside a name is the thing that makes two
 * formats of one product look like two unrelated rows.
 */
function validateProduct(p, index) {
  const at = `products[${index}] ${p.slug ?? '(no slug)'}`;
  const errs = [];

  if (!p.slug || !SLUG.test(p.slug))
    errs.push(`${at}: slug must be kebab-case`);

  // A merge names a product that already passed all of this. Restating its
  // name and category would be a second copy to keep in step, so a merge row
  // carries the slug it joins and the offers it brings and nothing else.
  if (p.mergeInto) {
    if (!Array.isArray(p.offers) || p.offers.length === 0) {
      errs.push(`${at}: merges into ${p.mergeInto} but brings no offer`);
    }
    return errs;
  }

  for (const loc of ['en', 'es']) {
    if (!p.name?.[loc]?.trim()) errs.push(`${at}: name.${loc} is empty`);
  }
  if (!CATEGORIES.has(p.category))
    errs.push(`${at}: unknown category ${p.category}`);
  if (!UNITS.has(p.defaultUnit))
    errs.push(`${at}: unknown defaultUnit ${p.defaultUnit}`);

  for (const loc of ['en', 'es']) {
    const n = p.name?.[loc] ?? '';
    if (p.brand && fold(n).includes(fold(p.brand))) {
      errs.push(`${at}: name.${loc} still carries the brand "${p.brand}"`);
    }
    if (SIZE_IN_NAME.test(n)) {
      errs.push(
        `${at}: name.${loc} still carries a size; it belongs in unitSize`
      );
    }
  }

  if (!Array.isArray(p.offers) || p.offers.length === 0) {
    errs.push(`${at}: no source offer`);
  }
  return errs;
}

function cmdApply(opts) {
  const catalog = readCatalog(opts.catalog);
  const offers = readOffers(opts.offers);
  const byKey = new Map(offers.map((o) => [o.key, o]));
  const decisions = readJson(opts.decisions);
  const incoming = decisions.products ?? [];

  const errs = [];
  const existing = new Map(catalog.products.map((p) => [p.slug, p]));
  const seenSlugs = new Set();

  incoming.forEach((p, i) => {
    errs.push(...validateProduct(p, i));

    if (!p.mergeInto) {
      if (p.slug && seenSlugs.has(p.slug)) {
        errs.push(`products[${i}] ${p.slug}: slug repeats inside this batch`);
      }
      seenSlugs.add(p.slug);
    }

    const target = p.mergeInto ? existing.get(p.mergeInto) : null;
    if (p.mergeInto && !target) {
      errs.push(
        `products[${i}] ${p.slug}: mergeInto "${p.mergeInto}" is not in the catalog`
      );
    }
    if (!p.mergeInto && existing.has(p.slug)) {
      errs.push(
        `products[${i}] ${p.slug}: already in the catalog; use mergeInto to add an offer to it`
      );
    }

    for (const src of p.offers ?? []) {
      const key = `${src.chain}/${src.id}`;
      const offer = byKey.get(key);
      if (!offer) {
        errs.push(
          `products[${i}] ${p.slug}: offer ${key} is not in any offers file`
        );
        continue;
      }

      // The brand has to be somewhere in the offer, and either place counts:
      // printed as the brand, or inside the printed name.
      //
      // The second case is the ordinary one for a line. The El Jamón leaflet
      // files "Champú Elvive" under L'Oréal, and Elvive is the word printed
      // largest on the bottle, the word a shopper types, and therefore the
      // brand this catalog records. What the rule stops is the other thing,
      // which is a brand nobody printed at all.
      const t = target ?? p;
      if (t.brand && !p.force) {
        const asBrand = brandKey(offer.printedBrand) === brandKey(t.brand);
        const inName = fold(offer.printedName).includes(fold(t.brand));
        if (!asBrand && !inName) {
          errs.push(
            `products[${i}] ${p.slug}: brand "${t.brand}" appears nowhere in offer ${key} ` +
              `("${offer.printedName}", printed brand "${offer.printedBrand ?? 'none'}")`
          );
        }
      }
      if (target) {
        const a = formatKey(target.defaultUnit, target.unitSize, null);
        const b = formatKey(offer.unit, offer.size, offer.packCount);
        if (a && b && !sameFormat(a, b) && !p.force) {
          errs.push(
            `products[${i}] ${p.slug}: merges onto ${target.slug} (${showFormat(a)}) ` +
              `but the offer is ${showFormat(b)}`
          );
        }
        if (p.force && !p.forceWhy) {
          errs.push(`products[${i}] ${p.slug}: force needs forceWhy`);
        }
      }
    }
  });

  // Coverage: an offer may become several products, but none may be forgotten.
  if (decisions.batch?.keys) {
    const referenced = new Set(
      incoming.flatMap((p) => (p.offers ?? []).map((o) => `${o.chain}/${o.id}`))
    );
    for (const key of decisions.batch.keys) {
      if (!referenced.has(key))
        errs.push(`offer ${key} was in the batch and got no decision`);
    }
  }

  if (errs.length) {
    for (const e of errs) console.error(`  ${e}`);
    console.error(`\n${errs.length} problem(s). Nothing was written.`);
    process.exit(1);
  }

  let created = 0;
  let mergedInto = 0;
  for (const p of incoming) {
    if (p.mergeInto) {
      const t = existing.get(p.mergeInto);
      t.offers = [...(t.offers ?? []), ...p.offers];
      if (p.note) t.notes = [...(t.notes ?? []), p.note];
      mergedInto++;
    } else {
      const { mergeInto, force, forceWhy, note, ...row } = p;
      if (forceWhy) row.forcedBecause = forceWhy;
      if (note) row.notes = [note];
      catalog.products.push(row);
      existing.set(row.slug, row);
      created++;
    }
  }

  writeCatalog(opts.catalog, catalog);
  console.log(
    `${created} product(s) created, ${mergedInto} offer set(s) merged into an existing product; ` +
      `catalog now holds ${catalog.products.length}`
  );
}

// --- check and stats ---------------------------------------------------------

function cmdCheck(opts) {
  const catalog = readCatalog(opts.catalog);
  const errs = catalog.products.flatMap((p, i) => validateProduct(p, i));

  const slugs = catalog.products.map((p) => p.slug);
  for (const s of new Set(slugs)) {
    if (slugs.filter((x) => x === s).length > 1)
      errs.push(`slug ${s} appears more than once`);
  }

  if (opts.offers?.length) {
    const offers = readOffers(opts.offers);
    const referenced = new Set(
      catalog.products.flatMap((p) =>
        (p.offers ?? []).map((o) => `${o.chain}/${o.id}`)
      )
    );
    const unknown = [...referenced].filter(
      (k) => !offers.some((o) => o.key === k)
    );
    for (const k of unknown)
      errs.push(`offer ${k} is referenced but is in no offers file`);
    const undecided = offers.filter((o) => !referenced.has(o.key));
    console.log(
      `${offers.length} offer(s) read, ${undecided.length} still undecided`
    );
  }

  if (errs.length) {
    for (const e of errs) console.error(`  ${e}`);
    console.error(`\n${errs.length} problem(s).`);
    process.exit(1);
  }
  console.log(`${catalog.products.length} product(s), no problems.`);
}

function cmdStats(opts) {
  const catalog = readCatalog(opts.catalog);
  const byChain = new Map();
  let multi = 0;
  for (const p of catalog.products) {
    const chains = new Set((p.offers ?? []).map((o) => o.chain));
    if (chains.size > 1) multi++;
    for (const c of chains) byChain.set(c, (byChain.get(c) ?? 0) + 1);
  }
  console.log(`products                : ${catalog.products.length}`);
  console.log(`sold by more than one   : ${multi}`);
  for (const [c, n] of [...byChain].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(22)}: ${n}`);
  }
  const noBrand = catalog.products.filter((p) => !p.brand).length;
  const noSize = catalog.products.filter((p) => p.unitSize == null).length;
  console.log(`without a brand         : ${noBrand}`);
  console.log(`without a size          : ${noSize}`);
}

// --- argv --------------------------------------------------------------------

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { offers: [] };
  let key = null;
  for (const token of rest) {
    if (token.startsWith('--')) {
      key = token.slice(2);
      if (key !== 'offers') opts[key] = true;
      else opts.offers = [];
      continue;
    }
    if (key === 'offers') opts.offers.push(token);
    else if (key) opts[key] = token;
  }
  return { command, opts };
}

const { command, opts } = parseArgs(process.argv.slice(2));
const commands = {
  next: cmdNext,
  apply: cmdApply,
  check: cmdCheck,
  stats: cmdStats,
};

if (!commands[command]) {
  console.error(
    'usage: merge-products.mjs <next|apply|check|stats> --catalog <file> [--offers <file...>]\n' +
      '                          [--section <name>] [--pages 1,2] [--limit 40] [--decisions <file>]'
  );
  process.exit(2);
}
if (!opts.catalog) {
  console.error('--catalog is required');
  process.exit(2);
}
commands[command](opts);
