import { Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { PriceScope } from './price-scope.entity';
import { SupermarketLocation } from './supermarket-location.entity';

/**
 * One shop, one of the scopes it sells at (plan 0105, section 3.1).
 *
 * The table {@link SupermarketLocation}'s `priceScopeId` column became. A shop
 * used to point at exactly one scope, so no code ever had to choose between
 * two; a chain that prices nationally, by region and by shop at the same time
 * puts one shop under three of them, and each scope's `priority` is what says
 * which one the shop is quoted from.
 *
 * **An entity of its own rather than a bare `@JoinTable`**, because the two
 * sides need different delete behaviour and a plain join table gives one: a
 * shop that goes takes its rows with it (`CASCADE`), and a scope that prices
 * are written against must not vanish under them (`RESTRICT`, kept from the
 * column it replaces).
 *
 * It carries no `id`, no timestamps and no copy of the scope's priority. The
 * pair is the identity, and the priority is read from `price_scopes` on every
 * ranking rather than copied: an admin may move a scope's number, and a copy
 * would then rank shops by a number the scope no longer has.
 */
@Entity({ name: 'supermarket_location_price_scopes' })
export class SupermarketLocationPriceScope {
  @PrimaryColumn({ type: 'uuid' })
  supermarketLocationId!: string;

  @ManyToOne(() => SupermarketLocation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'supermarketLocationId' })
  supermarketLocation!: SupermarketLocation;

  @Index('ix_location_scopes_scope')
  @PrimaryColumn({ type: 'uuid' })
  priceScopeId!: string;

  @ManyToOne(() => PriceScope, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'priceScopeId' })
  priceScope!: PriceScope;
}
