import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * A printed key that also names a brand (plan 0178).
 *
 * `brands.key` is unique, so one printed key names one brand. Some names belong
 * to two businesses all the same: El Jamón prints `Poseidón` on salmon loins,
 * which is Poseidon Food, and the registered `Poseidon` is a cologne. This row
 * says that the key `poseidon` names Poseidon Food **too**.
 *
 * **An extra pointer, not a second key.** The key's own brand stays the first
 * answer, `brands.key` is untouched, and no product moves when a row is written
 * here or removed: a homonym changes what a queued row may be created under,
 * and nothing about a product the catalog already holds.
 *
 * **Nothing creates a row but a person**, as with every brand. No migration, no
 * seed and no harvest run writes one.
 */
@Entity({ name: 'brand_homonyms' })
@Index('uq_brand_homonyms_key_brand', ['printedKey', 'brandId'], {
  unique: true,
})
export class BrandHomonym extends BaseEntity {
  /** `brandKey` of the printed name. Never the brand's own key. */
  @Column({ type: 'varchar', length: 120 })
  printedKey!: string;

  /**
   * The brand the printed key also names.
   *
   * A real foreign key, `ON DELETE CASCADE`: the only brand that can be deleted
   * is a spelling of another, and a pointer at a row that is gone says nothing.
   */
  @Index('ix_brand_homonyms_brand')
  @Column({ type: 'uuid' })
  brandId!: string;
}
