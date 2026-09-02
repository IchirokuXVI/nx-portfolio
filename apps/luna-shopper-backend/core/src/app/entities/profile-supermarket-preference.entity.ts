import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ShoppingProfile } from './shopping-profile.entity';

/**
 * A chain this profile does, or does not, shop (plan 0049, section 1.2, as
 * superseded by plan 0064).
 *
 * **It names the chain, and it is the durable statement about a brand.** "No
 * DIA" means no DIA anywhere, including the DIA that opens down the road next
 * month, and it keeps being true with no maintenance. That is what distinguishes
 * it from {@link ProfileLocationPreference}, which is the specific statement
 * about one shop: the two axes exist together because "not that shop, the one
 * with no parking" and "not that brand" are different things to mean, and
 * collapsing them into one mechanism loses whichever was not chosen (plan 0064,
 * section 2).
 *
 * **This axis wins.** An excluded chain hides every one of its locations
 * whatever their own rows say, and those rows are left alone rather than
 * deleted, so un excluding the chain restores the selection the user last had
 * (plan 0064, section 2.1).
 *
 * `excluded` is why this is not simply an allowlist: "everything except DIA"
 * would otherwise force the user to enumerate every other chain, and a chain
 * added to the catalog next month would be silently missing from that list
 * instead of included by default.
 *
 * `supermarketId` is an opaque catalog reference and has no foreign key: catalog
 * is a separate service with its own database (plan 0012, section 4).
 */
@Entity({ name: 'profile_supermarket_preferences' })
@Index('uq_profile_supermarket', ['profileId', 'supermarketId'], {
  unique: true,
})
export class ProfileSupermarketPreference extends BaseEntity {
  @Column({ type: 'uuid' })
  profileId!: string;

  @ManyToOne(() => ShoppingProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profileId' })
  profile!: ShoppingProfile;

  @Column({ type: 'uuid' })
  supermarketId!: string;

  @Column({ type: 'boolean', default: false })
  excluded!: boolean;
}
