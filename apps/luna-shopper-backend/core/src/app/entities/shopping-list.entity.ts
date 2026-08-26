import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Zone } from './zone.entity';

/** A shopping list inside a zone (plan 0007, section 1). */
@Entity({ name: 'shopping_lists' })
// Serves the zone lists preview, newest activity first (plan 0017, 4.3). The
// migration declares the `updatedAt` leg DESC, which this decorator cannot
// express; the migration is the schema of record.
@Index('ix_lists_zone_updated', ['zoneId', 'updatedAt', 'id'])
export class ShoppingList extends BaseEntity {
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
