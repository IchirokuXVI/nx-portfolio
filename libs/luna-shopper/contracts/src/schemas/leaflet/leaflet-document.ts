/**
 * The shape of an uploaded supermarket leaflet (plan 0081, section 4).
 *
 * `tmp/leaflet` produces these documents and stays their producer; this is the
 * **import contract**, a narrowed and versioned copy of that extractor's schema.
 * A schema that lives only in `tmp/` drifts: the extractor changes a field,
 * nothing in the build notices, and the first document that reaches the gateway
 * fails on a shape nobody reviewed.
 *
 * Every type here mirrors the JSON Schema beside it, and the schema is what
 * actually validates. These interfaces exist so the gateway and the harvester
 * can read a validated document without casting through `unknown` at every step.
 */

/** A price as printed, with its currency. */
export interface LeafletMoney {
  amount: number;
  currency: string;
}

/** How a document was produced. Recorded, and read by nothing in the import. */
export interface LeafletExtraction {
  method: 'ocr' | 'pdf-text' | 'vision' | 'hybrid';
  tool?: string;
  extracted_at: string;
  render_dpi?: number;
}

export interface LeafletSource {
  file: string;
  /**
   * Required here and optional in the extractor's own schema (section 4). The
   * run level dedupe of section 7 keys on it, and the extractor already
   * computes it: the `tmp` schema marks it optional only because it was written
   * before anything read it.
   */
  sha256: string;
  page_count: number;
  extraction?: LeafletExtraction;
}

/**
 * Who printed the leaflet. **`chain_id` is a hint, never a lookup key**
 * (section 4): the admin picks the `supermarketId`, and two extractors spell one
 * chain two ways.
 */
export interface LeafletRetailer {
  name: string;
  chain_id?: string;
  country: string;
  currency: string;
  language: string;
  campaign?: string;
}

/** Local days in Spain, and nullable. Section 5 turns them into instants. */
export interface LeafletValidity {
  starts_on: string | null;
  ends_on: string | null;
  raw_text?: string;
}

export interface LeafletPage {
  number: number;
  section?: string | null;
  section_raw?: string | null;
  has_text_layer: boolean;
  offer_count?: number;
  notes?: string;
}

export interface LeafletFormat {
  raw?: string | null;
  container?: string | null;
  quantity?: number | null;
  unit?: string | null;
  pack_count?: number | null;
  bonus_units?: number | null;
}

export interface LeafletProduct {
  name: string;
  brand?: string | null;
  variants?: string[];
  format?: LeafletFormat;
}

/** The small comparison line. Written verbatim and never converted. */
export interface LeafletUnitPrice {
  amount?: number;
  currency?: string;
  per?: 'l' | 'kg' | 'unit' | 'wash' | 'm' | '100ml' | '100g';
  raw?: string;
}

/** What the advertised price buys (section 6.1). */
export type LeafletBasis = 'unit' | 'pack' | 'kg' | 'l' | 'piece';

export interface LeafletPricing {
  price: LeafletMoney;
  basis: LeafletBasis;
  was_price?: LeafletMoney;
  discount_pct?: number | null;
  unit_price?: LeafletUnitPrice;
}

/** The mechanic printed on the tile (section 6.2). */
export type LeafletPromotionType =
  | 'price_drop'
  | 'second_unit_discount'
  | 'multibuy_unit_price'
  | 'multibuy_total'
  | 'n_for_m'
  | 'buy_n_get_free'
  | 'pack_bonus'
  | 'loyalty_discount';

export interface LeafletPromotion {
  type: LeafletPromotionType;
  raw_text: string;
  required_quantity?: number | null;
  paid_quantity?: number | null;
  free_quantity?: number | null;
  discount_pct?: number | null;
  /** What one unit costs without taking the deal. Section 6.2 writes this. */
  single_unit_price?: LeafletMoney;
  effective_unit_price?: LeafletMoney;
  total_price?: LeafletMoney;
  effective_unit_price_note?: string;
}

/** Section 6.3: a loyalty gated offer is skipped entirely. */
export interface LeafletLoyalty {
  required?: boolean;
  program?: string | null;
}

export interface LeafletOffer {
  id: string;
  page: number;
  bbox?: number[];
  section?: string | null;
  product: LeafletProduct;
  pricing: LeafletPricing;
  promotion?: LeafletPromotion | null;
  loyalty?: LeafletLoyalty;
  legal_note?: string | null;
  source: 'ocr' | 'pdf-text' | 'vision';
  /** Optional here (section 4): the queue shows it when the extractor gave one. */
  confidence?: number;
  raw_text?: string[];
}

/** Anything the extractor could not resolve, carried into the run's warnings. */
export interface LeafletExtractorWarning {
  page: number;
  message: string;
  raw_text?: string;
}

/** One leaflet and every offer printed in it. */
export interface LeafletDocument {
  schema_version: string;
  source: LeafletSource;
  retailer: LeafletRetailer;
  validity: LeafletValidity;
  pages?: LeafletPage[];
  offers: LeafletOffer[];
  warnings?: LeafletExtractorWarning[];
}
