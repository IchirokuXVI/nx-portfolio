import {
  UnitOfMeasure,
  type LocalizedSynonyms,
  type LocalizedText,
} from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * "Milk" as a thing you can buy (plan 0048, section 1).
 *
 * A category is a browsing structure and this is not one: it is the statement
 * that every Pascual, Central Lechera and Hacendado milk is the same purchase,
 * and that comparing them happens in litres. Two deliberate omissions against the
 * backlog 0001 design it comes from:
 *
 * - **No `categoryId`.** The group referenced the category tree, and the tree is
 *   backlog 0001 section 3.1, not built here. Nothing in search or in the
 *   composer needs it.
 * - **No automatic assignment.** Membership is owner curation through the admin
 *   surface, like every other catalog write. The matching ladder that would let a
 *   harvest run classify what it finds is backlog 0001 section 6.2 and needs the
 *   review queue that comes with it.
 *
 * `search_es` and `search_en` are on the table but not on this class: they are
 * `tsvector` columns maintained entirely by the triggers the migration installs,
 * and mapping them would make every ordinary save rewrite a value the database
 * owns. The service reads them in raw SQL, which is the only thing that reads
 * them at all.
 */
@Entity({ name: 'product_groups' })
export class ProductGroup extends BaseEntity {
  @Column({ type: 'jsonb' })
  name!: LocalizedText;

  /** Stable and unique, so admin tooling and tests can name a group. */
  @Index('uq_product_groups_slug', { unique: true })
  @Column({ type: 'varchar' })
  slug!: string;

  /** The unit its members are compared in. */
  @Column({ type: 'enum', enum: UnitOfMeasure, default: UnitOfMeasure.UNIT })
  referenceUnit!: UnitOfMeasure;

  /**
   * Per locale alternative words. The reason the group is findable at all:
   * `leche` and `milk` have to reach the one Milk group, and neither is a
   * translation of the group's own name in the other language.
   */
  @Column({ type: 'jsonb', default: () => `'{"en":[],"es":[]}'::jsonb` })
  synonyms!: LocalizedSynonyms;
}
