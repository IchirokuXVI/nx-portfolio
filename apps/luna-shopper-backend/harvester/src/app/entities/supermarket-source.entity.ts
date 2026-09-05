import type { AdapterKey } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * One chain's fetching configuration (plan 0038, section 4.2).
 *
 * The two knobs do **two different jobs**, and that is the part that is easy to
 * get wrong (section 6.3):
 *
 * - `workers` bounds how many requests are in flight at once: sockets and memory.
 * - `maxRequestsPerSecond` bounds our impact on the source: politeness.
 *
 * They are separate because a single per worker delay is a bug at any concurrency
 * above one: four workers each pausing 250 ms is sixteen requests per second, not
 * four, and the number the owner set is not the number the source sees. So a run
 * holds one token bucket that every worker blocks on.
 *
 * **No schedule columns.** Backlog 0001's dynamic cron registry is not built,
 * every run here is started by a person, and a column nothing reads is a column
 * that will be wrong by the time something does.
 */
@Entity({ name: 'supermarket_sources' })
export class SupermarketSource extends BaseEntity {
  /** Opaque: catalog owns the row this points at. */
  @Index('uq_supermarket_sources_supermarket', { unique: true })
  @Column({ type: 'uuid' })
  supermarketId!: string;

  @Column({ type: 'varchar' })
  adapterKey!: AdapterKey;

  /**
   * Off by default, and **the** per chain switch (plan 0083). If a chain ever
   * objects, this row goes false and the catalog keeps working on hand entered
   * prices (section 8.1). It is written from the back office through
   * `supermarketSource.setEnabled`, so turning one chain off takes no redeploy
   * and adding a chain adds a row rather than an environment variable.
   */
  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  /** Adapter specific settings, e.g. Mercadona's postal code. */
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  config!: Record<string, unknown>;

  @Column({ type: 'integer', default: 4 })
  workers!: number;

  /**
   * The default is 4, and it is **the only number in section 6.3 with no
   * evidence behind it**: workers and concurrency were measured, this was chosen.
   * It decides whether a run takes 9 minutes or 73. Nothing was tested against
   * Mercadona at rate, deliberately, since finding the limit means exceeding it.
   * Treat any 429 as a signal to halve rather than to retry harder.
   */
  @Column({ type: 'numeric', precision: 6, scale: 2, default: 4 })
  maxRequestsPerSecond!: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastRunAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSuccessAt!: Date | null;

  @Column({ type: 'integer', default: 0 })
  consecutiveFailures!: number;
}
