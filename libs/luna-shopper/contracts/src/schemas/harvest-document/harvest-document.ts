/**
 * The shape of a file a harvester run reads (plan 0086, section 6.1).
 *
 * **This is not a leaflet.** It is a list of products as a source described
 * them, whoever produced it: the leaflet extractor in `tmp/leaflet`, the
 * harvester's own `harvest.export`, a person typing a chain's prices, or a walk
 * that ran on a machine allowed to crawl. The import does one thing with every
 * one of them, so the document has no `kind` field.
 *
 * **It is designed from what the import consumes and from nothing else**, which
 * is `SourceObservation` (plan 0086, section 5) plus what the digest index, the
 * upload screen and the run page need. It shares no shape with the leaflet
 * document of plan 0081, which it replaces, and none with the harvester's
 * tables.
 *
 * The rule for the shape, stated once so a later field can be argued against it:
 *
 * - **Required** when the import cannot do its job without it.
 * - **Optional** when a real producer does not always have it and the import has
 *   a sensible answer without it.
 * - **Absent** when the import never reads it. A producer puts that in
 *   {@link HarvestDocumentProduct.extra}, which is stored, shown in the queue and
 *   interpreted by nothing.
 *
 * Every type here mirrors the JSON Schema beside it, and the schema is what
 * actually validates. These interfaces exist so the gateway and the harvester can
 * read a validated document without casting through `unknown` at every step.
 */

/** A price as the source stated it, with its currency. */
export interface HarvestDocumentMoney {
  amount: number;
  currency: string;
}

/**
 * The comparison figure, verbatim and never converted (plan 0038, section 2.4).
 *
 * `label` is text, not a unit: `€/L`, `el kilo`, `por lavado`. The import writes
 * it to `unitPriceLabel` as it is, and nothing parses it. A product carrying this
 * and no {@link HarvestDocumentProduct.price} writes the unit price alone, which
 * is what a per kilogram offer with no pack price is.
 */
export interface HarvestDocumentUnitPrice {
  amount: number;
  label: string;
  currency?: string | null;
}

/**
 * What the source printed about the size of one unit.
 *
 * `label` is the row's `sizeFormat` and half of the key a product without an
 * `external_id` is resolved through (plan 0086, D2), so it is the source's own
 * text and never a normalization of it. `unit` stands in when `label` is absent.
 */
export interface HarvestDocumentSize {
  label?: string | null;
  quantity?: number | null;
  unit?: string | null;
}

/** A window of local days in Spain. Both bounds are stated or the block is absent. */
export interface HarvestDocumentValidity {
  /** `YYYY-MM-DD`, the first day the price is printed for. */
  from: string;
  /** `YYYY-MM-DD`, the last day, inclusive. */
  until: string;
}

/** Where the file came from, shown on the run page and read by no rule. */
export interface HarvestDocumentProducer {
  name: string;
  version?: string | null;
  /** ISO 8601. The default `observed_at` for a product that states none. */
  produced_at?: string | null;
}

/**
 * What the upload screen preloads, and **only** the upload screen (admin plan
 * 0014, section 2).
 *
 * Each hint fills its input only when that input is still empty, and a chain or
 * scope hint only when the id exists in this deployment's directory. The
 * harvester never reads them: the ids in a file come from wherever it was
 * produced, and an id does not survive an environment change.
 */
export interface HarvestDocumentHints {
  chain_id?: string | null;
  price_scope_id?: string | null;
  /** One of the three official `PriceSourceKind` values. */
  source_kind?: 'OFFICIAL_API' | 'OFFICIAL_WEB' | 'OFFICIAL_LEAFLET' | null;
}

/**
 * Something the producer could not resolve, carried onto the run's warnings as
 * it is.
 *
 * A producer's warning arrives as **text**. The codes the harvester's own
 * warnings carry say what the import decided; a producer decided something else,
 * somewhere else, and a code the harvester defines cannot name it.
 */
export interface HarvestDocumentWarning {
  message: string;
  /** The `id` of the product it is about, when it is about one. */
  product_id?: string | null;
  extra?: Record<string, unknown> | null;
}

/** One product as the source described it. */
export interface HarvestDocumentProduct {
  /**
   * Stable within one document, so validation feedback and warnings can name a
   * product rather than an index. The index names it when this is absent.
   */
  id?: string | null;
  /**
   * The chain's own id for this product, when it has one. Absent, the product is
   * keyed on `name` and `size.label` (plan 0086, D2).
   */
  external_id?: string | null;
  /** Verbatim, in the source's own language. Never rewritten (plan 0086, D8). */
  name: string;
  brand?: string | null;
  /** The one field that makes a row `ACTIVE` without a person (rung 2). */
  ean?: string | null;
  size?: HarvestDocumentSize | null;
  /**
   * The till price for **one unit**. Absent means no price is written, which is
   * the truth for a site that prints none and for a tile whose only number a
   * shopper cannot pay for one unit.
   */
  price?: HarvestDocumentMoney | null;
  unit_price?: HarvestDocumentUnitPrice | null;
  /** This product's own window, over the document's. */
  validity?: HarvestDocumentValidity | null;
  /** ISO 8601. Defaults to `producer.produced_at`, then to the import's start. */
  observed_at?: string | null;
  category_path?: string[] | null;
  url?: string | null;
  /**
   * Everything the producer knows and the import does not read: a leaflet's
   * page, raw text, promotion, loyalty block and confidence, a chain that sells
   * for points, a photo reference, whatever the next chain prints.
   *
   * Stored on the row and on the price row, shown in the queue, **never read by
   * any rule**. A rule that wants something out of here is a new field in a new
   * schema version, and not before.
   */
  extra?: Record<string, unknown> | null;
}

/** One file, and every product a source described in it. */
export interface HarvestDocument {
  /** The integer `1` for this version. An unknown version is refused by name. */
  schema_version: number;
  /**
   * The digest of the file the products were read out of (plan 0081, section 7):
   * one import of one file per chain until a revert.
   */
  sha256: string;
  producer?: HarvestDocumentProducer | null;
  hints?: HarvestDocumentHints | null;
  /** The window for every product that states none of its own. */
  validity?: HarvestDocumentValidity | null;
  /** At least one, or there is nothing to run. */
  products: HarvestDocumentProduct[];
  warnings?: HarvestDocumentWarning[] | null;
}
