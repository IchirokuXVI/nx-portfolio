import { MembershipStatus, ZoneRole } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Zone } from './zone.entity';

/**
 * A user's membership in a zone (plan 0006, section 1). A user has at most one
 * membership per zone. Authorization everywhere resolves this row for the caller
 * and checks `role`/`status` (section 6).
 *
 * `username` is the per zone display name, defaulted at join time from the user's
 * global username and free to diverge afterwards (plan 0018): a person can be
 * "Vela" everywhere and "Mamá" in the family zone. It is **not** unique within
 * the zone any more, so two members may share a name and the interface must show
 * a stable discriminator (role badge, join date, id prefix) wherever identity
 * carries weight. The index that remains is a plain lookup index.
 */
@Entity({ name: 'zone_memberships' })
@Index('uq_membership_zone_user', ['zoneId', 'userId'], { unique: true })
@Index('ix_membership_zone_username', ['zoneId', 'username'])
// The member and pending counts (plan 0017, section 4.3).
@Index('ix_memberships_zone_status', ['zoneId', 'status'])
// zone.countsMine and the listMine status filter (plan 0017, section 4.3).
@Index('ix_memberships_user_status', ['userId', 'status'])
export class ZoneMembership extends BaseEntity {
  @Column({ type: 'uuid' })
  zoneId!: string;

  @ManyToOne(() => Zone, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'zoneId' })
  zone!: Zone;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar' })
  username!: string;

  @Column({ type: 'enum', enum: ZoneRole, default: ZoneRole.MEMBER })
  role!: ZoneRole;

  @Column({
    type: 'enum',
    enum: MembershipStatus,
    default: MembershipStatus.PENDING,
  })
  status!: MembershipStatus;

  @Column({ type: 'uuid', nullable: true })
  approvedByUserId!: string | null;
}
