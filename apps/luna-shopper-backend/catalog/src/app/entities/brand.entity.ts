import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * A brand the owner registered (plan 0115, section 3.1).
 *
 * A brand used to be free text on every table, so `+Proteinas` sat as a brand on
 * 24 Mercadona products when it is a range of Hacendado, and nobody could list
 * the brands the catalog holds because there was no such list. This is the list.
 *
 * **The key follows the label.** It is `brandKey(label)`, never sent by a client
 * and never edited on its own: renaming `Hacenado` to `Hacendado` changes the
 * key to `hacendado`, and that is the only way a key ever changes.
 *
 * **Nothing creates a row but a person.** No migration, no seed and no harvest
 * run registers a brand. An unregistered brand is still accepted on an item,
 * because refusing it is the curator's decision and not the catalog's.
 *
 * There is no delete (section 9). The foreign key from `items.brandId` sets null
 * for the day one is added.
 */
@Entity({ name: 'brands' })
export class Brand extends BaseEntity {
  /** `brandKey(label)`. Unique, and how every spelling of one brand meets. */
  @Index('uq_brands_key', { unique: true })
  @Column({ type: 'varchar', length: 120 })
  key!: string;

  /** How the brand is written everywhere a person reads it. */
  @Column({ type: 'varchar', length: 120 })
  label!: string;

  /**
   * The chain that owns this private label, or null for an ordinary brand.
   *
   * A real foreign key, because `supermarkets` lives in this same database.
   * `ON DELETE SET NULL`: a chain going away does not take the brand with it.
   */
  @Column({ type: 'uuid', nullable: true })
  privateLabelSupermarketId!: string | null;
}
