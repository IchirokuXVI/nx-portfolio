import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A postal code reduced to a point on a map (plan 0060, section 2).
 *
 * Reference data with a natural key, replaced wholesale by a migration and
 * never written by a service, which is why it has **no `id`, no `BaseEntity`
 * and no timestamps**: a surrogate key would imply somebody edits rows, and
 * nobody does.
 *
 * It lives in catalog for the reason `ScopeResolverService` gives: core stores
 * the codes a profile holds; catalog knows where they are.
 *
 * **A centroid, never a boundary** (section 6). Every read over this table is
 * approximate in a way its caller has to say out loud.
 */
@Entity({ name: 'postal_code_points' })
@Index('ix_postal_code_points_geo', ['latitude', 'longitude'])
export class PostalCodePoint {
  /** ISO 3166-1 alpha-2, lowercase. */
  @PrimaryColumn({ type: 'varchar', length: 2 })
  country!: string;

  @PrimaryColumn({ type: 'varchar', length: 16 })
  postalCode!: string;

  @Column({ type: 'double precision' })
  latitude!: number;

  @Column({ type: 'double precision' })
  longitude!: number;
}
