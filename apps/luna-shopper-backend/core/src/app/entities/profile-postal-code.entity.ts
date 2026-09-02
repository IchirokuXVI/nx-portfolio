import {
  DEFAULT_POSTAL_CODE_COUNTRY,
  ProfilePostalCodeSource,
} from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ShoppingProfile } from './shopping-profile.entity';

/**
 * One postal code a profile shops from (plan 0049, section 1.1).
 *
 * **The code is stored, never what it resolves to.** It is tempting to resolve
 * once at save time and keep the scope ids, and that is the wrong choice: the
 * mapping from a postal code to a price scope belongs to the chain and moves
 * without telling us, so a stored scope id silently becomes a lie. The
 * resolution happens per query, in catalog, beside the scopes.
 *
 * A code no chain serves is kept and flagged rather than refused (section 5):
 * coverage is a property of our data, not of the user's address.
 */
@Entity({ name: 'profile_postal_codes' })
@Index('uq_profile_postal_code', ['profileId', 'postalCode'], { unique: true })
export class ProfilePostalCode extends BaseEntity {
  @Column({ type: 'uuid' })
  profileId!: string;

  @ManyToOne(() => ShoppingProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profileId' })
  profile!: ShoppingProfile;

  @Column({ type: 'varchar', length: 16 })
  postalCode!: string;

  /** "home", "the office". Display only; nothing is derived from it. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  label!: string | null;

  @Column({ type: 'integer', default: 0 })
  position!: number;

  /**
   * The country the code is read against (plan 0062, section 1).
   *
   * It is here rather than assumed because the centroid table is keyed on
   * `(country, postalCode)`, and a lookup with no country searches every country
   * we ship at once. Only `es` exists today; the column is what keeps the day a
   * second one arrives a data change.
   */
  @Column({ type: 'varchar', length: 2, default: DEFAULT_POSTAL_CODE_COUNTRY })
  country!: string;

  /** Whose code this is: the user's, or one we concluded (plan 0062, section 1). */
  @Column({
    type: 'enum',
    enum: ProfilePostalCodeSource,
    enumName: 'profile_postal_code_source',
    default: ProfilePostalCodeSource.TYPED,
  })
  source!: ProfilePostalCodeSource;

  /**
   * Whether this code's neighbours were asked for. Meaningful on a `TYPED` or
   * `DEVICE` row only.
   *
   * It lives on the parent rather than being a one shot argument to the write,
   * because the derived set is recomputed from scratch on every change (section
   * 3) and therefore needs to know, later, which parents wanted expansion.
   */
  @Column({ type: 'boolean', default: false })
  expandNearby!: boolean;

  /**
   * A derived code the user removed (plan 0062, section 3.1).
   *
   * Meaningful on a `NEARBY` row only. Removing one is **not a delete**: the pure
   * recompute would put it straight back, and the user would remove it forever.
   * The row stays, this becomes true, and it disappears from every read.
   * Suppression is user input, so it belongs in the recompute's domain rather
   * than being erased by it; a suppressed row whose last justifying parent went
   * away is deleted like any other derived row, so nothing accumulates.
   */
  @Column({ type: 'boolean', default: false })
  suppressed!: boolean;
}
