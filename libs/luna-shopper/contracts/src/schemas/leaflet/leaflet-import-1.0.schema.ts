import type { JsonSchema } from '../builders';

/**
 * The leaflet import contract, version 1.0 (plan 0081, section 4).
 *
 * `tmp/leaflet/leaflet.schema.json` is the **extractor's** schema and stays so.
 * This is the schema the gateway and the harvester validate an upload against,
 * narrowed and versioned, because a schema that lives only in `tmp/` drifts: the
 * extractor changes a field, nothing in the build notices, and the first
 * document that reaches the gateway fails on a shape nobody reviewed.
 *
 * **A new version is a new file and a new const.** The `$id` carries the version
 * and `schema_version` is a `const`, so a document names the schema it was
 * written for and the harvester accepts every version it can read
 * ({@link LEAFLET_IMPORT_SCHEMA_IDS}).
 *
 * What is narrowed against the extractor's own schema, and why:
 *
 * - **`source.sha256` is required.** Section 7's dedupe keys on it, and the
 *   extractor already computes it.
 * - **`source.extraction`, `pages` and `bbox` are optional.** They describe how
 *   the document was produced. The import does not read them.
 * - **`offers[].confidence` and `offers[].raw_text` are optional and stay.**
 *   They are what an admin wants when a queued row is in front of him.
 * - **`warnings` stays**, so the extractor's own dropped tiles are carried into
 *   the run's warnings beside what the import skipped.
 * - `additionalProperties: false` throughout, as in the source schema.
 */
export const LEAFLET_IMPORT_1_0_SCHEMA_ID =
  'https://ichirokuxvi.com/schemas/leaflet-import-1.0.json';

/** The value `schema_version` must hold for this schema to accept a document. */
export const LEAFLET_IMPORT_1_0_VERSION = '1.0';

const money = (description: string): JsonSchema => ({
  type: 'object',
  description,
  required: ['amount', 'currency'],
  additionalProperties: false,
  properties: {
    amount: { type: 'number', minimum: 0 },
    currency: { type: 'string', pattern: '^[A-Z]{3}$' },
  },
});

const offer: JsonSchema = {
  type: 'object',
  required: ['id', 'page', 'product', 'pricing', 'source'],
  additionalProperties: false,
  properties: {
    id: {
      type: 'string',
      minLength: 1,
      description: 'Stable within one leaflet, for example p05-o03.',
    },
    page: { type: 'integer', minimum: 1 },
    // Where the tile sat on the page. Kept so a document is not refused for
    // carrying it, and read by nothing here.
    bbox: {
      type: 'array',
      items: { type: 'number', minimum: 0, maximum: 1 },
      minItems: 4,
      maxItems: 4,
    },
    section: { type: ['string', 'null'] },
    product: {
      type: 'object',
      required: ['name'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1 },
        brand: { type: ['string', 'null'] },
        variants: { type: 'array', items: { type: 'string' } },
        format: {
          type: 'object',
          additionalProperties: false,
          properties: {
            raw: { type: ['string', 'null'] },
            container: { type: ['string', 'null'] },
            quantity: { type: ['number', 'null'] },
            unit: {
              enum: ['ml', 'l', 'g', 'kg', 'cl', 'unit', 'm', 'wash', null],
            },
            pack_count: { type: ['integer', 'null'] },
            bonus_units: { type: ['integer', 'null'] },
          },
        },
      },
    },
    pricing: {
      type: 'object',
      required: ['price', 'basis'],
      additionalProperties: false,
      properties: {
        price: money('The large advertised price.'),
        basis: {
          enum: ['unit', 'pack', 'kg', 'l', 'piece'],
          description:
            'What the advertised price buys. A kg or l basis writes a unit price and no till price (section 6.1).',
        },
        was_price: money('The struck through ANTES price.'),
        discount_pct: { type: ['number', 'null'], minimum: 0, maximum: 100 },
        unit_price: {
          type: 'object',
          description:
            'The small comparison line. Written to unitPrice and unitPriceLabel verbatim, never converted.',
          additionalProperties: false,
          properties: {
            amount: { type: 'number' },
            currency: { type: 'string', pattern: '^[A-Z]{3}$' },
            per: { enum: ['l', 'kg', 'unit', 'wash', 'm', '100ml', '100g'] },
            raw: { type: 'string' },
          },
        },
      },
    },
    promotion: {
      type: ['object', 'null'],
      description:
        'The mechanic printed on the tile. Which number is the price reads this (section 6.2).',
      required: ['type', 'raw_text'],
      additionalProperties: false,
      properties: {
        type: {
          enum: [
            'price_drop',
            'second_unit_discount',
            'multibuy_unit_price',
            'multibuy_total',
            'n_for_m',
            'buy_n_get_free',
            'pack_bonus',
            'loyalty_discount',
          ],
        },
        raw_text: { type: 'string' },
        required_quantity: { type: ['integer', 'null'] },
        paid_quantity: { type: ['integer', 'null'] },
        free_quantity: { type: ['integer', 'null'] },
        discount_pct: { type: ['number', 'null'], minimum: 0, maximum: 100 },
        single_unit_price: money(
          'What one unit costs without taking the deal. The number a conditional tile writes as price.'
        ),
        effective_unit_price: money('Price per unit once the deal applies.'),
        total_price: money('Total for the required quantity.'),
        effective_unit_price_note: { type: 'string' },
      },
    },
    loyalty: {
      type: 'object',
      description:
        'A loyalty gated offer is skipped entirely and recorded as a warning (section 6.3).',
      additionalProperties: false,
      properties: {
        required: { type: 'boolean' },
        program: { type: ['string', 'null'] },
      },
    },
    legal_note: { type: ['string', 'null'] },
    source: { enum: ['ocr', 'pdf-text', 'vision'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    raw_text: { type: 'array', items: { type: 'string' } },
  },
};

export const leafletImport10Schema: JsonSchema = {
  $id: LEAFLET_IMPORT_1_0_SCHEMA_ID,
  title: 'LeafletImport',
  description:
    'One supermarket leaflet and every offer printed in it, as an admin uploads it (plan 0081).',
  type: 'object',
  required: ['schema_version', 'source', 'retailer', 'validity', 'offers'],
  additionalProperties: false,
  properties: {
    schema_version: { const: LEAFLET_IMPORT_1_0_VERSION },
    source: {
      type: 'object',
      required: ['file', 'sha256', 'page_count'],
      additionalProperties: false,
      properties: {
        file: { type: 'string', minLength: 1 },
        sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        page_count: { type: 'integer', minimum: 1 },
        extraction: {
          type: 'object',
          required: ['method', 'extracted_at'],
          additionalProperties: false,
          properties: {
            method: { enum: ['ocr', 'pdf-text', 'vision', 'hybrid'] },
            tool: { type: 'string' },
            extracted_at: { type: 'string' },
            render_dpi: { type: 'integer', minimum: 72 },
          },
        },
      },
    },
    retailer: {
      type: 'object',
      required: ['name', 'country', 'currency', 'language'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1 },
        // A hint the upload screen shows beside the chain picker, and never a
        // lookup key: a slug in a file is not an identity (section 4).
        chain_id: { type: 'string' },
        country: { type: 'string', pattern: '^[A-Z]{2}$' },
        currency: { type: 'string', pattern: '^[A-Z]{3}$' },
        language: { type: 'string', pattern: '^[a-z]{2}$' },
        campaign: { type: 'string' },
      },
    },
    validity: {
      type: 'object',
      required: ['starts_on', 'ends_on'],
      additionalProperties: false,
      properties: {
        starts_on: { type: ['string', 'null'], format: 'date' },
        ends_on: { type: ['string', 'null'], format: 'date' },
        raw_text: { type: 'string' },
      },
    },
    pages: {
      type: 'array',
      items: {
        type: 'object',
        required: ['number', 'has_text_layer'],
        additionalProperties: false,
        properties: {
          number: { type: 'integer', minimum: 1 },
          section: { type: ['string', 'null'] },
          section_raw: { type: ['string', 'null'] },
          has_text_layer: { type: 'boolean' },
          offer_count: { type: 'integer', minimum: 0 },
          notes: { type: 'string' },
        },
      },
    },
    offers: { type: 'array', items: offer },
    warnings: {
      type: 'array',
      description:
        "The extractor's own dropped tiles, carried into the run's warnings so the admin sees what the extractor lost beside what the import skipped.",
      items: {
        type: 'object',
        required: ['page', 'message'],
        additionalProperties: false,
        properties: {
          page: { type: 'integer' },
          message: { type: 'string' },
          raw_text: { type: 'string' },
        },
      },
    },
  },
};
