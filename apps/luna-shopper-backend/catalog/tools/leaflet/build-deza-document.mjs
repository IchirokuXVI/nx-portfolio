#!/usr/bin/env node
/**
 * Turns a directory of per page model readings into ONE harvest document.
 *
 *   node apps/luna-shopper-backend/catalog/tools/leaflet/build-deza-document.mjs \
 *     [--in <dir of page_NN.json>] [--pdf <file.pdf>] [--out <out.json>]
 *
 * The readings are what `prompt-deza.txt` asks a model for, one JSON array per
 * page, named `page_NN.json`. They and the PDF are working material and are not
 * committed: they live under `tmp/leaflet`, which is where the defaults point.
 *
 * The target is the schema the app validates an upload against,
 * libs/luna-shopper/contracts/src/schemas/harvest-document/harvest-document-1.schema.ts
 * (backend plan 0086, section 6.1), which is the one file schema the harvester's
 * file import reads whoever produced the file. Everything this file decides that
 * the page did not print is listed in the report it writes beside the document.
 *
 * **The leaflet shape survives only as this script's assembly step.** The tiles
 * are gathered into it because it is the shape `to-harvest-document.mjs` applies
 * the three price rules to, and that script is the only place those rules live.
 * Nothing is written in the leaflet shape any more and nothing validates against
 * it: plan 0086 deleted that schema.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { toHarvestDocument } from './to-harvest-document.mjs';

const HERE = new URL('.', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1'
);
/** tools/leaflet, tools, catalog, luna-shopper-backend, apps, then the root. */
const REPO = join(HERE, '..', '..', '..', '..', '..');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? resolve(args[at + 1]) : fallback;
};

const IN_DIR = flag('--in', join(REPO, 'tmp', 'leaflet', 'deza-import'));
const PDF = flag('--pdf', join(REPO, 'tmp', 'Folleto-Deza-Septiembre-26.pdf'));
const OUT = flag(
  '--out',
  join(REPO, 'tmp', 'leaflet', 'deza.harvest-document.json')
);
const REPORT = OUT.replace(/\.json$/, '.report.json');
const PAGE_COUNT = 62;

/** The printed heading, mapped onto the schema's own department vocabulary. */
const SECTIONS = {
  FRUTERIA: 'fruteria',
  PESCADERIA: 'pescaderia',
  CARNICERIA: 'carniceria',
  'ELABORADOS CARNICOS': 'elaborados-carnicos',
  CHARCUTERIA: 'charcuteria',
  'CHARCUTERIA AL CORTE': 'charcuteria',
  'PLATOS PREPARADOS': 'platos-preparados',
  REFRIGERADOS: 'refrigerados',
  CONGELADOS: 'congelados',
  'ACEITES Y SALSAS': 'despensa',
  ALIMENTACION: 'despensa',
  'DESAYUNOS Y MERIENDAS': 'desayunos-meriendas',
  APERITIVOS: 'aperitivos',
  BEBIDAS: 'bebidas',
  'CERVEZAS Y VINOS': 'bodega',
  PERFUMERIA: 'perfumeria',
  LIMPIEZA: 'limpieza',
  AMBIENTACION: 'ambientacion',
  'BAZAR - ESPECIAL PISO DE ESTUDIANTES': 'bazar',
  'VUELTA AL COLE': 'vuelta-al-cole',
};

/** Pages that carry no heading because they are not a department. */
const FIXED_SECTIONS = { 1: 'cover', 2: 'index', 3: 'index', 62: 'back-cover' };

/** The reading's own size token, mapped onto format.unit. */
const FORMAT_UNITS = { kg: 'kg', g: 'g', l: 'l', ml: 'ml', ud: 'unit', m: 'm' };

/** What the badge footer compares by, read from the words it prints. */
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
          'the heading "' + printed + '" has no slug in the schema vocabulary',
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

// The only period this leaflet prints. It sits under the back to school banner
// on page 3 and names no start, so plan 0081 section 5 makes the admin's
// override mandatory. It is recorded rather than widened to the whole leaflet.
const VALIDITY_RAW = 'hasta el 15 de septiembre del 2026';
warnings.push({
  page: 3,
  message:
    'the only printed period is an end date, and it is printed under the ' +
    'VUELTA AL COLE banner rather than over the whole leaflet. starts_on is ' +
    'null and the grocery sections may run to a different day, so both bounds ' +
    'need the admin override the spawn already requires.',
  raw_text: VALIDITY_RAW,
});

// The assembly step. Not a file, not a contract: the input the price rules read.
const assembled = {
  schema_version: '1.0',
  source: {
    file: 'Folleto-Deza-Septiembre-26.pdf',
    sha256: createHash('sha256').update(readFileSync(PDF)).digest('hex'),
    page_count: PAGE_COUNT,
    extraction: {
      method: 'vision',
      tool: 'claude-sonnet-5 via Claude Code, prompt-deza-import.txt',
      extracted_at: new Date().toISOString(),
      render_dpi: 128,
    },
  },
  retailer: {
    name: 'Deza',
    chain_id: 'deza',
    country: 'ES',
    currency: 'EUR',
    language: 'es',
  },
  validity: {
    starts_on: null,
    ends_on: '2026-09-15',
    raw_text: VALIDITY_RAW,
  },
  pages,
  offers,
  warnings,
};

// The three price rules run here, in the one place they live, and this is what
// is written: a HarvestDocument and nothing else.
const document = toHarvestDocument(assembled, { input: 'deza-import/' });

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
};

writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');

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
