import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ShoppingProfile } from './shopping-profile.entity';

/**
 * One shop this profile does, or does not, go to (plan 0064, section 1).
 *
 * The finer axis beside {@link ProfileSupermarketPreference}, which names the
 * chain. The two are not redundant and section 2 is why: excluding the four DIA
 * shops on the screen says nothing about the DIA that opens next month, and
 * excluding the chain says nothing about which of today's shops has parking.
 * Both are things people mean.
 *
 * **A blacklist**, for the same reason as its sibling: absence means included,
 * so a shop imported next week is one the user can see rather than one silently
 * missing from a list they would have to maintain. That is the failure a person
 * can actually detect.
 *
 * **A row under an excluded chain is inert, not deleted** (section 2.1). The
 * chain hides every one of its shops whatever these rows say, and keeping them
 * is what lets un excluding the chain restore exactly the selection the user
 * last had.
 *
 * `supermarketLocationId` is an opaque catalog reference and has no foreign key,
 * exactly as `supermarketId` is on the chain preference: catalog is a separate
 * service with its own database (plan 0012, section 4).
 */
@Entity({ name: 'profile_location_preferences' })
@Index('uq_profile_location', ['profileId', 'supermarketLocationId'], {
  unique: true,
})
export class ProfileLocationPreference extends BaseEntity {
  @Column({ type: 'uuid' })
  profileId!: string;

  @ManyToOne(() => ShoppingProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profileId' })
  profile!: ShoppingProfile;

  @Column({ type: 'uuid' })
  supermarketLocationId!: string;

  @Column({ type: 'boolean', default: false })
  excluded!: boolean;
}
