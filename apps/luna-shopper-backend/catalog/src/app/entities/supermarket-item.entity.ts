import { PriceSourceKind } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Item } from './item.entity';
import { PriceScope } from './price-scope.entity';

/**
 * The price of one {@link Item} within one {@link PriceScope} (plan 0038, section
 * 5.2). It was keyed on the store until the scope arrived; re-keying it is what
 * stopped Mercadona writing twelve identical rows for one city.
 *
 * What is genuinely per store (where the product sits in the aisle, and whether
 * someone checked this specific shop) lives on
 * {@link SupermarketLocationItem} instead. A warehouse cannot answer either.
 *
 * **This is still not `ItemPrice`.** One price row per item per scope, one source
 * wins by overwriting, no history and no policy. What the provenance columns buy
 * is the ability to answer "where did this number come from and when", which is
 * the precondition for backlog 0001's multi source model rather than a piece of it.
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

  /** Without it a price has no age. */
  @Column({ type: 'timestamptz', nullable: true })
  priceObservedAt!: Date | null;

  /**
   * Where the number came from. It earns its place concretely: the first import
   * writes over rows a human may have typed in, and without this the import
   * cannot tell which rows are safe to overwrite. Section 6.5 is the rule.
   */
  @Column({
    type: 'enum',
    enum: PriceSourceKind,
    default: PriceSourceKind.ADMIN,
  })
  priceSourceKind!: PriceSourceKind;

  /**
   * Whether the scope carries this product at all. Scope wide rather than per
   * store, and this is the one deliberate deviation from backlog 0001 section
   * 2.2: Mercadona's availability signal is a 404 on a warehouse scoped detail
   * call, so an automated source can only ever populate it at this level.
   */
  @Column({ type: 'boolean', default: true })
  available!: boolean;
}
