import {
  DEFAULT_SCOPE_PRIORITY,
  PriceScopeKind,
  type LocalizedText,
} from '@portfolio/luna-shopper/contracts';
import {
  BeforeInsert,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { Supermarket } from './supermarket.entity';

/**
 * The set of stores a chain charges the same in (plan 0038, section 5.1).
 *
 * This is what stops Mercadona writing twelve identical rows for Córdoba: it
 * publishes one price per warehouse, so the price belongs to the warehouse and
 * gets one `REGION` scope with `externalKey = '4661'`. LIDL groups its shops into
 * 59 offer regions and gets 59 `REGION` scopes keyed the same way. A chain with no
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
   * Mercadona warehouse key comes back in two shapes, a numeric code (`4661`) and
   * a city slug (`mad3`), and both are real answers from the same endpoint.
   */
  @Column({ type: 'varchar', nullable: true })
  externalKey!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  label!: LocalizedText | null;

  /**
   * How specific this scope is (plan 0105, section 2.1). Lower is more
   * specific, and the most specific scope that has a price for a product is the
   * price that shop charges.
   *
   * An integer and not an enum position, so a tier nobody anticipated is a
   * number rather than a migration: a chain that prices by province fits at 250
   * with no new {@link kind}, no contract change and no back office release.
   * {@link DEFAULT_SCOPE_PRIORITY} is what a creator that states none takes.
   *
   * **Beside the kind and not instead of it.** The number says how a scope
   * competes; the kind says how {@link externalKey} is read and how a shop
   * attaches to it. A warehouse code, a postal code and a store id are not
   * interchangeable, so a run declaring three kinds at once needs both facts.
   * The unique index is unchanged: priority is not part of identity.
   *
   * Gaps of 100, and an existing row is never renumbered by a migration. A
   * number that moved on its own would silently re-rank every shop holding the
   * scope.
   */
  @Column({ type: 'integer' })
  priority!: number;

  /**
   * The default of section 2.2, applied here rather than in the one service
   * that happens to create scopes today.
   *
   * "A creator that states no priority takes the default for its kind" is a
   * property of a scope, and there are four creators: the admin route, the
   * store scope a location makes for itself, the reference seed and a run.
   * Written once in a service, the other three insert a null into a NOT NULL
   * column, and the failure is a constraint violation rather than a sentence.
   *
   * There is no database default beside it on purpose: the right number
   * depends on the kind, and a column default would have to pick one and be
   * silently wrong about the other three.
   */
  @BeforeInsert()
  defaultPriority(): void {
    if (this.priority === undefined || this.priority === null) {
      this.priority = DEFAULT_SCOPE_PRIORITY[this.kind];
    }
  }
}
