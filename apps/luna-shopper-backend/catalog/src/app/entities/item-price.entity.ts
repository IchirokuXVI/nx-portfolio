import {
  PriceSourceKind,
  type ItemPriceOverrides,
} from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Item } from './item.entity';
import { PriceScope } from './price-scope.entity';

/**
 * One price a source gave, for one {@link Item} in one {@link PriceScope}, of
 * one kind (plan 0080, section 2).
 *
 * A row is an **interval**, not an event: `observedAt` is the first time the
 * source stated this number and `lastObservedAt` the last. A run that sees the
 * same number moves the second and inserts nothing, so the table grows with
 * price changes rather than with runs (section 2.1). Nothing here is unique
 * except `id`: two rows of one kind for one key with different `observedAt`
 * are the history, and a source that changes its mind twice in a day writes
 * two rows.
 *
 * No write ever changes another row's values. Which price a shopper sees is a
 * pure function of these rows, the policy and the clock (section 4), and the
 * answer is materialized on {@link SupermarketItem}.
 *
 * `available` is deliberately not here. Whether a scope carries a product is a
 * scope wide fact about stock, not a claim a price row makes, and a leaflet row
 * has nothing to say about it.
 */
@Entity({ name: 'item_prices' })
@Index('ix_item_prices_current', [
  'itemId',
  'priceScopeId',
  'sourceKind',
  'observedAt',
])
@Index('ix_item_prices_history', ['itemId', 'priceScopeId', 'observedAt'])
export class ItemPrice extends BaseEntity {
  @Column({ type: 'uuid' })
  itemId!: string;

  @ManyToOne(() => Item, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'itemId' })
  item!: Item;

  @Column({ type: 'uuid' })
  priceScopeId!: string;

  @ManyToOne(() => PriceScope, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'priceScopeId' })
  priceScope!: PriceScope;

  @Column({
    type: 'enum',
    enum: PriceSourceKind,
    enumName: 'price_source_kind',
  })
  sourceKind!: PriceSourceKind;

  /** What the till charges for one pack. */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  price!: number | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  currency!: string | null;

  /** The source's own figure, verbatim, never recomputed (plan 0038, section 2.4). */
  @Column({ type: 'numeric', precision: 12, scale: 4, nullable: true })
  unitPrice!: number | null;

  /** Text, never a unit (plan 0038, section 2.4). */
  @Column({ type: 'varchar', nullable: true })
  unitPriceLabel!: string | null;

  /** The first time this source stated this number. */
  @Column({ type: 'timestamptz' })
  observedAt!: Date;

  /** The last time it stated it. Equal to `observedAt` on insert. */
  @Column({ type: 'timestamptz' })
  lastObservedAt!: Date;

  /** The row applies from here. Null means from `observedAt`. */
  @Column({ type: 'timestamptz', nullable: true })
  validFrom!: Date | null;

  /** Exclusive. Null means until superseded. */
  @Column({ type: 'timestamptz', nullable: true })
  validUntil!: Date | null;

  /**
   * The harvest run that wrote it. Opaque, never joined, and on every row from
   * the first migration: the undo plan (0082) deletes by it, and a column added
   * later would start empty for exactly the rows undo most needs to find.
   */
  @Index('ix_item_prices_source_run')
  @Column({ type: 'uuid', nullable: true })
  sourceRunId!: string | null;

  /** The run that last moved `lastObservedAt`. Equal to `sourceRunId` on insert. */
  @Column({ type: 'uuid', nullable: true })
  lastObservedRunId!: string | null;

  /**
   * `ADMIN` rows only (section 4.2): what each automated kind said at the
   * instant the operator typed, so the protection test is a comparison against
   * a stored snapshot and never against the previous run.
   */
  @Column({ type: 'jsonb', nullable: true })
  overrides!: ItemPriceOverrides | null;

  /** `ADMIN` rows only: `observedAt` plus seven days. */
  @Column({ type: 'timestamptz', nullable: true })
  protectedUntil!: Date | null;
}
