import type {
  ItemCategory,
  LocalizedSynonyms,
  LocalizedText,
  PriceScopeKind,
  UnitOfMeasure,
} from '@portfolio/luna-shopper/contracts';

/** A normalized product group, before it becomes a `ProductGroup` row. */
export interface ReferenceGroup {
  slug: string;
  name: LocalizedText;
  referenceUnit: UnitOfMeasure;
  synonyms: LocalizedSynonyms;
}

/**
 * One product on a Mercadona receipt that the harvest already carries.
 *
 * Keyed on **EAN and never on the item's uuid**. The uuids belong to whichever
 * database ran the discovery, so a mapping written against one developer's
 * catalog would match nothing in another's and nothing at all in staging. The
 * barcode is the identity the entity itself calls "the only identifier that
 * joins a product across chains", every one of these 109 products has one, and
 * it survives a re-harvest.
 *
 * `receipt` is the till's own abbreviation. It is kept because it is the
 * evidence: it is what a human can check this row against, and the reason the
 * assignment can be reviewed at all.
 */
export interface HarvestedAssignment {
  ean: string;
  group: string;
  receipt: string;
  /**
   * Other till names that resolved to this same product. Only the fish counter
   * needs it: it sells `BOQUERÓN PEQ 81/120` and `BOQUERÓN MED 51/80` at
   * different prices per kilo, and the online catalog has one row for both, so
   * the second name has nowhere else to be recorded.
   */
  alsoReceipt?: string[];
}

/**
 * A product the reference catalog has to create, because no harvest carries it:
 * everything sold by El Jamón and SuperCash, plus the handful of Mercadona
 * products the snapshot happens not to hold.
 *
 * `name` is the normalized name, which is the entire point of the exercise: the
 * receipt says `GARBANZA FRASC` and this says "Chickpeas in a Jar".
 */
export interface AuthoredItem {
  /** Stable within its store; the seed derives the row's uuid from it. */
  slug: string;
  name: LocalizedText;
  group: string;
  category: ItemCategory;
  defaultUnit: UnitOfMeasure;
  brand?: string;
  /** What the till printed, kept as the evidence for the normalized name. */
  receipt: string;
  /** The most recent price this product was seen at, and when. */
  price: number;
  observedAt: string;
  /**
   * Set when the price above is per kilogram rather than per pack, which is
   * every counter product. It goes to `unitPrice` and this label, leaving
   * `price` null: a per kilo figure is not what one of them costs.
   */
  perKilo?: boolean;
}

/** A chain the reference catalog introduces, with its single priced store. */
export interface ReferenceStore {
  slug: string;
  name: LocalizedText;
  websiteUrl?: string;
  externalBrandKey?: string;
  scopeKind: PriceScopeKind;
  scopeLabel: LocalizedText;
  location: {
    label: LocalizedText;
    address: string;
    city: string;
    postalCode: string;
    country: string;
  };
}
