import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Zone } from './zone.entity';

/** A shopping list inside a zone (plan 0007, section 1). */
@Entity({ name: 'shopping_lists' })
export class ShoppingList extends BaseEntity {
  @Index('ix_lists_zone')
  @Column({ type: 'uuid' })
  zoneId!: string;

  @ManyToOne(() => Zone, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'zoneId' })
  zone!: Zone;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'uuid' })
  createdByUserId!: string;
}
