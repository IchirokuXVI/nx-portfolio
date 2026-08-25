import type { LocalizedText } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Supermarket } from './supermarket.entity';

/**
 * A physical location of a chain (plan 0012, section 2): many per
 * {@link Supermarket}. Mercadona's 50 stores are 50 rows. The optional label is
 * localized; address/geo are per location.
 */
@Entity({ name: 'supermarket_locations' })
export class SupermarketLocation extends BaseEntity {
  @Index('ix_locations_supermarket')
  @Column({ type: 'uuid' })
  supermarketId!: string;

  @ManyToOne(() => Supermarket, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'supermarketId' })
  supermarket!: Supermarket;

  @Column({ type: 'jsonb', nullable: true })
  label!: LocalizedText | null;

  @Column({ type: 'varchar', nullable: true })
  address!: string | null;

  @Column({ type: 'varchar', nullable: true })
  city!: string | null;

  @Column({ type: 'varchar', nullable: true })
  country!: string | null;

  @Column({ type: 'double precision', nullable: true })
  latitude!: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude!: number | null;
}
