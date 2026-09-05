import { PriceSourceKind } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Item } from './item.entity';
import { PriceScope } from './price-scope.entity';

/**
 * The price a shopper sees for one {@link Item} within one {@link PriceScope}
 * (plan 0038, section 5.2, sharpened by plan 0080, section 7). It was keyed on
 * the store until the scope arrived; re-keying it is what stopped Mercadona
 * writing twelve identical rows for one city.
 *
 * What is genuinely per store (where the product sits in the aisle, and whether
 * someone checked this specific shop) lives on {@link SupermarketLocationItem}
 * instead. A warehouse cannot answer either.
 *
 * **Since plan 0080 this row is derived.** Every price a source gave is a row
 * in `item_prices`; this is the one section 4 chose among them, written by
 * `EffectivePriceService.recompute` inside the transaction of the write that
 * made it necessary, and kept current by a sweep over `nextBoundaryAt`. Search
 * sorts by price at scale and cannot resolve six rows per product per query,
 * so the columns keep their names and their meaning as "the price a shopper
 * sees". Nothing writes a price here directly any more. `available` is the one
 * column still written by hand, because it is a fact about stock and not about
 * price.
 */
@Entity({ name: 'supermarket_items' })
@Index('uq_supermarket_item_scope', ['itemId', 'priceScopeId'], {
  unique: true,
})
export class SupermarketItem extends BaseEntity {
  @Column({ type: 'uuid' })
  itemId!: string;

  @ManyToOne(() => Item, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'itemId' })
  item!: Item;

  @Index('ix_supermarket_items_scope')
  @Column({ type: 'uuid' })
  priceScopeId!: string;

  @ManyToOne(() => PriceScope, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'priceScopeId' })
  priceScope!: PriceScope;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  price!: number | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  currency!: string | null;

  /**
   * The source's own normalized price per reference unit, **stored verbatim and
   * never recomputed** (section 2.4). `unit_price / unit_size` reproduces it for
   * 3,760 of 4,232 products and `unit_price / total_units` for 326 more, but 110
   * match neither and are inconsistent with their own stated size. Deriving would
   * disagree with the chain on one product in forty, in the field whose only
   * purpose is comparison.
   *
   * Four decimal places rather than two: a per capsule price is 0.13 and a per
   * 100 g price on a cheap staple rounds badly at two.
   */
  @Column({ type: 'numeric', precision: 12, scale: 4, nullable: true })
  unitPrice!: number | null;

  /**
   * The source's own label for that number. **Text, not `UnitOfMeasure`**: a
   * product labelled `100 ml` carries a per litre number, `100 g` carries a per
   * kilogram one, and `lv` means washing machine loads. It is a price tag for a
   * human and cannot be parsed into a unit without inventing a mapping the source
   * does not have.
   */
  @Column({ type: 'varchar', nullable: true })
  unitPriceLabel!: string | null;

  /** The effective row's `lastObservedAt`. Without it a price has no age. */
  @Column({ type: 'timestamptz', nullable: true })
  priceObservedAt!: Date | null;

  /**
   * The effective row's kind, or null when no row prices this key at all,
   * which is a row that only says whether the scope carries the product.
   */
  @Column({
    type: 'enum',
    enum: PriceSourceKind,
    enumName: 'price_source_kind',
    nullable: true,
  })
  priceSourceKind!: PriceSourceKind | null;

  /**
   * Whether the scope carries this product at all. Scope wide rather than per
   * store, and this is the one deliberate deviation from backlog 0001 section
   * 2.2: Mercadona's availability signal is a 404 on a warehouse scoped detail
   * call, so an automated source can only ever populate it at this level.
   */
  @Column({ type: 'boolean', default: true })
  available!: boolean;

  /** The `item_prices` row section 4 chose. Null when there is no row at all. */
  @Column({ type: 'uuid', nullable: true })
  itemPriceId!: string | null;

  /**
   * Nothing eligible priced this key, so the newest row of any kind is shown
   * and flagged (plan 0080, section 5). A number with a date beats a blank.
   */
  @Column({ type: 'boolean', default: false })
  stale!: boolean;

  /** The effective row's window end, so a client can say "until Sunday". */
  @Column({ type: 'timestamptz', nullable: true })
  validUntil!: Date | null;

  /**
   * The earliest instant at which the answer changes with no write: a
   * `validFrom` still ahead, a `validUntil` not yet reached, an `ADMIN` row's
   * `protectedUntil`, or `lastObservedAt + maxAgeDays` for a kind with a max
   * age. The sweep recomputes rows whose boundary is in the past. Null for the
   * great majority of rows, which a partial index leaves unscanned.
   */
  @Column({ type: 'timestamptz', nullable: true })
  nextBoundaryAt!: Date | null;
}
