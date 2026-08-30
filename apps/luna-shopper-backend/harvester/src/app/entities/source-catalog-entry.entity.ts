import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * One product as a chain last described it (plan 0038, section 4.2).
 *
 * This is the snapshot a discovery run writes, and it is also what makes
 * **resuming free rather than machinery** (section 6.3): an aborted run leaves
 * rows with a fresh `lastSeenAt`, so a re-run skips what it already has by
 * reading that timestamp. There is no checkpoint to replay, only a snapshot that
 * is already the answer.
 *
 * Entries matching no catalog item are the candidate new `Item` rows the owner
 * reviews. That is the path that populates the catalog, and it is deliberately a
 * review queue rather than a bulk insert of 4,232 products nobody chose.
 */
@Entity({ name: 'source_catalog_entries' })
@Index('uq_source_catalog_entry', ['supermarketId', 'externalId'], {
  unique: true,
})
export class SourceCatalogEntry extends BaseEntity {
  /** Opaque: catalog owns the chain. */
  @Column({ type: 'uuid' })
  supermarketId!: string;

  /** The chain's own product id, e.g. Mercadona's "4241". */
  @Column({ type: 'varchar' })
  externalId!: string;

  /**
   * The Spanish name. Discovery fetches `es` only, because fetching both
   * languages doubles a run from 4,232 requests to 8,464 and the snapshot exists
   * for matching and for candidate review, both of which Spanish serves. The
   * English name is fetched once, when an `Item` is actually created.
   */
  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar', nullable: true })
  brand!: string | null;

  /** The only identifier that joins across chains, and detail-only. */
  @Index('ix_source_catalog_entries_ean')
  @Column({ type: 'varchar', nullable: true })
  ean!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 4, nullable: true })
  unitSize!: number | null;

  /** The source's own token (`kg`, `l`, `ud`, `m`), not a `UnitOfMeasure`. */
  @Column({ type: 'varchar', nullable: true })
  sizeFormat!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  price!: number | null;

  /** `bulk_price`, verbatim and never recomputed (section 2.4). */
  @Column({ type: 'numeric', precision: 12, scale: 4, nullable: true })
  unitPrice!: number | null;

  /** `reference_format`, verbatim. Display text, never parsed into a unit. */
  @Column({ type: 'varchar', nullable: true })
  unitPriceLabel!: string | null;

  /** The path the walk took, root first. Deepest node drives the category map. */
  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  categoryPath!: string[];

  @Column({ type: 'varchar', nullable: true })
  url!: string | null;

  /** What a re-run reads to skip work it already did. */
  @Index('ix_source_catalog_entries_last_seen')
  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastSeenAt!: Date;
}
