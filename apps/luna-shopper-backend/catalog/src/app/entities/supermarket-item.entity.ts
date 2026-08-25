import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Item } from './item.entity';
import { SupermarketLocation } from './supermarket-location.entity';

/**
 * The segregated, per location product (plan 0012, section 2): the "slave" that
 * carries the price and in store position for one {@link Item} at one
 * {@link SupermarketLocation}. One item can have up to one row per store (e.g. 50
 * Mercadona locations => up to 50 rows). Unique on (itemId, supermarketLocationId).
 */
@Entity({ name: 'supermarket_items' })
@Index('uq_supermarket_item', ['itemId', 'supermarketLocationId'], {
  unique: true,
})
export class SupermarketItem extends BaseEntity {
  @Column({ type: 'uuid' })
  itemId!: string;

  @ManyToOne(() => Item, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'itemId' })
  item!: Item;

  @Column({ type: 'uuid' })
  supermarketLocationId!: string;

  @ManyToOne(() => SupermarketLocation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'supermarketLocationId' })
  supermarketLocation!: SupermarketLocation;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  price!: number | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  currency!: string | null;

  @Column({ type: 'varchar', nullable: true })
  positionInStore!: string | null;

  @Column({ type: 'boolean', default: true })
  available!: boolean;
}
