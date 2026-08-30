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
 * live on {@link SupermarketItem} rows. The name is localized (EN + ES minimum).
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

  @Column({ type: 'enum', enum: ItemCategory, default: ItemCategory.OTHER })
  category!: ItemCategory;

  @Column({ type: 'enum', enum: UnitOfMeasure, default: UnitOfMeasure.UNIT })
  defaultUnit!: UnitOfMeasure;
}
