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
 * One product from a till receipt, normalized (plan 0067, section 4).
 *
 * `name` is the whole point of the exercise: the receipt says `GARBANZA FRASC`
 * and this says "Chickpeas in a Jar". `receipt` keeps what the till printed, as
 * the evidence a human can check the normalized name against.
 */
export interface AuthoredItem {
  /** Stable within its store; the seed derives the row's uuid from it. */
  slug: string;
  name: LocalizedText;
  group: string;
  category: ItemCategory;
  defaultUnit: UnitOfMeasure;
  /**
   * How much of `defaultUnit` one of these is: 1.5 for a 1.5 L bottle, 0.25 for
   * a 250 g jar, 3 for a pack of three.
   *
   * It is where a size goes, because a name does not carry one. `Still Water
   * 1.5 L` states the same fact twice, in the one field search reads, and it
   * makes the bottle look like a different product from the same water in a
   * different bottle. So the name says what the thing is and this says how much
   * of it there is, which is the split `splitCardName` already makes for a
   * harvested Carrefour card.
   *
   * Left unset when the receipt does not state a size, rather than guessed. The
   * `receipt` field below keeps whatever was printed either way, so stripping a
   * size from the name discards no evidence.
   */
  unitSize?: number;
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
  /**
   * The barcode, where the product is one a Mercadona harvest also carries.
   *
   * This is the join, and it is the reason the Mercadona half works in both a
   * database that has run a discovery and one that never will. On the way in the
   * seed looks the EAN up: if a harvested row has it, that row is the product
   * and only its group is set; if nothing has it, this entry becomes the product
   * itself, priced from the receipt.
   *
   * It is never the item's uuid, because uuids belong to whichever database ran
   * the discovery. The barcode is what the entity calls "the only identifier
   * that joins a product across chains", and it survives a re-harvest.
   *
   * `uq_items_ean` is UNIQUE where not null, which is what makes the lookup
   * safe and also what decides the ordering: a catalog dump has to be restored
   * BEFORE this seed runs, never after.
   */
  ean?: string;
  /**
   * Other till names that resolved to this same product. Only the fish counter
   * needs it: it sells `BOQUERÓN PEQ 81/120` and `BOQUERÓN MED 51/80` at
   * different prices per kilo and there is one product behind both.
   */
  alsoReceipt?: string[];
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
