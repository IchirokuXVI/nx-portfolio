#!/usr/bin/env node
/**
 * Turns a directory of per page model readings, plus one leaflet's own small
 * `leaflet.json`, into ONE harvest document for a named chain.
 *
 *   node apps/luna-shopper-backend/harvester/tools/leaflet/build-document.mjs \
 *     --readings <dir of page_NN.json> --leaflet <leaflet.json> \
 *     --chain <slug> --out <out.json> [--update-baseline]
 *
 * The readings are what `chains/<slug>/prompt.txt` asks a model for, one JSON
 * array per page, named `page_NN.json`. They and the PDF are working material
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
import { toHarvestDocument } from './to-harvest-document.mjs';

const HERE = new URL('.', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1'
);

/** The reading's own size token, mapped onto format.unit. Generic across
 * chains: the units a Spanish leaflet prints are the same whoever prints it. */
const FORMAT_UNITS = { kg: 'kg', g: 'g', l: 'l', ml: 'ml', ud: 'unit', m: 'm' };

/** What a comparison badge footer names, read from the words it prints. */
const PER_WORDS = [
  [/100\s*ml/i, '100ml'],
  [/100\s*g/i, '100g'],
  [/LITRO/i, 'l'],
  [/KILO/i, 'kg'],
  [/LAVADO/i, 'wash'],
  [/METRO/i, 'm'],
  [/UNIDAD/i, 'unit'],
];

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

const num = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
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

/** The comparison line's basis, read from the words the badge footer prints. */
function readPer(label) {
  if (!label) {
    return null;
  }
  for (const [pattern, per] of PER_WORDS) {
    if (pattern.test(label)) {
      return per;
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
  const dir = join(HERE, 'chains', chain);
  const headings = await import(pathToFileURL(join(dir, 'headings.mjs')).href);
  return {
    dir,
    sections: headings.SECTIONS ?? {},
    fixedSections: headings.FIXED_SECTIONS ?? {},
    toolName: headings.TOOL_NAME ?? null,
  };
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
        '--chain <slug> --out <out.json> [--update-baseline]'
    );
    process.exit(2);
  }

  const IN_DIR = resolve(readingsDir);
  const LEAFLET_PATH = resolve(leafletPath);
  const OUT = resolve(out);
  const REPORT = OUT.replace(/\.json$/, '.report.json');

  const {
    sections: SECTIONS,
    fixedSections: chainFixedSections,
    toolName: chainToolName,
  } = await loadChain(chain);

  const leafletJson = JSON.parse(readFileSync(LEAFLET_PATH, 'utf8'));
  const PDF = resolve(dirname(LEAFLET_PATH), leafletJson.pdf);
  const PAGE_COUNT = leafletJson.page_count;
  const FIXED_SECTIONS = {
    ...chainFixedSections,
    ...(leafletJson.fixed_sections ?? {}),
  };
  const tool = leafletJson.extraction?.tool ?? chainToolName;
  const extractedAt = leafletJson.extraction?.date ?? new Date().toISOString();

  const warnings = [];
  const notes = [];
  const files = readdirSync(IN_DIR)
    .filter((name) => /^page_\d+\.json$/.test(name))
    .sort();

  const offers = [];
  const pages = [];

  for (const file of files) {
    const page = Number(file.slice(5, 7));
    const read = JSON.parse(readFileSync(join(IN_DIR, file), 'utf8'));
    if (!Array.isArray(read)) {
      warnings.push({ page, message: 'the page reading is not a JSON array' });
      continue;
    }

    const printed =
      read.length > 0 ? ((read[0].categoryPath ?? [])[0] ?? null) : null;
    let section = FIXED_SECTIONS[page] ?? null;
    if (printed) {
      section = SECTIONS[fold(printed)] ?? null;
      if (section === null) {
        warnings.push({
          page,
          message:
            'the heading "' +
            printed +
            '" has no slug in the schema vocabulary',
        });
      }
    }

    read.forEach((tile, index) => {
      const id = 'p' + pad(page) + '-o' + pad(index + 1);
      const name = str(tile.name);
      if (!name) {
        warnings.push({
          page,
          message: id + ' has no product name and was dropped',
        });
        return;
      }
      const price = num(tile.price);
      if (price === null) {
        warnings.push({
          page,
          message: id + ' (' + name + ') printed no price and was dropped',
        });
        return;
      }

      const leaflet = tile.leaflet ?? {};
      const basis = str(leaflet.basis) ?? 'unit';
      const sizeFormat = str(tile.sizeFormat)?.toLowerCase() ?? null;
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
      const quantity = num(tile.unitSize);

      // A pack of loose items states how many it holds, which the schema calls
      // pack_count rather than a quantity with a unit.
      const isPackOfItems =
        basis === 'pack' && unit === 'unit' && quantity !== null;

      const format = {};
      const raw = str(leaflet.format);
      if (raw) {
        format.raw = raw;
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
      const brand = str(tile.brand);
      if (brand) {
        product.brand = brand;
      }
      if (Object.keys(format).length > 0) {
        product.format = format;
      }

      const pricing = { price: money(price), basis };
      const wasPrice = num(leaflet.wasPrice);
      if (wasPrice !== null) {
        pricing.was_price = money(wasPrice);
        pricing.discount_pct =
          Math.round(((wasPrice - price) / wasPrice) * 1000) / 10;
      }
      const unitPrice = num(tile.unitPrice);
      const label = str(tile.unitPriceLabel);
      if (unitPrice !== null) {
        const per = readPer(label);
        if (per === null) {
          warnings.push({
            page,
            message:
              id +
              ' compares at ' +
              unitPrice +
              ' but its footer "' +
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
        loyalty: { required: leaflet.loyalty === true },
        source: 'vision',
      };
      if (leaflet.promotion) {
        const type = str(leaflet.promotion.type);
        const rawText = str(leaflet.promotion.rawText);
        if (type && rawText) {
          offer.promotion = { type, raw_text: rawText };
        } else {
          warnings.push({
            page,
            message:
              id +
              ' read a promotion with no wording, so it was left off the offer',
          });
        }
      }
      offers.push(offer);
    });

    pages.push({
      number: page,
      section,
      section_raw: printed,
      has_text_layer: false,
      offer_count: read.length,
    });
  }

  // Whatever this leaflet's own printed validity said, verbatim, so a null
  // bound and its warning read the same as they would by hand.
  const from = str(leafletJson.validity?.from);
  const until = str(leafletJson.validity?.until);
  const rawText = str(leafletJson.validity?.raw_text);
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
      file: basename(PDF),
      sha256: createHash('sha256').update(readFileSync(PDF)).digest('hex'),
      page_count: PAGE_COUNT,
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

  writeFileSync(OUT, JSON.stringify(document, null, 2) + '\n', 'utf8');

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
    knownSections: new Set(Object.values(SECTIONS)),
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
    bySection,
    byBasis: offers.reduce((acc, offer) => {
      acc[offer.pricing.basis] = (acc[offer.pricing.basis] ?? 0) + 1;
      return acc;
    }, {}),
    warnings: document.warnings ?? [],
    notes,
    statistics,
  };

  writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');

  if (has('--update-baseline')) {
    const baselinePath = join(HERE, 'chains', chain, 'baseline.json');
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
      (document.warnings ?? []).length
  );
}

if (process.argv[1] && basename(process.argv[1]) === 'build-document.mjs') {
  main(process.argv);
}
