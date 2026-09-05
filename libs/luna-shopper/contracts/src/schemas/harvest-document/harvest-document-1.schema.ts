import type { JsonSchema } from '../builders';

/**
 * The file import contract, version 1 (plan 0086, section 6.1).
 *
 * This is the schema the gateway validates an upload against before it crosses
 * the broker, and the schema the harvester validates against again at the spawn.
 * Two callers, one object, so the two cannot disagree about what a file is.
 *
 * **A new version is a new file and a new const.** The `$id` carries the version
 * and `schema_version` is a `const`, so a document names the schema it was
 * written for and the harvester accepts every version it can read
 * ({@link HARVEST_DOCUMENT_SCHEMA_IDS}).
 *
 * Three shape decisions worth reading before adding a field:
 *
 * - **`schema_version` is an integer.** The leaflet document it replaces used a
 *   string `"1.0"`, which invited a `1.1` that meant something between a version
 *   and a revision. A schema either reads a document or it does not.
 * - **`additionalProperties: false` everywhere except `extra`.** A typo'd field
 *   in a hand written file is refused by name rather than silently ignored;
 *   everything a producer knows and the import does not read has one place to go.
 * - **`hints.chain_id` and `hints.price_scope_id` are plain strings, not uuids.**
 *   A producer somewhere else spells a chain however it likes, and the upload
 *   screen looks the hint up and says so when this deployment does not have it
 *   (admin plan 0014, section 2). Refusing the whole document over a hint the
 *   screen already knows how to fail on would be worse.
 */
export const HARVEST_DOCUMENT_1_SCHEMA_ID =
  'https://ichirokuxvi.com/schemas/harvest-document-1.json';

/** The value `schema_version` must hold for this schema to accept a document. */
export const HARVEST_DOCUMENT_1_VERSION = 1;

/** A price as the source stated it. `currency` is required beside an amount. */
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

/**
 * A window of local days in Spain. **Both bounds are required inside it.** A
 * producer that read only an end date carries no `validity` and says so in
 * `warnings`, and the spawn's own override supplies the window, which is what
 * the admin form is for.
 */
const validity = (description: string): JsonSchema => ({
  type: ['object', 'null'],
  description,
  required: ['from', 'until'],
  additionalProperties: false,
  properties: {
    from: { type: 'string', format: 'date' },
    until: { type: 'string', format: 'date' },
  },
});

const product: JsonSchema = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    id: {
      type: ['string', 'null'],
      description:
        'Stable within one document, so a failure names the product rather than an index. For example p-0001.',
    },
    external_id: {
      type: ['string', 'null'],
      description:
        "The chain's own id. Absent, the product is keyed on name and size.label (plan 0086, D2).",
    },
    name: { type: 'string', minLength: 1 },
    brand: { type: ['string', 'null'] },
    ean: {
      type: ['string', 'null'],
      description:
        'The one field that makes a row ACTIVE without a person (rung 2).',
    },
    size: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        label: {
          type: ['string', 'null'],
          description:
            "The source's own size text. The row's sizeFormat, and half of the key.",
        },
        quantity: { type: ['number', 'null'] },
        unit: { type: ['string', 'null'] },
      },
    },
    price: {
      ...money(
        'The till price for one unit. Absent means no price is written at all.'
      ),
      type: ['object', 'null'],
    },
    unit_price: {
      type: ['object', 'null'],
      description:
        'The comparison figure, verbatim and never converted. A product with this and no price writes the unit price alone.',
      required: ['amount', 'label'],
      additionalProperties: false,
      properties: {
        amount: { type: 'number' },
        label: {
          type: 'string',
          minLength: 1,
          description: 'Text, never a unit: EUR/L, el kilo, por lavado.',
        },
        currency: { type: ['string', 'null'], pattern: '^[A-Z]{3}$' },
      },
    },
    validity: validity("This product's own window, over the document's."),
    observed_at: {
      type: ['string', 'null'],
      description:
        "ISO 8601. Defaults to producer.produced_at, then to the import's start.",
    },
    category_path: {
      type: ['array', 'null'],
      items: { type: 'string' },
    },
    url: { type: ['string', 'null'] },
    extra: {
      type: ['object', 'null'],
      additionalProperties: true,
      description:
        'Anything the producer knows and the import does not read. Stored, shown in the queue, interpreted by nothing.',
    },
  },
};

export const harvestDocument1Schema: JsonSchema = {
  $id: HARVEST_DOCUMENT_1_SCHEMA_ID,
  title: 'HarvestDocument',
  description:
    'A list of products as a source described them, whoever produced it (plan 0086, section 6.1).',
  type: 'object',
  required: ['schema_version', 'sha256', 'products'],
  additionalProperties: false,
  properties: {
    schema_version: { const: HARVEST_DOCUMENT_1_VERSION },
    sha256: {
      type: 'string',
      pattern: '^[0-9a-f]{64}$',
      description:
        'The digest of the file the products were read out of. The run level dedupe keys on it.',
    },
    producer: {
      type: ['object', 'null'],
      description:
        'Where the file came from. Shown on the run page, read by no rule.',
      required: ['name'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1 },
        version: { type: ['string', 'null'] },
        produced_at: { type: ['string', 'null'] },
      },
    },
    hints: {
      type: ['object', 'null'],
      description:
        'What the upload screen preloads, and only the upload screen. Never read by the harvester.',
      additionalProperties: false,
      properties: {
        chain_id: { type: ['string', 'null'] },
        price_scope_id: { type: ['string', 'null'] },
        source_kind: {
          enum: ['OFFICIAL_API', 'OFFICIAL_WEB', 'OFFICIAL_LEAFLET', null],
          description:
            'One of the three official PriceSourceKind values. No upload may write a user kind.',
        },
      },
    },
    validity: validity(
      'The window for every product that states none of its own.'
    ),
    products: {
      type: 'array',
      minItems: 1,
      description: 'At least one, or there is nothing to run.',
      items: product,
    },
    warnings: {
      type: ['array', 'null'],
      description:
        "The producer's own unresolved tiles, carried onto the run's warnings as text.",
      items: {
        type: 'object',
        required: ['message'],
        additionalProperties: false,
        properties: {
          message: { type: 'string', minLength: 1 },
          product_id: { type: ['string', 'null'] },
          extra: { type: ['object', 'null'], additionalProperties: true },
        },
      },
    },
  },
};
