import { PriceSourceKind } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Item } from './item.entity';
import { SupermarketLocation } from './supermarket-location.entity';

/**
 * The genuinely per store half of a product's presence in a chain (plan 0038,
 * section 5.2). It split out from `SupermarketItem` when the price moved to the
 * scope, because a warehouse can answer what a product costs and cannot answer
 * which aisle it is in.
 */
@Entity({ name: 'supermarket_location_items' })
@Index('uq_supermarket_location_item', ['itemId', 'supermarketLocationId'], {
  unique: true,
})
export class SupermarketLocationItem extends BaseEntity {
  @Column({ type: 'uuid' })
  itemId!: string;

  @ManyToOne(() => Item, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'itemId' })
  item!: Item;

  @Index('ix_location_items_location')
  @Column({ type: 'uuid' })
  supermarketLocationId!: string;

  @ManyToOne(() => SupermarketLocation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'supermarketLocationId' })
  supermarketLocation!: SupermarketLocation;

  @Column({ type: 'varchar', nullable: true })
  positionInStore!: string | null;

  /**
   * A **nullable override** meaning "somebody checked this specific shop". Null
   * is still "no store specific information, use the scope's", and a crawl that
   * has never seen a shop leaves it null rather than writing false, because
   * absence of a crawl is not absence of a product.
   *
   * **Since plan 0084 an automated source may write it too.** The old comment
   * here reserved the column for a person, and that was a finding about one
   * source rather than about sources: DEZA's only availability claim is per
   * shop. So the column stays where it is and gains the three provenance
   * columns below, and the row records which of the two wrote it.
   */
  @Column({ type: 'boolean', nullable: true })
  available!: boolean | null;

  /**
   * Who last wrote {@link available} (plan 0084, section 2).
   *
   * Nullable with no default, and the migration deliberately backfills nothing:
   * a row written before that plan came from a person or from nothing and the
   * database cannot tell which. `ADMIN` protects rows nobody typed;
   * `OFFICIAL_WEB` lets a crawl overwrite a person. Null is read as "no
   * provenance recorded", which the write path treats as `ADMIN` whenever
   * `available` is not null.
   */
  @Column({
    type: 'enum',
    enum: PriceSourceKind,
    enumName: 'price_source_kind',
    nullable: true,
  })
  availabilitySourceKind!: PriceSourceKind | null;

  /** When that writer stated it. */
  @Column({ type: 'timestamptz', nullable: true })
  availabilityObservedAt!: Date | null;

  /** The harvest run that wrote it. Opaque, never joined (plan 0082 reads it). */
  @Column({ type: 'uuid', nullable: true })
  availabilitySourceRunId!: string | null;
}
