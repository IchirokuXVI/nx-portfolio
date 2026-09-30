import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * One product on one leaf (plan 0166, section 2): a row of `item_categories`.
 *
 * A product has one or more of these, and `position` is the order they were
 * written in, from 0. It decides which category a row shows when it has room
 * for one and the order the categories are listed in; grouping a basket by
 * category draws the product under every one of them.
 *
 * Keyed on the pair, with the position unique per product, so one product
 * cannot hold a leaf twice or two leaves in one place. Deleting the product
 * deletes its rows; deleting a leaf that holds products is refused by the
 * foreign key (rule R4), and a row naming a root is refused by a trigger (rule
 * R2).
 *
 * Written only through `CategoryService.setItemCategories`, which replaces a
 * product's whole set at once.
 */
@Entity({ name: 'item_categories' })
export class CategoryMember {
  @PrimaryColumn({ type: 'uuid' })
  itemId!: string;

  @PrimaryColumn({ type: 'uuid' })
  categoryId!: string;

  @Column({ type: 'smallint' })
  position!: number;
}
