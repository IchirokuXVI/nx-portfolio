import {
  PriceScopeKind,
  type LocalizedText,
} from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Supermarket } from './supermarket.entity';

/**
 * The set of stores a chain charges the same in (plan 0038, section 5.1).
 *
 * This is what stops Mercadona writing twelve identical rows for Córdoba: it
 * publishes one price per warehouse, so the price belongs to the warehouse and
 * gets one `WAREHOUSE` scope with `externalKey = '4661'`. A chain with no
 * obtainable data gets one `STORE` scope per location and hand entered prices,
 * and needs no special case anywhere.
 */
@Entity({ name: 'price_scopes' })
@Index('uq_price_scope', ['supermarketId', 'kind', 'externalKey'], {
  unique: true,
})
export class PriceScope extends BaseEntity {
  @Index('ix_price_scopes_supermarket')
  @Column({ type: 'uuid' })
  supermarketId!: string;

  @ManyToOne(() => Supermarket, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'supermarketId' })
  supermarket!: Supermarket;

  @Column({ type: 'enum', enum: PriceScopeKind })
  kind!: PriceScopeKind;

  /**
   * The source's own key for the scope. **varchar and never an integer**: the
   * warehouse key comes back in two shapes, a numeric code (`4661`) and a city
   * slug (`mad3`), and both are real answers from the same endpoint.
   */
  @Column({ type: 'varchar', nullable: true })
  externalKey!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  label!: LocalizedText | null;
}
