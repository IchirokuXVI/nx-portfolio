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

  @Column({ type: 'enum', enum: ItemCategory, default: ItemCategory.OTHER })
  category!: ItemCategory;

  @Column({ type: 'enum', enum: UnitOfMeasure, default: UnitOfMeasure.UNIT })
  defaultUnit!: UnitOfMeasure;
}
