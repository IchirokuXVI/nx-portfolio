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
  /**
   * What produced this file, so the upload screen can preselect (plan 0103,
   * section 4.3).
   *
   * **The hint is the claim and the document is the proof.** It decides
   * nothing: whether a default price scope is needed is read from the products,
   * because a mislabelled file must still import correctly. One of
   * `ADAPTER_KEYS`, and omitted by a producer that does not know the enum.
   */
  adapter_key?: string | null;
  /** One of the three official `PriceSourceKind` values. */
  source_kind?: 'OFFICIAL_API' | 'OFFICIAL_WEB' | 'OFFICIAL_LEAFLET' | null;
}

/**
 * One group of shops that pays one price (plan 0103, section 5.1).
 *
 * **`key` is document local and never a uuid.** It is matched against
 * `PriceScope.externalKey` on the importing side, which is the source's own key
 * and survives a move to another cluster, where an id does not.
 */
export interface HarvestDocumentScope {
  key: string;
  kind: 'NATIONAL' | 'REGION' | 'POSTAL_CODE' | 'STORE';
  name?: string | null;
}

/**
 * One price of one product, for the group of shops that pays it.
 *
 * `scope` refers to a {@link HarvestDocumentScope.key} and is optional: a price
 * naming none belongs to the scope the operator chose at the spawn, which is
 * every leaflet. A `scope` naming no declared key is a validation failure,
 * because a price pointing at nothing is a number with no meaning.
 */
export interface HarvestDocumentPrice {
  scope?: string | null;
  /**
   * The till price for **one unit**, in `currency`.
   *
   * Null when the source stated only a comparison figure, a per kilogram price
   * with no pack price. The import then writes the unit price and no till
   * price, which is plan 0081 section 6.1's one surviving decision.
   */
  amount: number | null;
  currency: string;
  unit_price?: Omit<HarvestDocumentUnitPrice, 'currency'> | null;
  /** This price's own window, over the product's and the document's. */
  validity?: HarvestDocumentValidity | null;
  /** ISO 8601. Defaults to the product's, then to the producer's. */
  observed_at?: string | null;
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
   * The till price for **one unit**, version 1 only.
   *
   * Version 2 states {@link HarvestDocumentProduct.prices} instead, and the
   * reader normalizes this pair into one entry of it, so nothing past the
   * reader sees either field (plan 0103, D7).
   */
  price?: HarvestDocumentMoney | null;
  unit_price?: HarvestDocumentUnitPrice | null;
  /**
   * Every price the source stated for this product, one per group of shops it
   * named. Version 2, and what the reader normalizes version 1 into.
   *
   * An empty array is a product the source named and priced nowhere, which is
   * every DEZA product and 21 of a LIDL week. It is not a price of zero.
   */
  prices?: HarvestDocumentPrice[] | null;
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
  /**
   * The version this document was written for. An unknown one is refused by
   * name rather than checked against a shape it was not written for.
   */
  schema_version: number;
  /**
   * The digest of the file the products were read out of (plan 0081, section 7):
   * one import of one file per chain until a revert.
   */
  sha256: string;
  producer?: HarvestDocumentProducer | null;
  hints?: HarvestDocumentHints | null;
  /**
   * The groups of shops this file prices for, version 2 (plan 0103, section
   * 5.1).
   *
   * Absent, every price belongs to the scope the operator chose at the spawn,
   * which is every leaflet ever uploaded and every version 1 document.
   */
  scopes?: HarvestDocumentScope[] | null;
  /** The window for every product that states none of its own. */
  validity?: HarvestDocumentValidity | null;
  /** At least one, or there is nothing to run. */
  products: HarvestDocumentProduct[];
  warnings?: HarvestDocumentWarning[] | null;
}
