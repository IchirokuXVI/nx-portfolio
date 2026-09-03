import { PostalCodeDiscoveryStatus } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * One postal code somebody asked about, waiting to become a discovery run (plan
 * 0063, section 3).
 *
 * **This table exists because a run cannot do its job.** The partial unique
 * index over `harvest_runs` treats PENDING and RUNNING as in progress, which is
 * correct and which plan 0063 deliberately does not touch, so one profile write
 * announcing six codes cannot be six runs: one would insert and five would throw,
 * invisibly, because the announcement is fire and forget. This is the backlog of
 * work that has not become a run yet, and a worker drains it one run at a time.
 *
 * Politeness is the second reason and points the same way: `OsmPlacesClient`
 * rate limits itself per instance, so six concurrent clients are six times the
 * rate Nominatim's policy allows, and that policy is why the source is usable at
 * all.
 *
 * `HarvestRun` gains nothing from this plan. A run is still a run; the queue is
 * a different thing standing next to it.
 */
@Entity({ name: 'postal_code_discovery_requests' })
@Unique('uq_postal_code_discovery_country_code', ['country', 'postalCode'])
export class PostalCodeDiscoveryRequest extends BaseEntity {
  /** ISO 3166-1 alpha-2, lowercase. */
  @Column({ type: 'varchar', length: 2 })
  country!: string;

  @Column({ type: 'varchar', length: 16 })
  postalCode!: string;

  @Index('ix_postal_code_discovery_status')
  @Column({
    type: 'enum',
    enum: PostalCodeDiscoveryStatus,
    default: PostalCodeDiscoveryStatus.QUEUED,
  })
  status!: PostalCodeDiscoveryStatus;

  /** When the code was first announced. It is not moved by a later enqueue. */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  requestedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastAttemptedAt!: Date | null;

  /**
   * When a run last **completed** for this code. The 30 day cooldown counts from
   * here and from nowhere else (section 4): a supermarket opening is rare and a
   * supermarket closing rarer, so re asking every week costs two requests and
   * buys almost nothing, which at volume from a volunteer funded service is the
   * shape of a bad neighbour.
   */
  @Column({ type: 'timestamptz', nullable: true })
  discoveredAt!: Date | null;

  /**
   * When a backed off retry becomes eligible. Null on a row that is not waiting
   * to be retried, which is what makes a plain `IS NULL OR <= now()` the whole
   * of the claim's due check.
   */
  @Column({ type: 'timestamptz', nullable: true })
  nextAttemptAt!: Date | null;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  /** The last run this row produced. Opaque, and never a foreign key. */
  @Column({ type: 'uuid', nullable: true })
  runId!: string | null;

  /**
   * Why the last attempt failed, kept on a FAILED row rather than only logged.
   * A code Nominatim cannot geocode at all usually means the postal code is
   * wrong rather than that the internet is broken, and that is worth showing
   * somebody (backlog 0009).
   */
  @Column({ type: 'text', nullable: true })
  error!: string | null;
}
