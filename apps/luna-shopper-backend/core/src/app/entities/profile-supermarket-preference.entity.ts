import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ShoppingProfile } from './shopping-profile.entity';

/**
 * A chain this profile does, or does not, shop (plan 0049, section 1.2).
 *
 * **It names the chain and never a location.** "No DIA" means no DIA anywhere,
 * and which stores a chain reaches is the resolver's business rather than the
 * user's. There is deliberately no per location preference anywhere in this
 * plan, including on the page that edits it.
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
