import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { SourceCatalogEntry } from './source-catalog-entry.entity';
import { SourceLocation } from './source-location.entity';

/**
 * Whether one shop of a source carries one product of that source, as the last
 * run that named the pair stated it (plan 0182).
 *
 * **It exists so that a claim outlives the run that made it.** A run used to
 * hold its claims in memory and write them to catalog once, at its end, for
 * the rows that were bound and the shops that were mapped at that moment. On
 * the first run of a chain no row is bound, so every claim was dropped, and
 * binding the row or mapping the shop afterwards had nothing left to send.
 * DEZA prints no price, so what a DEZA run learns is exactly this table.
 *
 * **Both sides are the source's own vocabulary.** The row is keyed on a
 * `source_catalog_entries` row and a `source_locations` row, never on a
 * catalog item or a catalog location: which item and which location they are
 * is a person's decision that can come later, change, or never come. The
 * claim is stored whether or not either side is decided, and it is sent to
 * catalog when both are.
 *
 * **One row per pair, and a later run replaces it.** A claim is a fact about
 * one run. `available: false` is a claim too: a source that names the shops
 * carrying a product says by omission that the others do not. Nothing deletes
 * a row because a run did not see the product.
 */
@Entity({ name: 'source_entry_availability' })
@Unique('uq_source_entry_availability', ['entryId', 'sourceLocationId'])
export class SourceEntryAvailability extends BaseEntity {
  @Column({ type: 'uuid' })
  entryId!: string;

  /** A claim has no meaning without its row, so it goes when the row goes. */
  @ManyToOne(() => SourceCatalogEntry, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'entryId' })
  entry!: SourceCatalogEntry;

  @Index('ix_source_entry_availability_location')
  @Column({ type: 'uuid' })
  sourceLocationId!: string;

  @ManyToOne(() => SourceLocation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sourceLocationId' })
  sourceLocation!: SourceLocation;

  @Column({ type: 'boolean' })
  available!: boolean;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  observedAt!: Date;

  /** The run that last stated the claim. Opaque, never joined. */
  @Index('ix_source_entry_availability_run')
  @Column({ type: 'uuid', nullable: true })
  runId!: string | null;
}
