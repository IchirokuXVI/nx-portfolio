import {
  ItemCategory,
  UnitOfMeasure,
  type LocalizedText,
} from '@portfolio/luna-shopper/contracts';
import { Column, Entity } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * The actual product (plan 0012, section 2): one global row per product, owner
 * managed and never created by users. Its per store price and in store position
 * live on {@link SupermarketItem} rows. The name is localized, in at least one of EN and ES (plan 0079).
 */
@Entity({ name: 'items' })
export class Item extends BaseEntity {
  @Column({ type: 'jsonb' })
  name!: LocalizedText;

  @Column({ type: 'varchar', nullable: true })
  brand!: string | null;

  @Column({ type: 'varchar', nullable: true })
  imageUrl!: string | null;

  @Column({ type: 'varchar', nullable: true })
  sku!: string | null;

  /**
   * The only identifier that joins a product across chains (plan 0038, section
   * 2.5), and the reason catalog discovery pays one detail request per product
   * instead of walking the tree and stopping. Unique when present, null when the
   * source has none: coverage was 40 of 40 on a random sample, but a novelty
   * product genuinely has no barcode.
   */
  @Column({ type: 'varchar', nullable: true })
  ean!: string | null;

  /** Without it `defaultUnit` says nothing: "LITER" is not a size. */
  @Column({ type: 'numeric', precision: 12, scale: 4, nullable: true })
  unitSize!: number | null;

  /**
   * How many units the pack holds, 2 to 1000, or null (plan 0162).
   *
   * Written in three ways only: on creation from a source entry, by a run's
   * fill where it is null, and by an update a person sends. The last is the
   * only one that changes a count that is set.
   */
  @Column({ type: 'smallint', nullable: true })
  packCount!: number | null;

  @Column({ type: 'enum', enum: ItemCategory, default: ItemCategory.OTHER })
  category!: ItemCategory;

  @Column({ type: 'enum', enum: UnitOfMeasure, default: UnitOfMeasure.UNIT })
  defaultUnit!: UnitOfMeasure;

  /**
   * The {@link ProductGroup} this product belongs to, or null (plan 0048).
   *
   * Nullable and owner curated: nothing assigns it, and an unassigned product is
   * the ordinary state of a freshly harvested one. Assigning it is what declares
   * that this milk is comparable with that milk.
   *
   * A real foreign key, unlike core's `itemId`, because both tables live in the
   * catalog database. Writing it (or writing the group) re-runs the trigger that
   * refreshes this row's search vectors.
   */
  @Column({ type: 'uuid', nullable: true })
  productGroupId!: string | null;

  /**
   * `brandKey(brand)`, kept beside the text so every spelling of one brand can
   * be found at once (plan 0115, section 3.2).
   *
   * Derived and never sent: `ItemService` computes it inside the one write step
   * `create`, `createMany` and `update` share. Null exactly when `brand` is
   * null, or when the text has no letters or digits at all.
   */
  @Column({ type: 'varchar', length: 120, nullable: true })
  brandKey!: string | null;

  /**
   * The registered {@link Brand} this product carries, or null (plan 0115).
   *
   * When it is set, `brand` holds that brand's label **byte for byte**. That
   * copy is deliberate: the search trigger, the trigram index and the ranking
   * all read `items.brand`, so keeping the label there means none of them
   * changes and a rename rewrites one column rather than a query plan.
   *
   * Null is ordinary. A brand nobody has registered is still accepted, and its
   * key sits in `brandKey` waiting for somebody to register it.
   */
  @Column({ type: 'uuid', nullable: true })
  brandId!: string | null;
}
