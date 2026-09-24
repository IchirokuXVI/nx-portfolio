#!/usr/bin/env node
/**
 * Turns a directory of per page model readings, plus one leaflet's own small
 * `leaflet.json`, into ONE harvest document for a named chain.
 *
 *   node libs/luna-shopper/tools/leaflet/cli/src/build-document.mjs \
 *     --readings <dir of page_NN.json> --leaflet <leaflet.json> \
 *     --chain <slug> --out <out.json> [--update-baseline] [--strict]
 *
 * `cli.mjs` runs this as a child process at step 7 of a read. It is still a
 * script an operator runs by hand, which is what the usage line above is.
 *
 * The readings are what `chains/<slug>/prompt.txt` asks a model for, one JSON
 * array per page, named `page_NN.json`. Every chain's prompt asks for one row
 * shape, and every row goes through `readRow` (`reading.mjs`) before anything
 * here reads it, so a reading in the older flat shape El Jamon's prompt used to
 * ask for still builds. A key neither shape names is printed once per page, and
 * `--strict` refuses to write a document while there is one. They and the PDF are working material
 * and are not committed: they live under `tmp/leaflet`, which is where a
 * chain's own import folder sits.
 *
 * `--chain` resolves `chains/<slug>/`, which holds everything that differs by
 * chain: the prompt, the department heading vocabulary, a page layout
 * description for a person to check before reading, and the baseline this
 * reading's own statistics are compared against. Everything that instead
 * differs by LEAFLET, a single chain prints several of, lives in `--leaflet`'s
 * small JSON file beside the readings: which PDF this is, how many pages,
 * which ones carry no department heading, the printed validity window, and
 * which tool actually read it. A value that changes leaflet to leaflet must
 * never be hardcoded here or in a chain's own script.
 *
 * The target is the schema the app validates an upload against,
 * libs/luna-shopper/contracts/src/schemas/harvest-document/harvest-document-1.schema.ts
 * (backend plan 0086, section 6.1), which is the one file schema the
 * harvester's file import reads whoever produced the file. Everything this
 * script decides that the page did not print is listed in the report it
 * writes beside the document.
 *
 * **The leaflet shape survives only as this script's assembly step.** The
 * tiles are gathered into it because it is the shape `to-harvest-document.mjs`
 * applies the three price rules to, and that script is the only place those
 * rules live. Nothing is written in the leaflet shape any more and nothing
 * validates against it: plan 0086 deleted that schema.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHAINS_DIR } from './chains.mjs';
import { readRow, unknownKeys } from './reading.mjs';
import { toHarvestDocument } from './to-harvest-document.mjs';

/** The reading's own size token, mapped onto format.unit. Generic across
 * chains: the units a Spanish leaflet prints are the same whoever prints it. */
const FORMAT_UNITS = { kg: 'kg', g: 'g', l: 'l', ml: 'ml', ud: 'unit', m: 'm' };

/**
 * What a comparison line is per, read from the words it prints. The spelled out
 * words come first because Deza prints them; the abbreviations are what Dia,
 * LIDL and El Jamon print (`1,23 €/kg`, `3,63 €/l`, `La ud sale a 0,66 €`).
 * Order matters: `100 ml` before `ml`, `ml` and `kg` before `l` and `g`.
 */
const PER_WORDS = [
  [/100\s*ml/i, '100ml'],
  [/100\s*g/i, '100g'],
  [/LITRO/i, 'l'],
  [/KILO/i, 'kg'],
  [/LAVADO/i, 'wash'],
  [/METRO/i, 'm'],
  [/UNIDAD/i, 'unit'],
  [/\bkg\b/i, 'kg'],
  [/\bml\b/i, 'ml'],
  [/\bl\b/i, 'l'],
  [/\bg\b/i, 'g'],
  [/\buds?\b/i, 'unit'],
];

/** The flat shape's `unit_price_per` enum, onto the same vocabulary. */
const PER_TOKENS = {
  l: 'l',
  kg: 'kg',
  g: 'g',
  ml: 'ml',
  unit: 'unit',
  ud: 'unit',
  '100ml': '100ml',
  '100g': '100g',
};

const ACCENTS = {
  A: 0xc1,
  E: 0xc9,
  I: 0xcd,
  O: 0xd3,
  U: 0xda,
  N: 0xd1,
  U2: 0xdc,
};

/** The heading, upper cased with its accents folded away, so one key matches. */
const fold = (value) => {
  let out = value.toUpperCase().trim();
  for (const [plain, code] of Object.entries(ACCENTS)) {
    out = out.split(String.fromCharCode(code)).join(plain[0]);
  }
  return out;
};

const str = (value) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
const pad = (n) => String(n).padStart(2, '0');
const money = (amount) => ({ amount, currency: 'EUR' });

/** A chain slug, title cased into a retailer display name: `el-jamon` becomes
 * `El Jamon`, `deza` stays `Deza`. Deliberately not a per chain field: every
 * chain slug this tool will see is a plain name with no abbreviation a title
 * case cannot recover. */
function chainDisplayName(slug) {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * The comparison line's basis. A stated `unit_price_per` wins, because it is
 * the one field that says it outright; otherwise it is read from the printed
 * wording. Null when neither names one.
 */
export function readPer(label, per = null) {
  const token = typeof per === 'string' ? per.trim().toLowerCase() : '';
  if (PER_TOKENS[token]) {
    return PER_TOKENS[token];
  }
  if (!label) {
    return null;
  }
  for (const [pattern, basis] of PER_WORDS) {
    if (pattern.test(label)) {
      return basis;
    }
  }
  return null;
}

/** A unit price label's pattern, with every printed number folded to `#`, so
 * "LITRO 1'18" and "LITRO 3'61" count as one pattern and a genuinely new
 * footer wording still stands out. */
function labelPattern(label) {
  return label
    .toUpperCase()
    .replace(/[0-9]+(?:[.,'][0-9]+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The statistics `drift-check.mjs` compares against a chain's `baseline.json`.
 * Computed from the finished document alone, so the same function reads a
 * `build-document.mjs` output and a plain `to-harvest-document.mjs` output
 * (El Jamon's) alike: both state a page number in every product's
 * `extra.page`, and both state a resolved department in `extra.section` when
 * they have one, whether that resolution ran in this script's `SECTIONS` map
 * or somewhere upstream of it.
 */
export function computeStatistics(
  document,
  { knownSections = new Set() } = {}
) {
  const products = document.products ?? [];
  const total = products.length;
  const share = (count) =>
    total > 0 ? Math.round((count / total) * 1000) / 1000 : 0;

  const perPage = new Map();
  for (const product of products) {
    const page = product.extra?.page;
    if (typeof page === 'number') {
      perPage.set(page, (perPage.get(page) ?? 0) + 1);
    }
  }
  const counts = [...perPage.values()];
  const mean =
    counts.length > 0
      ? Math.round((counts.reduce((a, b) => a + b, 0) / counts.length) * 100) /
        100
      : 0;
  const max = counts.length > 0 ? Math.max(...counts) : 0;

  const patterns = new Set();
  for (const product of products) {
    const label = product.unit_price?.label;
    if (label) {
      patterns.add(labelPattern(label));
    }
  }

  const headings = new Set();
  const unrecognized = new Set();
  for (const product of products) {
    const printed = product.category_path?.[0] ?? null;
    const slug = product.extra?.section ?? null;
    const heading = printed ?? slug;
    if (!heading) {
      continue;
    }
    headings.add(heading);
    if (slug === null || !knownSections.has(slug)) {
      unrecognized.add(heading);
    }
  }

  return {
    productsPerPage: { mean, max },
    shares: {
      withPrice: share(products.filter((p) => p.price).length),
      withUnitPriceOnly: share(
        products.filter((p) => !p.price && p.unit_price).length
      ),
      withNeither: share(
        products.filter((p) => !p.price && !p.unit_price).length
      ),
      withPromotion: share(products.filter((p) => p.extra?.promotion).length),
      withNullSize: share(products.filter((p) => !p.size).length),
      withBrand: share(products.filter((p) => p.brand).length),
    },
    unitPriceLabelPatterns: [...patterns].sort(),
    headings: [...headings].sort(),
    unrecognizedHeadings: [...unrecognized].sort(),
  };
}

async function loadChain(chain) {
  const dir = join(CHAINS_DIR, chain);
  const headings = await import(pathToFileURL(join(dir, 'headings.mjs')).href);
  return {
    dir,
    sections: headings.SECTIONS ?? {},
    fixedSections: headings.FIXED_SECTIONS ?? {},
    toolName: headings.TOOL_NAME ?? null,
  };
}

/** A calendar day as the schema states one, `YYYY-MM-DD`, and a real one. */
function isDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(value + 'T00:00:00Z');
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/**
 * One tile's own window, or null, with the warning a person needs when the
 * tile printed a date the document cannot carry.
 *
 * A tile prints its own window only as an end ("OFERTA VÁLIDA HASTA EL
 * 14-9-2026"), and the schema requires both bounds, so the start is the
 * leaflet's own start and the product's `extra` says that was assumed.
 */
function tileValidity(read, leafletFrom, id) {
  const text = read.validityText;
  const until = read.validUntil;
  if (until === null) {
    return {
      validity: null,
      warning: text
        ? `${id} prints its own window ("${text}") with no end date the reading could state, so it carries the leaflet's window. Check the page.`
        : null,
    };
  }
  if (!isDay(until)) {
    return {
      validity: null,
      warning: `${id} read validUntil "${until}", which is not a YYYY-MM-DD day, so it carries the leaflet's window.`,
    };
  }
  if (!leafletFrom) {
    return {
      validity: null,
      warning: `${id} prints its own end date ${until}, and the leaflet states no start day to open it with, so it carries no window of its own.`,
    };
  }
  if (until < leafletFrom) {
    return {
      validity: null,
      warning: `${id} ends on ${until}, before the leaflet's own start ${leafletFrom}, so it carries no window of its own. Check the page.`,
    };
  }
  return {
    validity: {
      from: leafletFrom,
      until,
      assumption:
        "The tile printed only an end date, so the window starts on the leaflet's own start day.",
      text,
    },
    warning: null,
  };
}

/**
 * One page's rows, turned into assembled offers.
 *
 * Every row goes through `readRow` first, so this reads one set of names
 * whatever shape the reading came in. Answers the offers, the page summary,
 * the document warnings and the keys this page carried that neither shape
 * names.
 */
function buildPage({ page, rows, sections, fixedSections, leafletFrom }) {
  const warnings = [];
  const offers = [];
  const unknown = new Set();

  if (!Array.isArray(rows)) {
    warnings.push({ page, message: 'the page reading is not a JSON array' });
    return { offers, page: null, warnings, unknown: [] };
  }

  for (const row of rows) {
    for (const key of unknownKeys(row)) {
      unknown.add(key);
    }
  }

  const printed =
    rows.length > 0 ? (readRow(rows[0]).categoryPath[0] ?? null) : null;
  let section = fixedSections[page] ?? null;
  if (printed) {
    section = sections[fold(printed)] ?? null;
    if (section === null) {
      warnings.push({
        page,
        message:
          'the heading "' + printed + '" has no slug in the schema vocabulary',
      });
    }
  }

  rows.forEach((row, index) => {
    const id = 'p' + pad(page) + '-o' + pad(index + 1);
    const read = readRow(row);
    const name = read.name;
    if (!name) {
      warnings.push({
        page,
        message: id + ' has no product name and was dropped',
      });
      return;
    }
    const price = read.price;
    if (price === null) {
      warnings.push({
        page,
        message: id + ' (' + name + ') printed no price and was dropped',
      });
      return;
    }

    const basis = read.basis ?? 'unit';
    const sizeFormat = read.sizeFormat?.toLowerCase() ?? null;
    const unit = sizeFormat ? (FORMAT_UNITS[sizeFormat] ?? null) : null;
    if (sizeFormat && unit === null) {
      warnings.push({
        page,
        message:
          id +
          ' has size token "' +
          sizeFormat +
          '", which is not a format unit',
      });
    }
    const quantity = read.unitSize;

    // A pack of loose items states how many it holds, which the schema calls
    // pack_count rather than a quantity with a unit.
    const isPackOfItems =
      basis === 'pack' && unit === 'unit' && quantity !== null;

    const format = {};
    if (read.format) {
      format.raw = read.format;
    }
    if (isPackOfItems) {
      format.pack_count = Math.round(quantity);
    } else if (quantity !== null) {
      format.quantity = quantity;
      if (unit) {
        format.unit = unit;
      }
    }

    const product = { name };
    if (read.brand) {
      product.brand = read.brand;
    }
    if (Object.keys(format).length > 0) {
      product.format = format;
    }

    const pricing = { price: money(price), basis };
    const wasPrice = read.wasPrice;
    if (wasPrice !== null) {
      pricing.was_price = money(wasPrice);
      pricing.discount_pct =
        Math.round(((wasPrice - price) / wasPrice) * 1000) / 10;
    }
    const unitPrice = read.unitPrice;
    const label = read.unitPriceLabel;
    if (unitPrice !== null) {
      const per = readPer(label, read.unitPricePer);
      if (per === null) {
        warnings.push({
          page,
          message:
            id +
            ' compares at ' +
            unitPrice +
            ' but its label "' +
            label +
            '" names no basis, so the comparison line was dropped',
        });
      } else {
        pricing.unit_price = { amount: unitPrice, currency: 'EUR', per };
        if (label) {
          pricing.unit_price.raw = label;
        }
      }
    }

    const offer = {
      id,
      page,
      section,
      product,
      pricing,
      promotion: null,
      loyalty: { required: read.loyalty },
      source: 'vision',
    };
    if (read.category) {
      offer.category = read.category;
    }

    // Every number a promotion printed is forwarded under the snake_case name
    // `to-harvest-document.mjs` reads. That script decides the till price from
    // `single_unit_price`, so a promotion that loses it states no price, and
    // one that is dropped whole would let the second unit's price through as
    // the till price. So a promotion with no wording is kept, and says so.
    const promotion = read.promotion;
    if (promotion) {
      if (promotion.type) {
        offer.promotion = { type: promotion.type };
        if (promotion.rawText) {
          offer.promotion.raw_text = promotion.rawText;
        } else {
          warnings.push({
            page,
            message:
              id +
              ' read a ' +
              promotion.type +
              ' promotion with no wording. It is kept, because its prices decide the till price, and its wording is for a person to read off the page.',
          });
        }
        if (promotion.requiredQuantity !== null) {
          offer.promotion.required_quantity = promotion.requiredQuantity;
        }
        if (promotion.effectiveUnitPrice !== null) {
          offer.promotion.effective_unit_price = money(
            promotion.effectiveUnitPrice
          );
        }
        if (promotion.totalPrice !== null) {
          offer.promotion.total_price = money(promotion.totalPrice);
        }
        if (promotion.singleUnitPrice !== null) {
          offer.promotion.single_unit_price = money(promotion.singleUnitPrice);
        }
      } else if (
        promotion.rawText ||
        promotion.singleUnitPrice !== null ||
        promotion.totalPrice !== null ||
        promotion.requiredQuantity !== null
      ) {
        warnings.push({
          page,
          message:
            id +
            ' read a promotion with no type, so it was left off the offer and its headline price stands. Check the page.',
        });
      }
    }

    const { validity, warning } = tileValidity(read, leafletFrom, id);
    if (validity) {
      offer.validity = { from: validity.from, until: validity.until };
      offer.validity_assumption = validity.assumption;
    }
    if (read.validityText) {
      offer.validity_text = read.validityText;
    }
    if (warning) {
      warnings.push({ page, message: warning });
    }

    offers.push(offer);
  });

  return {
    offers,
    page: {
      number: page,
      section,
      section_raw: printed,
      has_text_layer: false,
      offer_count: rows.length,
    },
    warnings,
    unknown: [...unknown].sort(),
  };
}

/**
 * The whole build, with no file system: page readings plus one leaflet's
 * `leaflet.json` in, a HarvestDocument and what the report says about it out.
 *
 * `readings` is an array of `{ page, rows }`. `source` names the PDF and its
 * digest, which `main` reads off the disk and a test states outright.
 */
export function buildDocument({
  chain,
  readings,
  leafletJson,
  source,
  sections = {},
  fixedSections: chainFixedSections = {},
  toolName: chainToolName = null,
}) {
  const fixedSections = {
    ...chainFixedSections,
    ...(leafletJson.fixed_sections ?? {}),
  };
  const tool = leafletJson.extraction?.tool ?? chainToolName;
  const extractedAt = leafletJson.extraction?.date ?? new Date().toISOString();

  // Whatever this leaflet's own printed validity said, verbatim, so a null
  // bound and its warning read the same as they would by hand.
  const from = str(leafletJson.validity?.from);
  const until = str(leafletJson.validity?.until);
  const rawText = str(leafletJson.validity?.raw_text);

  const warnings = [];
  const offers = [];
  const pages = [];
  const unknownKeysByPage = [];

  for (const { page, rows } of [...readings].sort((a, b) => a.page - b.page)) {
    const built = buildPage({
      page,
      rows,
      sections,
      fixedSections,
      leafletFrom: from,
    });
    warnings.push(...built.warnings);
    offers.push(...built.offers);
    if (built.page) {
      pages.push(built.page);
    }
    for (const key of built.unknown) {
      unknownKeysByPage.push({ page, key });
    }
  }

  for (const note of leafletJson.notes ?? []) {
    warnings.push({
      page: note.page,
      message: note.message,
      raw_text: note.raw_text ?? rawText,
    });
  }

  const assembled = {
    schema_version: '1.0',
    source: {
      file: source.file,
      sha256: source.sha256,
      page_count: leafletJson.page_count,
      extraction: {
        method: 'vision',
        tool,
        extracted_at: extractedAt,
      },
    },
    retailer: {
      name: chainDisplayName(chain),
      currency: 'EUR',
      campaign: leafletJson.campaign ?? null,
    },
    validity: { starts_on: from, ends_on: until, raw_text: rawText },
    pages,
    offers,
    warnings,
  };

  // The three price rules run here, in the one place they live, and this is
  // what is written: a HarvestDocument and nothing else.
  const document = toHarvestDocument(assembled, { input: `${chain}-import/` });

  return { document, assembled, unknownKeys: unknownKeysByPage };
}

async function main(argv) {
  const args = argv.slice(2);
  const flag = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const has = (name) => args.includes(name);

  const chain = flag('--chain');
  const readingsDir = flag('--readings');
  const leafletPath = flag('--leaflet');
  const out = flag('--out');
  if (!chain || !readingsDir || !leafletPath || !out) {
    console.error(
      'usage: node build-document.mjs --readings <dir> --leaflet <leaflet.json> ' +
        '--chain <slug> --out <out.json> [--update-baseline] [--strict]'
    );
    process.exit(2);
  }

  const IN_DIR = resolve(readingsDir);
  const LEAFLET_PATH = resolve(leafletPath);
  const OUT = resolve(out);
  const REPORT = OUT.replace(/\.json$/, '.report.json');

  const { sections, fixedSections, toolName } = await loadChain(chain);

  const leafletJson = JSON.parse(readFileSync(LEAFLET_PATH, 'utf8'));
  const PDF = resolve(dirname(LEAFLET_PATH), leafletJson.pdf);

  const readings = readdirSync(IN_DIR)
    .filter((name) => /^page_\d+\.json$/.test(name))
    .sort()
    .map((file) => ({
      page: Number(file.slice(5, 7)),
      rows: JSON.parse(readFileSync(join(IN_DIR, file), 'utf8')),
    }));

  const { document, assembled, unknownKeys } = buildDocument({
    chain,
    readings,
    leafletJson,
    source: {
      file: basename(PDF),
      sha256: createHash('sha256').update(readFileSync(PDF)).digest('hex'),
    },
    sections,
    fixedSections,
    toolName,
  });

  // One line per unknown key per page. A key nothing reads is a field a
  // prompt asked for and the builder threw away, which is how a whole chain's
  // loyalty and promotion prices once went missing without a word.
  for (const { page, key } of unknownKeys) {
    console.error(
      `page ${page}: the reading carries "${key}", which no reading shape names, so nothing reads it`
    );
  }
  if (unknownKeys.length > 0 && has('--strict')) {
    console.error(
      `--strict: ${unknownKeys.length} unknown key(s), so no document was written.`
    );
    process.exit(1);
  }

  writeFileSync(OUT, JSON.stringify(document, null, 2) + '\n', 'utf8');

  const { offers, pages } = assembled;
  const bySection = {};
  for (const offer of offers) {
    const key = offer.section ?? '(none)';
    bySection[key] = (bySection[key] ?? 0) + 1;
  }

  const priced = document.products.filter((product) => product.price).length;
  const unitOnly = document.products.filter(
    (product) => !product.price && product.unit_price
  ).length;

  const statistics = computeStatistics(document, {
    knownSections: new Set(Object.values(sections)),
  });

  const report = {
    document: OUT,
    schema:
      'libs/luna-shopper/contracts/src/schemas/harvest-document/harvest-document-1.schema.ts',
    builtAt: assembled.source.extraction.extracted_at,
    products: document.products.length,
    withPrice: priced,
    withUnitPriceOnly: unitOnly,
    withNeither: document.products.length - priced - unitOnly,
    pages: pages.length,
    pagesWithOffers: pages.filter((page) => page.offer_count > 0).length,
    withBrand: offers.filter((offer) => offer.product.brand).length,
    withFormat: offers.filter((offer) => offer.product.format).length,
    withPromotion: offers.filter((offer) => offer.promotion).length,
    withLoyalty: offers.filter((offer) => offer.loyalty.required).length,
    withPromotionPrice: offers.filter(
      (offer) => offer.promotion?.single_unit_price
    ).length,
    withOwnValidity: document.products.filter((product) => product.validity)
      .length,
    bySection,
    byBasis: offers.reduce((acc, offer) => {
      acc[offer.pricing.basis] = (acc[offer.pricing.basis] ?? 0) + 1;
      return acc;
    }, {}),
    unknownKeys,
    warnings: document.warnings ?? [],
    notes: [],
    statistics,
  };

  writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');

  if (has('--update-baseline')) {
    const baselinePath = join(CHAINS_DIR, chain, 'baseline.json');
    writeFileSync(
      baselinePath,
      JSON.stringify(statistics, null, 2) + '\n',
      'utf8'
    );
    console.log(`baseline updated: ${baselinePath}`);
  }

  console.log(
    'products ' +
      document.products.length +
      ', priced ' +
      priced +
      ', unit price only ' +
      unitOnly +
      ', pages ' +
      pages.length +
      ', warnings ' +
      (document.warnings ?? []).length +
      ', unknown keys ' +
      unknownKeys.length
  );
}

if (process.argv[1] && basename(process.argv[1]) === 'build-document.mjs') {
  main(process.argv);
}
