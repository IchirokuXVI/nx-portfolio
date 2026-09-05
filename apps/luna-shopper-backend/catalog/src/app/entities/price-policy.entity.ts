import { PriceSourceKind } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * How one source kind competes for the price a shopper sees (plan 0080, section
 * 3). One row per kind, seeded by the migration, owner editable.
 *
 * Lower `priority` wins. A leaflet outranks a crawl, which reverses backlog
 * 0001 section 2.4 by the owner's decision; the model's part is that a leaflet
 * row is eligible only inside its window, so an expired one fails on its own.
 *
 * `ADMIN` has no `maxAgeDays`. Most supermarkets will never have an automated
 * source, so for them the owner's price is the only truth and a max age would
 * make it stale a week after it was typed. Seven days is the length of a
 * **protection window** against a repeated automated value, and it lives on
 * the row that is protected (`ItemPrice.protectedUntil`), not here.
 */
@Entity({ name: 'price_policies' })
export class PricePolicy extends BaseEntity {
  @Index('uq_price_policy_kind', { unique: true })
  @Column({
    type: 'enum',
    enum: PriceSourceKind,
    enumName: 'price_source_kind',
  })
  sourceKind!: PriceSourceKind;

  @Column({ type: 'integer' })
  priority!: number;

  /** Null means a row of this kind never ages out. */
  @Column({ type: 'integer', nullable: true })
  maxAgeDays!: number | null;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;
}
