import type { JsonSchema } from '../builders';

/**
 * The file import contract, version 2 (plan 0103, section 5).
 *
 * **Version 1 could carry one price per product and no scope at all**, so a run
 * of the one source that publishes a price per region exported a file with no
 * price in it: the export could ask for a single scope, the run had none, and
 * every product lost its price, its unit price and its validity. The rows were
 * correct in the database the whole time.
 *
 * Two things change, and nothing else:
 *
 * - **`scopes` at the top.** The groups of shops this file prices for, by the
 *   source's own key. Optional: a document with none writes every price to the
 *   scope the operator chose, which is every leaflet ever uploaded.
 * - **`prices` per product**, replacing the `price` and `unit_price` pair. Each
 *   entry may name one of those scopes, and carries its own validity and
 *   `observed_at`, so a region can price and date a product differently from its
 *   neighbour.
 *
 * `hints.adapter_key` is the third addition and the smallest: the upload screen
 * reads it to preselect, and **it decides nothing**. Whether a default scope is
 * needed is read from the products, because the hint is what a producer claims
 * and the products are what the file holds. A file labelled `lidl-api` that
 * carries an unscoped price is asked for a default rather than refused for
 * lying.
 *
 * **Version 1 is read for good** ({@link HARVEST_DOCUMENT_SCHEMA_IDS}). A
 * leaflet extractor writes it, the fixtures are written in it, and a format that
 * stops reading its own past is a format nobody trusts to export to. The reader
 * normalizes a version 1 document into this shape on the way in, so nothing
 * downstream of it knows there are two versions.
 */
export const HARVEST_DOCUMENT_2_SCHEMA_ID =
  'https://ichirokuxvi.com/schemas/harvest-document-2.json';

/** The value `schema_version` must hold for this schema to accept a document. */
export const HARVEST_DOCUMENT_2_VERSION = 2;

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

/**
 * One price, for one group of shops.
 *
 * `scope` refers to a `scopes[].key` and is optional: a price naming none is
 * written to the scope the operator chose at the spawn. A price naming a key
 * nothing declared is a validation failure at its own path, because a price
 * pointing at nothing is a number with no meaning.
 */
const price: JsonSchema = {
  type: 'object',
  required: ['amount', 'currency'],
  additionalProperties: false,
  properties: {
    scope: {
      type: ['string', 'null'],
      description:
        "One of scopes[].key. Absent, the price belongs to the run's default scope.",
    },
    amount: {
      type: ['number', 'null'],
      minimum: 0,
      description:
        'The till price for one unit, in `currency`. Null when the source stated only a comparison figure, a per kilogram price with no pack price: the import then writes the unit price and no till price.',
    },
    currency: { type: 'string', pattern: '^[A-Z]{3}$' },
    unit_price: {
      type: ['object', 'null'],
      description:
        'The comparison figure, verbatim and never converted. A product with this and no amount writes the unit price alone.',
      required: ['amount', 'label'],
      additionalProperties: false,
      properties: {
        amount: { type: 'number' },
        label: {
          type: 'string',
          minLength: 1,
          description: 'Text, never a unit: EUR/L, el kilo, por lavado.',
        },
      },
    },
    validity: validity(
      "This price's own window, over the product's and the document's."
    ),
    observed_at: {
      type: ['string', 'null'],
      description: "ISO 8601. Defaults to the product's, then the producer's.",
    },
  },
};

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
    prices: {
      type: ['array', 'null'],
      description:
        'Every price the source stated for this product, one per group of shops it named. An empty array is a product the source named and priced nowhere, which is every DEZA product and 21 of a LIDL week.',
      items: price,
    },
    validity: validity(
      "This product's own window, over the document's. A price may override it."
    ),
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

/**
 * One group of shops that pays one price.
 *
 * **The key is document local and never a uuid**, the same rule `hints` already
 * carries: an id does not survive a move to another cluster, and the key is
 * matched against `PriceScope.externalKey` on the importing side, which is the
 * source's own key and does survive (plan 0103, D3).
 */
const scope: JsonSchema = {
  type: 'object',
  required: ['key', 'kind'],
  additionalProperties: false,
  properties: {
    key: {
      type: 'string',
      minLength: 1,
      description:
        "The source's own key for this group. Matched against PriceScope.externalKey.",
    },
    kind: {
      enum: ['NATIONAL', 'REGION', 'POSTAL_CODE', 'STORE'],
      description:
        'What sort of group this is, for a scope that has to be created.',
    },
    name: {
      type: ['string', 'null'],
      description:
        'What the source calls it, so an operator can read the list.',
    },
  },
};

export const harvestDocument2Schema: JsonSchema = {
  $id: HARVEST_DOCUMENT_2_SCHEMA_ID,
  title: 'HarvestDocument2',
  description:
    'A list of products as a source described them, with a price per group of shops it named (plan 0103, section 5).',
  type: 'object',
  required: ['schema_version', 'sha256', 'products'],
  additionalProperties: false,
  properties: {
    schema_version: { const: HARVEST_DOCUMENT_2_VERSION },
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
        adapter_key: {
          type: ['string', 'null'],
          description:
            'What produced this file, so the upload screen can preselect. It decides nothing: whether a default scope is needed is read from the products.',
        },
        source_kind: {
          enum: ['OFFICIAL_API', 'OFFICIAL_WEB', 'OFFICIAL_LEAFLET', null],
          description:
            'One of the three official PriceSourceKind values. No upload may write a user kind.',
        },
      },
    },
    scopes: {
      type: ['array', 'null'],
      description:
        'The groups of shops this file prices for. Absent, every price belongs to the scope the operator chose at the spawn, which is every leaflet.',
      items: scope,
    },
    validity: validity(
      'The window for every product and price that states none of its own.'
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
