#!/usr/bin/env node
/**
 * Converts a leaflet document into a HarvestDocument (backend plan 0086,
 * section 6.1), which is the one file schema the harvester's file import reads.
 *
 *   node apps/luna-shopper-backend/catalog/tools/leaflet/to-harvest-document.mjs \
 *     <in.json> [--out <out.json>] [--pdf <file.pdf>]
 *
 * The input is the leaflet shape of plan 0081: `tmp/leaflet/leaflet.schema.json`
 * and the narrowed copy the backend used to validate uploads against. That
 * schema is deleted by plan 0086. This script exists so the readings already
 * taken are not lost, and so the extractor has a worked example of what it must
 * emit from now on.
 *
 * **The three import rules of plan 0081 section 6 live here now.** They read a
 * tile's promotion, loyalty and basis blocks to decide which number a shopper
 * actually pays for one unit, and those blocks are `extra` in the new schema,
 * which no rule in the backend may read. So the decision belongs to whoever read
 * the leaflet:
 *
 * 1. **Loyalty.** A card price is not the price a non member pays, so a loyalty
 *    gated tile states no price at all and lands in `warnings`.
 * 2. **The promotion.** For a conditional mechanic the headline price is the
 *    second unit's or the bulk unit's, so `single_unit_price` is what a shopper
 *    pays for one. A conditional tile without one states no price: the only
 *    number on it is one nobody can pay for a single unit.
 * 3. **The basis.** A `kg` or `l` basis is not what the till charges for one
 *    pack, so it states `unit_price` alone and no `price`.
 *
 * Everything the leaflet knew and the import does not read goes into each
 * product's `extra`, verbatim: the page, the section, the raw text, the
 * promotion, the loyalty block, the confidence, the ANTES price, the basis, the
 * bounding box and the rest of the printed format. Nothing is thrown away and
 * nothing is interpreted twice.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

/** This converter's own version, written to `producer.version`. */
const PRODUCER_VERSION = '1.0.0';

/**
 * The promotion types whose headline price is **not** what one unit costs.
 *
 * The Radler tile is the case the rule exists for: `price: 0.39` with
 * `single_unit_price: 0.79`. A shopper buying one can is charged 0.79.
 */
const CONDITIONAL_PROMOTIONS = [
  'second_unit_discount',
  'multibuy_unit_price',
  'multibuy_total',
  'buy_n_get_free',
];

/**
 * A promotion that is a card price whatever the loyalty block says.
 *
 * Plan 0081's rule gated on `loyalty.required` alone, and three tiles in
 * `eljamon.leaflet-import.json` carry `loyalty_discount` with `required` unset.
 * The type names the condition, so the type is enough: a discount the card
 * unlocks is not a price a shopper without one pays.
 */
const LOYALTY_PROMOTION = 'loyalty_discount';

/** A basis that prices a weight or a volume rather than a pack. */
const MEASURED_BASES = new Set(['kg', 'l']);

/**
 * Sections that name a place in the leaflet rather than a department, so they
 * are not offered as a category a created item could default to. They stay in
 * `extra.section`, where they say which page the tile was on.
 */
const NON_DEPARTMENT_SECTIONS = new Set([
  'cover',
  'index',
  'back-cover',
  'portada',
  'contraportada',
]);

const num = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const str = (value) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** Drops the keys whose value is null or undefined, so `extra` stays readable. */
function compact(bag) {
  const out = {};
  for (const [key, value] of Object.entries(bag)) {
    if (value !== null && value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * The comparison line as the new schema states it, or null.
 *
 * `label` is text and never a unit (plan 0038, section 2.4), so the printed
 * wording wins over the machine readable `per`, and `per` stands in when the
 * extractor recorded no wording.
 */
function comparisonLine(offer, currency) {
  const line = offer.pricing?.unit_price;
  const amount = num(line?.amount);
  if (amount === null) {
    return null;
  }
  const label = str(line.raw) ?? str(line.per);
  if (!label) {
    return null;
  }
  return compact({ amount, label, currency: str(line.currency) ?? currency });
}

/**
 * Which of a tile's numbers a shopper pays for one unit, by the three rules.
 *
 * Answers `{ price, unit_price, warning }`. A null `price` is not a failure: it
 * is the honest answer for a per kilogram offer, and the import writes the
 * comparison figure alone.
 */
function decidePrice(offer, defaultCurrency, label) {
  const currency = str(offer.pricing?.price?.currency) ?? defaultCurrency;
  const comparison = comparisonLine(offer, currency);
  const promotionType = str(offer.promotion?.type);

  if (offer.loyalty?.required === true || promotionType === LOYALTY_PROMOTION) {
    const program = str(offer.loyalty?.program);
    return {
      price: null,
      unit_price: null,
      warning:
        `${label} needs the chain's loyalty card` +
        (program ? ` (${program})` : '') +
        ', so it states no price: a card price is not the price a non member pays.',
    };
  }

  // Which number a shopper pays for one unit, in whatever the tile's basis is.
  const conditional =
    promotionType !== null && CONDITIONAL_PROMOTIONS.includes(promotionType);
  let chosen;
  if (conditional) {
    chosen = num(offer.promotion?.single_unit_price?.amount);
    if (chosen === null) {
      return {
        price: null,
        unit_price: comparison,
        warning:
          `${label} prints a conditional price (${promotionType}) and no single ` +
          'unit price, so the only number on it is one a shopper cannot pay for one unit.',
      };
    }
  } else {
    chosen = num(offer.pricing?.price?.amount);
  }

  // Where that number goes. A price per kilogram is not what the till charges
  // for one pack, so it is a comparison figure and there is no till price.
  //
  // **The basis is asked after the promotion and about the number the promotion
  // chose**, which is the one place this differs from the rule as plan 0081
  // wrote it. There the two were separate branches and the promotion answered
  // first, so a per kilogram multibuy wrote its single unit price as a till
  // price: 13 tiles of `eljamon.pdftext.json` and 2 of `eljamon.ocr.json`. A
  // single unit price on a kg tile is still per kilogram.
  if (MEASURED_BASES.has(offer.pricing?.basis)) {
    const amount = conditional ? chosen : (comparison?.amount ?? chosen);
    return {
      price: null,
      unit_price:
        amount === null
          ? null
          : compact({
              amount,
              label: comparison?.label ?? offer.pricing.basis,
              currency,
            }),
      warning: null,
    };
  }

  return {
    price:
      chosen === null
        ? null
        : {
            amount: chosen,
            currency: conditional
              ? (str(offer.promotion.single_unit_price.currency) ?? currency)
              : currency,
          },
    unit_price: comparison,
    warning:
      chosen === null
        ? `${label} states no price this script could read.`
        : null,
  };
}

/** The printed size, split into what the row reads and what only a person does. */
function sizeOf(format) {
  if (!format) {
    return { size: null, rest: null };
  }
  const size = compact({
    label: str(format.raw),
    quantity: num(format.quantity),
    unit: str(format.unit),
  });
  const rest = compact({
    container: str(format.container),
    pack_count: num(format.pack_count),
    bonus_units: num(format.bonus_units),
  });
  return {
    size: Object.keys(size).length > 0 ? size : null,
    rest: Object.keys(rest).length > 0 ? rest : null,
  };
}

/** One leaflet document into one harvest document. */
export function toHarvestDocument(leaflet, options = {}) {
  const retailer = leaflet.retailer ?? {};
  const source = leaflet.source ?? {};
  const currency = str(retailer.currency) ?? 'EUR';
  const warnings = [];

  // What every page said, so a tile can borrow its department heading.
  const pageInfo = new Map();
  for (const page of leaflet.pages ?? []) {
    pageInfo.set(page.number, page);
  }

  const products = leaflet.offers.map((offer, index) => {
    const id = str(offer.id) ?? `p-${String(index + 1).padStart(4, '0')}`;
    const name = str(offer.product?.name);
    const page = pageInfo.get(offer.page);
    const section = str(offer.section) ?? str(page?.section);
    const printedSection = str(page?.section_raw) ?? section;
    const { size, rest } = sizeOf(offer.product?.format);
    const label = `${id} (${name ?? 'a tile with no name'})`;
    const decided = decidePrice(offer, currency, label);
    if (decided.warning) {
      warnings.push({
        message: decided.warning,
        product_id: id,
        extra: compact({ page: num(offer.page) }),
      });
    }

    return compact({
      id,
      // No external_id: a leaflet prints no product id, so the import keys the
      // product on its name and its size label (plan 0086, D2).
      name,
      brand: str(offer.product?.brand),
      size,
      price: decided.price,
      unit_price: decided.unit_price,
      // The department the leaflet printed it under, which is the category a
      // created item defaults to. Absent when the page carried no heading,
      // which is every page of a text layer reading, and when the heading names
      // a place in the leaflet rather than a department.
      category_path:
        printedSection && !NON_DEPARTMENT_SECTIONS.has(section ?? '')
          ? [printedSection]
          : null,
      extra: compact({
        page: num(offer.page),
        section,
        section_printed: printedSection === section ? null : printedSection,
        page_has_text_layer:
          typeof page?.has_text_layer === 'boolean'
            ? page.has_text_layer
            : null,
        bbox: Array.isArray(offer.bbox) ? offer.bbox : null,
        basis: str(offer.pricing?.basis),
        headline_price: offer.pricing?.price ?? null,
        was_price: offer.pricing?.was_price ?? null,
        discount_pct: num(offer.pricing?.discount_pct),
        printed_unit_price: offer.pricing?.unit_price ?? null,
        format: rest,
        variants:
          Array.isArray(offer.product?.variants) &&
          offer.product.variants.length > 0
            ? offer.product.variants
            : null,
        promotion: offer.promotion ?? null,
        loyalty: offer.loyalty ?? null,
        legal_note: str(offer.legal_note),
        read_by: str(offer.source),
        confidence: num(offer.confidence),
        raw_text:
          Array.isArray(offer.raw_text) && offer.raw_text.length > 0
            ? offer.raw_text
            : null,
      }),
    });
  });

  // The extractor's own unresolved tiles, after the rules' warnings so the two
  // read in the order they happened.
  for (const warning of leaflet.warnings ?? []) {
    warnings.push(
      compact({
        message: str(warning.message) ?? 'the extractor recorded a warning',
        product_id: null,
        extra: compact({
          page: num(warning.page),
          raw_text: str(warning.raw_text),
        }),
      })
    );
  }

  // Both bounds or none: the new schema states a window as two local days in
  // Spain, and a half open window is the admin's override to supply.
  const from = str(leaflet.validity?.starts_on);
  const until = str(leaflet.validity?.ends_on);
  const validity = from && until ? { from, until } : null;
  if (!validity && (from || until || leaflet.validity?.raw_text)) {
    warnings.push({
      message:
        'The leaflet printed no complete validity window, so this document ' +
        "states none and the import needs the admin's override. What it " +
        'printed: ' +
        (str(leaflet.validity?.raw_text) ??
          `starts_on ${from ?? 'null'}, ends_on ${until ?? 'null'}`),
      product_id: null,
    });
  }

  const sha256 = str(source.sha256) ?? options.sha256 ?? null;
  if (!sha256) {
    throw new Error(
      'the leaflet carries no source.sha256 and no --pdf was given, so the ' +
        'digest the run level dedupe keys on cannot be computed'
    );
  }

  // The new schema has no document level bag, because the import reads nothing
  // there. What the leaflet said about itself, and the chain hint it carried,
  // are named here instead: `producer` is what the run page shows as where the
  // file came from. The chain hint is deliberately dropped, because a slug like
  // `el-jamon` is not an id any deployment holds, and a hint that always fails
  // to resolve is a notice on every import for nothing.
  const producerName = [
    'leaflet-extractor',
    [str(retailer.name), str(retailer.campaign)].filter(Boolean).join(' '),
    str(source.file) ?? basename(options.input ?? 'unknown'),
    source.page_count ? `${source.page_count} pages` : null,
    [str(source.extraction?.method), str(source.extraction?.tool)]
      .filter(Boolean)
      .join(' via '),
  ]
    .filter(Boolean)
    .join(', ');

  return compact({
    schema_version: 1,
    sha256,
    producer: compact({
      name: producerName,
      version: PRODUCER_VERSION,
      produced_at:
        str(source.extraction?.extracted_at) ?? new Date().toISOString(),
    }),
    // Only the source kind, which is what this producer is: a leaflet. The
    // chain and the scope are ids of this deployment's own, and a file produced
    // somewhere else cannot know them.
    hints: { source_kind: 'OFFICIAL_LEAFLET' },
    validity,
    products,
    warnings: warnings.length > 0 ? warnings : null,
  });
}

function main(argv) {
  const args = argv.slice(2);
  const input = args.find((arg) => !arg.startsWith('--'));
  if (!input) {
    console.error(
      'usage: node tools/to-harvest-document.mjs <in.json> [--out <out.json>] [--pdf <file.pdf>]'
    );
    process.exit(2);
  }
  const flag = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const out =
    flag('--out') ?? input.replace(/\.json$/, '.harvest-document.json');
  const pdf = flag('--pdf');

  const leaflet = JSON.parse(readFileSync(resolve(input), 'utf8'));
  const sha256 = pdf
    ? createHash('sha256')
        .update(readFileSync(resolve(pdf)))
        .digest('hex')
    : undefined;

  const document = toHarvestDocument(leaflet, { sha256, input });
  writeFileSync(resolve(out), JSON.stringify(document, null, 2) + '\n', 'utf8');

  const priced = document.products.filter((product) => product.price).length;
  const unitOnly = document.products.filter(
    (product) => !product.price && product.unit_price
  ).length;
  console.log(
    `${out}: ${document.products.length} products, ${priced} with a price, ` +
      `${unitOnly} with a unit price only, ` +
      `${document.products.length - priced - unitOnly} with neither, ` +
      `${(document.warnings ?? []).length} warnings`
  );
}

if (
  process.argv[1] &&
  basename(process.argv[1]) === 'to-harvest-document.mjs'
) {
  main(process.argv);
}
