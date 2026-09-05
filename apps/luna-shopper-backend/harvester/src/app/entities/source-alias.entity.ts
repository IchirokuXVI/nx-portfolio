import {
  ItemSourceMatch,
  SourceAliasStatus,
} from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * One name a chain printed for a product, and what became of it (plan 0081,
 * section 2).
 *
 * The owner's requirement, in his words: the leaflet name must be recorded, so
 * it resolves exactly next time. Names are matched against the name already
 * stored **for the chain**, never against the catalog product name. One product
 * appears in many leaflets and each names it differently, and accepting a
 * product into the catalog changes its name and brand at will.
 *
 * **Accepting an alias sets `itemId` and never touches `printedName`.** That
 * rule falls out of the schema rather than being enforced anywhere: an admin who
 * accepts a queued row and renames the item changes `items`, the alias still
 * reads what the leaflet printed, and the next leaflet that prints the same
 * string hits the same row.
 *
 * **Why this is not a `SourceCatalogEntry` with a synthesized `externalId`.**
 * That was the first proposal and it corrupts data: `mercadona.client.ts`
 * interpolates a stored `externalId` into a detail URL for every ACTIVE ref, and
 * a 404 becomes `available: false`, so a synthesized id would mark a real
 * product out of stock on the next refresh. `ItemSourceRef` is unique on (item,
 * chain), so it holds one name per product per chain and the owner wants many.
 * And discovery entries enter the matcher as candidates. A separate table has
 * none of those problems.
 *
 * Backlog `0008` wants this table for till receipts, whose `ItemReceiptAlias`
 * has the same shape for the same reason. When that plan is picked up it adds a
 * `kind` column here rather than a second table.
 */
@Entity({ name: 'source_aliases' })
@Unique('uq_source_aliases_key', ['supermarketId', 'aliasKey'])
export class SourceAlias extends BaseEntity {
  /** Opaque, as every catalog id is here. */
  @Column({ type: 'uuid' })
  supermarketId!: string;

  /**
   * `normalizeName(name)`, a pipe, then `normalizeName(format.raw ?? '')`
   * (section 2.1), with the same `normalizeName` the discovery matcher uses so
   * the two agree.
   *
   * **Brand is not in it.** One extractor read a brand on 0 of 219 offers and
   * another on 43 of 48, so a key including brand resolves one product one way
   * from one extractor and another way from the other. **Format is**, because
   * two offers with the same printed name are told apart by their format: zero
   * collisions on name plus format against one on name alone.
   */
  @Column({ type: 'varchar' })
  aliasKey!: string;

  /** `product.name` exactly as printed. */
  @Column({ type: 'varchar' })
  printedName!: string;

  /** `product.format.raw` exactly as printed. */
  @Column({ type: 'varchar', nullable: true })
  printedFormat!: string | null;

  /** `product.brand` when the extractor read one. Shown in the queue, in no key. */
  @Column({ type: 'varchar', nullable: true })
  printedBrand!: string | null;

  /** Set on ACTIVE only, and only ever by a person. */
  @Column({ type: 'uuid', nullable: true })
  itemId!: string | null;

  /** What the fuzzy rung proposed, for the queue to show. */
  @Column({ type: 'uuid', nullable: true })
  candidateItemId!: string | null;

  /** A `SourceCatalogEntry` the fuzzy rung proposed, when no item exists yet. */
  @Column({ type: 'uuid', nullable: true })
  candidateEntryId!: string | null;

  @Index('ix_source_aliases_status')
  @Column({
    type: 'enum',
    enum: SourceAliasStatus,
    enumName: 'source_alias_status',
    default: SourceAliasStatus.UNRESOLVED,
  })
  status!: SourceAliasStatus;

  /**
   * `NAME_SIZE` for a fuzzy proposal, `MANUAL` for one a person accepted.
   *
   * No database default, and that is the migration's constraint rather than a
   * preference: `NAME_SIZE` is added to the enum in the same transaction that
   * creates this table, and Postgres refuses to use a new label before its
   * `ALTER TYPE` commits. Every writer states it.
   */
  @Column({
    type: 'enum',
    enum: ItemSourceMatch,
    enumName: 'item_source_match',
  })
  matchedBy!: ItemSourceMatch;

  /** Below 1 only for a NAME_SIZE proposal. */
  @Column({ type: 'numeric', precision: 4, scale: 3, default: 0 })
  confidence!: number;

  @Column({ type: 'integer', default: 1 })
  timesSeen!: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  firstSeenAt!: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastSeenAt!: Date;

  /**
   * The run that created it. Indexed because plan 0082 deletes the rows nobody
   * decided on by it: a run that must not introduce anything must not introduce
   * work for a person either.
   */
  @Index('ix_source_aliases_first_run')
  @Column({ type: 'uuid', nullable: true })
  firstRunId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  lastRunId!: string | null;
}
