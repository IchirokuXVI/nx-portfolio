import {
  ItemSourceMatch,
  PriceSourceKind,
  SourceEntryStatus,
} from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { SourceEntryPrice } from './source-entry-price.entity';

/**
 * One product as a source described it, and what became of it (plan 0086,
 * sections 3.1 and D1).
 *
 * **This is the only record of a product a source described**, for every source
 * kind. A Mercadona walk, a DEZA crawl and a leaflet upload used to write three
 * tables through two matching ladders into three review queues; they write this
 * one now. `item_source_refs` and `source_aliases` are gone.
 *
 * The columns fall into two groups and **the split is the contract**:
 *
 * - The source's: `name`, `brand`, `ean`, `unitSize`, `sizeFormat`,
 *   `categoryPath`, `url`, `extra`. Every run rewrites these verbatim.
 * - A person's, or the EAN rung's: `itemId`, `candidateEntryId`, `status`,
 *   `matchedBy`, `confidence`, `decidedAt`. A run only reads these.
 *
 * That is what makes a product without an EAN resolvable at all (D8). Its name
 * is its identity, so a decision never rewrites the name: accepting a row sets
 * `itemId` and touches nothing in the first group, the item can then be renamed
 * to anything at all, and the next walk or file that produces the same key hits
 * this same row.
 *
 * It is also what makes **resuming free rather than machinery** (plan 0038,
 * section 6.3): an aborted run leaves rows with a fresh `lastSeenAt`, so a
 * re-run skips what it already has by reading that timestamp. There is no
 * checkpoint to replay, only a snapshot that is already the answer.
 */
@Entity({ name: 'source_catalog_entries' })
@Index('uq_source_catalog_entry', ['supermarketId', 'externalId'], {
  unique: true,
})
export class SourceCatalogEntry extends BaseEntity {
  /** Opaque: catalog owns the chain. */
  @Column({ type: 'uuid' })
  supermarketId!: string;

  /**
   * The chain's own product id (Mercadona's "4241"), or `entryKey(name,
   * sizeFormat)` for a source that has none (D2).
   *
   * **Nothing parses it.** Whether the id can be fetched is what a code path
   * needs to know, and {@link sourceKind} says that. A DEZA listing and a DEZA
   * leaflet printing the same name and size land on the same row, which is the
   * meeting plan 0085 section 6 chose the key shape for.
   */
  @Column({ type: 'varchar' })
  externalId!: string;

  /**
   * What kind of observation made this row, and the discriminator every code
   * path reads. One of the three official kinds today; backlog 0008's till
   * receipts are `USER_RECEIPT` when that plan is picked up, on this same
   * table, which is the `kind` column it asked for.
   */
  @Column({
    type: 'enum',
    enum: PriceSourceKind,
    enumName: 'price_source_kind',
  })
  sourceKind!: PriceSourceKind;

  /**
   * The Spanish name, verbatim, **never rewritten by a decision** (D8).
   *
   * A discovery run fetches `es` only, because fetching both languages doubles
   * a run from 4,232 requests to 8,464 and the snapshot exists for matching and
   * for review, both of which Spanish serves. The English name is fetched once,
   * when an `Item` is actually created, and only for a source whose id can be
   * fetched.
   */
  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar', nullable: true })
  brand!: string | null;

  /** The only identifier that joins across chains. Leaflets and DEZA rarely fill it. */
  @Index('ix_source_catalog_entries_ean')
  @Column({ type: 'varchar', nullable: true })
  ean!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 4, nullable: true })
  unitSize!: number | null;

  /** The source's own token (`kg`, `l`, `ud`, `m`), not a `UnitOfMeasure`. */
  @Column({ type: 'varchar', nullable: true })
  sizeFormat!: string | null;

  /** The path the walk took, root first. Deepest node drives the category map. */
  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  categoryPath!: string[];

  @Column({ type: 'varchar', nullable: true })
  url!: string | null;

  /**
   * The last observation's `extra` bag (plan 0086, section 6.1): a leaflet's
   * page, raw text, loyalty and promotion blocks, a chain that sells for points,
   * whatever the producer knew and the import does not read.
   *
   * **Stored, shown in the queue, and never interpreted.** It is what lets a
   * person decide a row the import could not. A rule that wanted to read
   * something out of it would make that thing a field of the file schema, in a
   * new version, rather than reaching in here.
   */
  @Column({ type: 'jsonb', nullable: true })
  extra!: Record<string, unknown> | null;

  /** Every observation adds one. */
  @Column({ type: 'integer', default: 1 })
  timesSeen!: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  firstSeenAt!: Date;

  /** What a re-run reads to skip work it already did, and what the queue sorts on. */
  @Index('ix_source_catalog_entries_last_seen')
  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastSeenAt!: Date;

  /**
   * The run that created it. Indexed because a revert deletes the rows nobody
   * decided on by this **and** `lastRunId`: a row this run created and a later
   * run observed again is a real product a later run stands behind, and
   * deleting it would take the later run's observation with it.
   */
  @Index('ix_source_catalog_entries_first_run')
  @Column({ type: 'uuid', nullable: true })
  firstRunId!: string | null;

  /** The run that last observed it. An export is every row whose value is that run. */
  @Column({ type: 'uuid', nullable: true })
  lastRunId!: string | null;

  /** Set on ACTIVE, and on CANDIDATE as the proposal. Opaque: catalog owns the item. */
  @Column({ type: 'uuid', nullable: true })
  itemId!: string | null;

  /**
   * A sibling row of this chain the fuzzy rung proposed, when that sibling has
   * no item yet (section 4, rung 4).
   *
   * It is how a leaflet name and a walk's product id meet: the admin creates the
   * item from whichever row carries the EAN, and both resolve to it.
   */
  @Column({ type: 'uuid', nullable: true })
  candidateEntryId!: string | null;

  @Index('ix_source_catalog_entries_status')
  @Column({
    type: 'enum',
    enum: SourceEntryStatus,
    enumName: 'source_entry_status',
    default: SourceEntryStatus.UNRESOLVED,
  })
  status!: SourceEntryStatus;

  /** Null when nothing answered, which is what an UNRESOLVED row looks like. */
  @Column({
    type: 'enum',
    enum: ItemSourceMatch,
    enumName: 'item_source_match',
    nullable: true,
  })
  matchedBy!: ItemSourceMatch | null;

  /** 1 for EAN and MANUAL, 0.6 for a fuzzy proposal, 0 for UNRESOLVED. */
  @Column({ type: 'numeric', precision: 4, scale: 3, default: 0 })
  confidence!: number;

  /** When the status left the queue, by a person or by the EAN rung. */
  @Column({ type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  /**
   * The latest price each scope stated for this row (section 3.2).
   *
   * Not a column on the row, because a chain has several leaflets at once, each
   * for a region, and two of them print the same product: the decision is one
   * and the prices are one per scope (D3).
   */
  @OneToMany(() => SourceEntryPrice, (price) => price.entry)
  prices!: SourceEntryPrice[];
}
