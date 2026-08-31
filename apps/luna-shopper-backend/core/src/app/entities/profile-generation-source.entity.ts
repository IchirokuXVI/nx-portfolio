import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ShoppingProfile } from './shopping-profile.entity';

/**
 * A zone, or one list inside it, that feeds a generated basket (plan 0049,
 * section 1). Only meaningful while the profile's `generationScope` is
 * `SELECTED`; the rows are kept rather than deleted when it goes back to `ALL`,
 * so turning the switch off and on again does not lose the selection.
 *
 * `listId` null means the whole zone, which is what makes uniqueness two indexes
 * rather than one: Postgres treats nulls as distinct in a unique index, so
 * `(profile, zone, null)` could be inserted twice under a plain
 * `UNIQUE (profileId, zoneId, listId)`. The migration writes a partial unique
 * index for each case, and the pair is what the plan's constraint actually means.
 *
 * Both ids are core's own, but neither carries a foreign key: a zone or a list
 * can be deleted underneath a profile, and a stale source is dropped when a
 * generation run cannot read it rather than blocking the delete. Plan 0050 is
 * where that reading happens.
 */
@Entity({ name: 'profile_generation_sources' })
@Index('uq_profile_generation_source_list', ['profileId', 'zoneId', 'listId'], {
  unique: true,
  where: '"listId" IS NOT NULL',
})
@Index('uq_profile_generation_source_zone', ['profileId', 'zoneId'], {
  unique: true,
  where: '"listId" IS NULL',
})
export class ProfileGenerationSource extends BaseEntity {
  @Column({ type: 'uuid' })
  profileId!: string;

  @ManyToOne(() => ShoppingProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profileId' })
  profile!: ShoppingProfile;

  @Column({ type: 'uuid' })
  zoneId!: string;

  /** Null means the whole zone rather than one list within it. */
  @Column({ type: 'uuid', nullable: true })
  listId!: string | null;
}
