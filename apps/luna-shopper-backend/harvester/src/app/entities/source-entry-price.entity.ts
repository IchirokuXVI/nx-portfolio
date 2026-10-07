import { PriceSourceKind } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { SourceCatalogEntry } from './source-catalog-entry.entity';

/**
 * The latest price one scope stated for one row (plan 0086, section 3.2).
 *
 * **Why this is a table and not three columns on the row.** A chain has several
 * leaflets at once because each one is for a region, that is, for a price scope,
 * and two of them print the same product. The **decision** about that product is
 * one, for the chain. The **prices** are one per scope (D3). Three columns on
 * the row were one price with no scope on a row that several scopes describe,
 * and the second region's leaflet overwrote the first's.
 *
 * A run observing a price for a scope replaces that scope's row **of its own
 * kind** (plan 0190). A website and a leaflet of one chain can print one
 * product the same way, and they then share one row of
 * `source_catalog_entries`. Each states its own price, so the key holds the
 * kind: a leaflet price and a website price for one scope are two rows here,
 * and neither run overwrites the other's. A run observing no price, a DEZA
 * crawl or a leaflet tile whose only number is one a shopper cannot pay for
 * one unit, writes nothing here and leaves what an earlier run said.
 *
 * This is **not** where a shopper's price lives. Every price a source gives is a
 * row of `item_prices` in catalog, stamped with the run that wrote it, and plan
 * 0080's policies decide on every read which one a shopper sees. These rows are
 * what the queue shows and what an accept writes from, one `catalog.addPrices`
 * call per scope, each with its own run id.
 */
@Entity({ name: 'source_entry_prices' })
@Unique('uq_source_entry_prices_scope_kind', [
  'entryId',
  'priceScopeId',
  'sourceKind',
])
export class SourceEntryPrice extends BaseEntity {
  @Column({ type: 'uuid' })
  entryId!: string;

  @ManyToOne(() => SourceCatalogEntry, (entry) => entry.prices, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'entryId' })
  entry!: SourceCatalogEntry;

  /** The scope the run was started for. Opaque: catalog owns the scope. */
  @Column({ type: 'uuid' })
  priceScopeId!: string;

  /**
   * What stated this price: the kind of the run that observed it (plan 0190).
   *
   * An accept writes the price to catalog under this kind and never under the
   * kind of the row, which says who owns the text of the row and nothing
   * about one price. Plan 0080 decides the shown price by kind, so a leaflet
   * price on a row that a website walk owns must still arrive as a leaflet
   * price.
   *
   * **Every run writes it. Null is only a row from before the plan whose kind
   * the migration could not read**: the row names no run, its run is gone, or
   * the run does not say. Such a price is not guessed at. It is shown, it is
   * not sent to catalog, and the settle of plan 0191 keeps everything at its
   * scope.
   */
  @Column({
    type: 'enum',
    enum: PriceSourceKind,
    enumName: 'price_source_kind',
    nullable: true,
  })
  sourceKind!: PriceSourceKind | null;

  /**
   * The till price for one unit.
   *
   * Null when the source stated only a comparison figure, a per kilogram price
   * with no pack price. The row then carries the unit price alone, which is
   * plan 0081 section 6.1's one rule the ingest still keeps.
   */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  price!: number | null;

  @Column({ type: 'varchar', length: 3, default: 'EUR' })
  currency!: string;

  /** The source's own normalized price, verbatim and never recomputed. */
  @Column({ type: 'numeric', precision: 12, scale: 4, nullable: true })
  unitPrice!: number | null;

  /** The source's own label for that number. Display text, never parsed into a unit. */
  @Column({ type: 'varchar', nullable: true })
  unitPriceLabel!: string | null;

  /** A file's window. Null for a storefront price, which has none. */
  @Column({ type: 'timestamptz', nullable: true })
  validFrom!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  validUntil!: Date | null;

  /** The observation's `extra` bag at the time. Written on, never read. */
  @Column({ type: 'jsonb', nullable: true })
  details!: Record<string, unknown> | null;

  /** When the source stated it, not when the row was written. */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  observedAt!: Date;

  /**
   * The run that observed it, and the run an accept stamps its `item_prices`
   * row with, so a revert of that run takes the price back with the rest.
   *
   * Nullable for the rows plan 0086's migration folded in from the old
   * `source_catalog_entries.price` column: no walk recorded which run had
   * written it.
   */
  @Index('ix_source_entry_prices_run')
  @Column({ type: 'uuid', nullable: true })
  runId!: string | null;

  /**
   * The scope this price was read at, when the run copied it to this row's
   * scope (plan 0118, section 5). Null for a price read at its own scope.
   * Opaque like `priceScopeId`, and kept when the scope it names is deleted.
   */
  @Column({ type: 'uuid', nullable: true })
  copiedFromScopeId!: string | null;
}
