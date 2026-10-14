import type { LocalizedText } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, PrimaryColumn } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * One aisle of one shop (plan 0200, section 1): a row of `shop_sections`.
 *
 * A section belongs to one shop and never moves to another. A chain has no
 * sections, and a shop with no rows here has none. The slug is unique within
 * the shop and written once, on create.
 *
 * The four tables of plan 0167 (`supermarket_sections`, `section_categories`,
 * `location_sections`, `supermarket_item_sections`) still exist and have no
 * entity: nothing reads or writes them, and release task 0004 empties them.
 *
 * Written only through `SectionService`.
 */
@Entity({ name: 'shop_sections' })
export class ShopSection extends BaseEntity {
  @Column({ type: 'uuid' })
  supermarketLocationId!: string;

  /** Ascii kebab case, unique within the shop, and never renamed. */
  @Column({ type: 'varchar', length: 80 })
  slug!: string;

  @Column({ type: 'jsonb' })
  name!: LocalizedText;

  /**
   * Its place in the order of its shop, from 0 and unique within the shop.
   * A new section goes after the last one.
   */
  @Column({ type: 'int' })
  position!: number;
}

/**
 * One category a section covers (plan 0200, section 1): a root, meaning all of
 * its children, or a leaf, meaning that leaf alone. The read expands a root.
 *
 * Deleting the section deletes its rows; deleting a category a section covers
 * is refused by the foreign key (plan 0166, rule R4).
 */
@Entity({ name: 'shop_section_categories' })
export class ShopSectionCategory {
  @PrimaryColumn({ type: 'uuid' })
  sectionId!: string;

  @PrimaryColumn({ type: 'uuid' })
  categoryId!: string;
}
