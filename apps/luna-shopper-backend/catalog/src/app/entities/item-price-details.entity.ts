import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { ItemPrice } from './item-price.entity';

/**
 * What a leaflet printed beside one price (plan 0081, section 6.4).
 *
 * **Not columns on {@link ItemPrice}, and that is the whole design decision.**
 * `item_prices` is read on every recompute of the effective price, and a jsonb
 * blob on every row is weight the hot path would pay for nothing. One row here
 * per leaflet price row, keyed by the price it belongs to, cascading with it.
 *
 * `promotion` and `loyalty` are the extractor's objects **verbatim**. The
 * importer reads `promotion.type` once, to decide which number on the tile is
 * the price a shopper pays (section 6.2), and after that nothing reads either
 * except the admin's price history (plan 0080, section 10).
 *
 * `itemPriceId` is the primary key rather than a `BaseEntity` id: there is
 * exactly one detail row per price row, and giving it a second identity would
 * invite a second one.
 */
@Entity({ name: 'item_price_details' })
export class ItemPriceDetailsRow {
  @PrimaryColumn({ type: 'uuid' })
  itemPriceId!: string;

  @OneToOne(() => ItemPrice, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'itemPriceId' })
  itemPrice!: ItemPrice;

  /** The leaflet tile id, so a row can be found in the run's stored document. */
  @Column({ type: 'varchar', nullable: true })
  offerId!: string | null;

  @Column({ type: 'integer', nullable: true })
  page!: number | null;

  /** Every text fragment the extractor assigned to the tile, in reading order. */
  @Column({ type: 'jsonb', nullable: true })
  rawText!: string[] | null;

  /** The promotion object as printed. Stored, and read by no resolver. */
  @Column({ type: 'jsonb', nullable: true })
  promotion!: Record<string, unknown> | null;

  /** The loyalty object as printed. A gated offer never gets this far. */
  @Column({ type: 'jsonb', nullable: true })
  loyalty!: Record<string, unknown> | null;
}
