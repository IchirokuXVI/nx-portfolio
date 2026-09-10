import {
  PostalCodeSource,
  type LocalizedText,
} from '@portfolio/luna-shopper/contracts';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from 'typeorm';
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
   * The scopes whose prices this store sells at (plan 0038, section 5.1; made
   * plural by plan 0105, section 3).
   *
   * **Every location has at least one**, and that is still the floor: a chain
   * with no obtainable data gets a STORE scope of its own, which is what makes
   * hand entered supermarkets need no special case. It was a single non-null
   * column until Mercadona turned out to price by warehouse *and* by tax region
   * *and*, where somebody prices a shop by hand, by shop. One shop then sits
   * under three scopes, and each scope's `priority` says which one it is quoted
   * from.
   *
   * Assigning them: where the store's own postal code is known it resolves
   * through the chain's own resolver; where it is not, the location still gets
   * a STORE scope of its own and nothing here changes.
   *
   * **Deriving a postal code does not touch these** (plan 0061, section 4).
   * {@link postalCodeSource} says where the location *is*; this says what it
   * prices against, and re resolving a scope from a derived code is a larger
   * change belonging to whoever picks up chain specific scope resolution.
   *
   * The relation is lazy in the sense that nothing loads it by default: the
   * services that need the stack ask for it, and the ones that need only the
   * quoted scope read it through the join table in SQL rather than hydrating
   * three entities to sort them by an integer.
   */
  @ManyToMany(() => PriceScope)
  @JoinTable({
    name: 'supermarket_location_price_scopes',
    joinColumn: { name: 'supermarketLocationId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'priceScopeId', referencedColumnName: 'id' },
  })
  priceScopes!: PriceScope[];

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
   * Where {@link postalCode} came from (plan 0061, section 5). Nullable
   * alongside a null code, so "we have no idea" stays expressible: a store whose
   * nearest centroid is beyond the bound keeps both columns null, because a
   * wrong postcode is worse than none. None produces a price that says it is
   * approximate; wrong produces a confident price for the wrong scope.
   *
   * `DERIVED` is the review flag the class doc used to promise and nothing
   * implemented. It is what an eventual admin queue sorts on.
   */
  @Column({
    type: 'enum',
    enum: PostalCodeSource,
    nullable: true,
  })
  postalCodeSource!: PostalCodeSource | null;

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
