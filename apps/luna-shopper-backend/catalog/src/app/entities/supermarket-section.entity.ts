import type { LocalizedText } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, PrimaryColumn } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * One aisle as a chain names it (plan 0167, section 1): a row of
 * `supermarket_sections`.
 *
 * A section belongs to one chain and never moves to another. Its `position` is
 * the chain's default order, which a shop with a list of its own overrides.
 * The slug is unique within the chain and written once, on create.
 *
 * Written only through `SectionService`.
 */
@Entity({ name: 'supermarket_sections' })
export class SupermarketSection extends BaseEntity {
  @Column({ type: 'uuid' })
  supermarketId!: string;

  /** Ascii kebab case, unique within the chain, and never renamed. */
  @Column({ type: 'varchar', length: 80 })
  slug!: string;

  @Column({ type: 'jsonb' })
  name!: LocalizedText;

  /** The chain's default order, from 0. A new section appends. */
  @Column({ type: 'int' })
  position!: number;
}

/**
 * One category a section covers (plan 0167, section 1): a root, meaning all of
 * its children, or a leaf, meaning that leaf alone. The rule of section 3
 * expands a root on read.
 *
 * Deleting the section deletes its rows; deleting a category a section covers
 * is refused by the foreign key (plan 0166, rule R4).
 */
@Entity({ name: 'section_categories' })
export class SectionCategory {
  @PrimaryColumn({ type: 'uuid' })
  sectionId!: string;

  @PrimaryColumn({ type: 'uuid' })
  categoryId!: string;
}

/**
 * One of its chain's sections a shop has, at its place in the shop's order
 * (plan 0167, section 1). A shop with no rows inherits every section of its
 * chain in the chain's order. A trigger refuses a section of another chain.
 */
@Entity({ name: 'location_sections' })
export class LocationSection {
  @PrimaryColumn({ type: 'uuid' })
  supermarketLocationId!: string;

  @PrimaryColumn({ type: 'uuid' })
  sectionId!: string;

  /** This shop's order, from 0 and unique per shop. */
  @Column({ type: 'int' })
  position!: number;
}

/**
 * The pin (plan 0167, section 2): in one chain, a product is in this section.
 * A product's pins in a chain say it is in those sections and in no other. A
 * trigger refuses a section of another chain.
 */
@Entity({ name: 'supermarket_item_sections' })
export class SupermarketItemSection {
  @PrimaryColumn({ type: 'uuid' })
  supermarketId!: string;

  @PrimaryColumn({ type: 'uuid' })
  itemId!: string;

  @PrimaryColumn({ type: 'uuid' })
  sectionId!: string;
}
