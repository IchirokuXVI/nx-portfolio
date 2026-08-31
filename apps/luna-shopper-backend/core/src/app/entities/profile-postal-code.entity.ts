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
}
