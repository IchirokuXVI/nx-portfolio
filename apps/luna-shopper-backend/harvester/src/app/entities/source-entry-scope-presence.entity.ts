import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { SourceCatalogEntry } from './source-catalog-entry.entity';

/**
 * Whether the listing of one price scope still names one product of a chain,
 * counted over whole walks (plan 0220, section 4.1).
 *
 * **A row exists only for a pair a counted walk saw listed**, or that the seed
 * of section 4.2 created from a price the scope once read. A product a
 * warehouse never listed has no row there and is never missed there, so a
 * product sold in one warehouse is never gone because another one does not
 * list it.
 *
 * **The counter is the only writer** (`DelistingService`). A runner reports a
 * whole listing and never reads or writes this table, and nothing deletes a
 * row of it but the cascade from its source row.
 */
@Entity({ name: 'source_entry_scope_presence' })
@Unique('uq_source_entry_scope_presence', ['entryId', 'priceScopeId'])
@Index('ix_source_entry_scope_presence_gone', ['entryId'], {
  where: '"goneAt" IS NOT NULL',
})
export class SourceEntryScopePresence extends BaseEntity {
  @Column({ type: 'uuid' })
  entryId!: string;

  /** A count has no meaning without its row, so it goes when the row goes. */
  @ManyToOne(() => SourceCatalogEntry, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'entryId' })
  entry!: SourceCatalogEntry;

  /** Opaque: catalog owns the scope. */
  @Index('ix_source_entry_scope_presence_scope')
  @Column({ type: 'uuid' })
  priceScopeId!: string;

  /** Whole walks in a row that did not list the product, 0 when listed. */
  @Column({ type: 'smallint', default: 0 })
  missedWalks!: number;

  /** The first miss of the current run of misses, null when listed. */
  @Column({ type: 'timestamptz', nullable: true })
  firstMissedAt!: Date | null;

  /** When the threshold first held (section 5), null otherwise. */
  @Column({ type: 'timestamptz', nullable: true })
  goneAt!: Date | null;

  /** The last run that counted this pair, so a retry counts once. */
  @Column({ type: 'uuid', nullable: true })
  lastCountedRunId!: string | null;

  /** A transition catalog has not acknowledged yet (section 6.1). */
  @Column({ type: 'boolean', default: false })
  pendingCatalog!: boolean;
}
