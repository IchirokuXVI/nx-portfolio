import type { LocalizedText } from '@portfolio/luna-shopper/contracts';
import { Column, Entity } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * A supermarket chain / brand (plan 0012, section 2): one row per brand, e.g.
 * "Mercadona". Its many physical stores are {@link SupermarketLocation} rows. The
 * localized name is stored as jsonb, in at least one of EN and ES (plan 0079).
 */
@Entity({ name: 'supermarkets' })
export class Supermarket extends BaseEntity {
  @Column({ type: 'jsonb' })
  name!: LocalizedText;

  @Column({ type: 'varchar', nullable: true })
  logoUrl!: string | null;

  @Column({ type: 'varchar', nullable: true })
  websiteUrl!: string | null;

  /**
   * The chain's stable identity across discovery runs and providers (plan 0038,
   * section 5.4), here the Wikidata QID (`Q377705`).
   *
   * Matching on the brand NAME splits one chain into several: `Dia` and `Maxi
   * Dia` are one chain sharing `Q925132`. It cuts the other way too, which is why
   * this is owner editable rather than authoritative: `Carrefour` and `Carrefour
   * Express` carry different QIDs, arguably correctly since their prices differ.
   * Nullable because an independent shop has none.
   */
  @Column({ type: 'varchar', nullable: true })
  externalBrandKey!: string | null;

  /**
   * The scope to quote this chain's prices from when nothing else says which
   * (plan 0049, section 3.1).
   *
   * The last rung of the ladder, and the reason it exists: "show me Mercadona"
   * with no location is ambiguous, because Mercadona prices per warehouse and
   * there is no single Mercadona price. First the chain's scopes serving the
   * caller's postal codes, then its NATIONAL scope if it has one, then this,
   * with the result **flagged as approximate** so a client can say "prices shown
   * for Madrid". Averaging across the chain's scopes is not an alternative: an
   * average price is a price that exists in no store.
   *
   * Owner set and nullable, and no foreign key: the column names a row of the
   * table two files over, but a constraint here would make deleting a scope
   * refuse rather than fall through to "this chain has no default", which is a
   * perfectly good answer.
   */
  @Column({ type: 'uuid', nullable: true })
  defaultPriceScopeId!: string | null;

  /**
   * Whether the photos this chain prints for its products may be shown (plan
   * 0198, section 4). The record that we may show them, held chain by chain,
   * and false until a person turns it on.
   *
   * It decides what a client is given and never what is kept: the links in
   * `item_linked_images` stay when it is false, so turning a chain on again
   * needs no harvest.
   *
   * Written only by `SupermarketService.setLinkedImagesEnabled` and by
   * `ItemLinkedImageService.disableAll`, each with an `UPDATE` of its own in
   * the transaction that also rewrites `items.linkedImages`. The ORM is told
   * never to write it, so an edit of the chain's name that loaded the row a
   * moment before a stop cannot turn the chain on again when it saves.
   *
   * It is here and not on the harvester's `supermarket_sources` because
   * catalog answers the read. A chain that asks us to stop showing its photos
   * is not the same event as one that asks us to stop reading its prices.
   */
  @Column({ type: 'boolean', default: false, update: false })
  linkedImagesEnabled!: boolean;
}
