import { DiscoveredPlaceStatus } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * A supermarket a store discovery run found (plan 0038, section 4.2).
 *
 * **A run creates nothing in catalog.** A radius over a city returns 75 places of
 * which half are independent corner shops, and auto-creating those would fill the
 * catalog with rows nobody asked for. Import is a second, explicit step, and it
 * is also where the owner's own hand entered supermarkets already fit without any
 * new mechanism.
 */
@Entity({ name: 'discovered_places' })
@Index('uq_discovered_place', ['provider', 'externalRef'], { unique: true })
export class DiscoveredPlace extends BaseEntity {
  /** The run that most recently saw it. Kept for the grouped report. */
  @Index('ix_discovered_places_run')
  @Column({ type: 'uuid', nullable: true })
  runId!: string | null;

  @Column({ type: 'varchar' })
  provider!: string;

  /** `node/1156230891`. Type included: ids are unique only per element type. */
  @Column({ type: 'varchar' })
  externalRef!: string;

  /**
   * `brand:wikidata`, the chain's identity. Not the brand name: `Dia` and `Maxi
   * Dia` share one QID while name matching would split them, and 35 of the 75
   * elements in the wider search carry no brand tag at all.
   */
  @Index('ix_discovered_places_brand')
  @Column({ type: 'varchar', nullable: true })
  brandKey!: string | null;

  @Column({ type: 'varchar', nullable: true })
  brandName!: string | null;

  @Column({ type: 'varchar', nullable: true })
  name!: string | null;

  /**
   * Position is the one thing every element has: 100% coverage across the 353
   * element sample, against 33% for `addr:postcode`. That is why discovery is a
   * radius around a point and never a postcode filter.
   */
  @Column({ type: 'double precision' })
  latitude!: number;

  @Column({ type: 'double precision' })
  longitude!: number;

  @Column({ type: 'varchar', nullable: true })
  street!: string | null;

  @Column({ type: 'varchar', nullable: true })
  city!: string | null;

  @Column({ type: 'varchar', nullable: true })
  postalCode!: string | null;

  @Column({ type: 'varchar', nullable: true })
  website!: string | null;

  @Column({ type: 'varchar', nullable: true })
  openingHours!: string | null;

  /**
   * The provider's tag bag **as fetched**, not reshaped (section 8.2). Catalog
   * holds the fields it has a use for; this is harvest working data, and keeping
   * it whole is what makes a mapping change visible rather than lost.
   */
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  tags!: Record<string, string>;

  @Column({
    type: 'enum',
    enum: DiscoveredPlaceStatus,
    default: DiscoveredPlaceStatus.NEW,
  })
  status!: DiscoveredPlaceStatus;

  /** Written back on import, so a re-run recognizes the place as already ours. */
  @Column({ type: 'uuid', nullable: true })
  supermarketLocationId!: string | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  firstSeenAt!: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastSeenAt!: Date;
}
