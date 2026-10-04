import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/**
 * One barcode of one product (plan 0185): a row of `item_eans`.
 *
 * A maker prints a new barcode when it changes a factory, a supplier or a
 * label, and the product on the shelf is the same. So a product has one or
 * more of these, and a barcode names one product: `ean` is the primary key.
 *
 * `items.ean` is the product's first barcode and is always one of these rows,
 * with two exceptions that are both old data: an in-store code and an invalid
 * code (plan 0184) stay on `items.ean` and are never a row here.
 *
 * Deleting the product deletes its rows. Written only through `ItemEanStore`.
 */
@Entity({ name: 'item_eans' })
@Index('ix_item_eans_item', ['itemId', 'createdAt'])
export class ItemEan {
  @PrimaryColumn({ type: 'varchar' })
  ean!: string;

  @Column({ type: 'uuid' })
  itemId!: string;

  /** The order a product's barcodes are listed in, after the first. */
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
