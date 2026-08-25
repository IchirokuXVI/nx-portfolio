import { MembershipStatus, ZoneRole } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Zone } from './zone.entity';

/**
 * A user's membership in a zone (plan 0006, section 1). `username` is a per zone
 * display name required at join time and unique within the zone. A user has at
 * most one membership per zone. Authorization everywhere resolves this row for
 * the caller and checks `role`/`status` (section 6).
 */
@Entity({ name: 'zone_memberships' })
@Index('uq_membership_zone_user', ['zoneId', 'userId'], { unique: true })
@Index('uq_membership_zone_username', ['zoneId', 'username'], { unique: true })
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
