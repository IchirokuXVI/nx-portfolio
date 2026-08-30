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
   * A **nullable override** meaning "someone checked this specific shop". Null
   * means "no store specific information, use the scope's". Two columns, two
   * different claims, neither pretending to be the other: the scope's `available`
   * is what an automated source can populate, and this one is what a person can.
   */
  @Column({ type: 'boolean', nullable: true })
  available!: boolean | null;
}
