import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A link to the photo a chain prints for a product (plan 0198): a row of
 * `item_linked_images`.
 *
 * **A link is an address on a chain's own host, and nothing else.** No server
 * of ours fetches it, and no copy of the photo is kept. It is not ours, so it
 * names the chain it came from, and `supermarkets.linkedImagesEnabled` of that
 * chain decides whether a shopper is given it. A link is saved whatever that
 * switch says, and also when the product has a photo of its own: the switch
 * decides what a client is given, never what is kept.
 *
 * **The key is the source row, not the product and the chain.** A source row
 * states one photo and is bound to one product. A product built from three
 * rows therefore holds three links, two of one chain among them (plan 0155),
 * and a row that is bound to another product moves its link, because the key
 * did not change. `sourceEntryId` is the harvester's row and is opaque here.
 *
 * Deleting the product or the chain deletes its links. Written only through
 * `ItemLinkedImageService`, which also keeps `items.linkedImages` current.
 * Like `item_eans`, it has no row in `catalog_audit`: the trail keys on the
 * rows a person changes, and the two switch writes are recorded there, on
 * `supermarkets`.
 *
 * **To stop every chain photo with no gateway**, run these two statements:
 *
 * ```sql
 * UPDATE supermarkets SET "linkedImagesEnabled" = false;
 * UPDATE items SET "linkedImages" = '[]'::jsonb WHERE "linkedImages" <> '[]'::jsonb;
 * ```
 */
@Entity({ name: 'item_linked_images' })
@Index('ix_item_linked_images_item', ['itemId'])
@Index('ix_item_linked_images_supermarket', ['supermarketId'])
export class ItemLinkedImage {
  @PrimaryColumn({ type: 'uuid' })
  sourceEntryId!: string;

  /** The product the source row is bound to. */
  @Column({ type: 'uuid' })
  itemId!: string;

  /** The chain the photo came from, which is the unit the switch works on. */
  @Column({ type: 'uuid' })
  supermarketId!: string;

  /** The address as the source printed it. `https` only, by a check constraint. */
  @Column({ type: 'varchar', length: 500 })
  url!: string;

  /**
   * When the row was first linked to this product, which is what orders the
   * photos of a product. A link that moves to another product starts again.
   */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  firstLinkedAt!: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastSeenAt!: Date;

  /** The run that last stated it, or null for one a decision sent. */
  @Column({ type: 'uuid', nullable: true })
  runId!: string | null;
}
