import type { LocalizedText } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { PriceScope } from './price-scope.entity';
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

  /**
   * The scope whose prices this store sells at (plan 0038, section 5.1). Every
   * location has one: a chain with no obtainable data gets a STORE scope of its
   * own, which is what makes hand entered supermarkets need no special case.
   *
   * Assigning it: where the store's own postal code is known it resolves through
   * the chain's own resolver; where it is not (two thirds of OSM stores carry no
   * postcode) it takes the scope of the postal code the discovery run was centred
   * on, and the location is flagged for review. Within one city the price
   * difference was not measurable, and the flag means the guess is visible.
   */
  @Index('ix_locations_price_scope')
  @Column({ type: 'uuid' })
  priceScopeId!: string;

  @ManyToOne(() => PriceScope, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'priceScopeId' })
  priceScope!: PriceScope;

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

  /**
   * A plain gap the entity had, independent of the harvester: it carried
   * `address`, `city` and `country` but no postal code, and the postal code is
   * what resolves a chain's price scope.
   */
  @Column({ type: 'varchar', nullable: true })
  postalCode!: string | null;

  /**
   * The discovery provider's own reference, e.g. `node/1156230891`.
   *
   * **Not a reliable primary identity** (plan 0038, section 5.5): an OSM element
   * changes id *and* type when someone upgrades a shop from a `node` to a mapped
   * building `way`. Re-discovery matches on this first, then falls back to "same
   * brand within 50 metres", and a location matching neither is offered as new
   * rather than silently duplicated.
   */
  @Column({ type: 'varchar', nullable: true })
  externalRef!: string | null;

  /** Whose ref that is (`OSM`). Meaningless to store a ref without saying. */
  @Column({ type: 'varchar', nullable: true })
  externalProvider!: string | null;
}
