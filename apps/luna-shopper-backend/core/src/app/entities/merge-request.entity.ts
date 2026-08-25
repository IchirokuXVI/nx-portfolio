import { MergeRequestStatus } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Zone } from './zone.entity';

/**
 * An owner approved, single zone account merge (plan 0008, section 2). Data is
 * taken FROM `sourceUserId` and moved INTO `targetUserId`; on approval the source
 * membership is kicked from the zone. Both users are opaque ids and must hold a
 * membership in `zoneId` for the request to be valid. The accounts themselves are
 * never deleted and other zones are untouched.
 */
@Entity({ name: 'merge_requests' })
export class MergeRequest extends BaseEntity {
  @Index('ix_merge_requests_zone')
  @Column({ type: 'uuid' })
  zoneId!: string;

  @ManyToOne(() => Zone, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'zoneId' })
  zone!: Zone;

  @Column({ type: 'uuid' })
  sourceUserId!: string;

  @Column({ type: 'uuid' })
  targetUserId!: string;

  @Column({ type: 'uuid' })
  requestedByUserId!: string;

  @Column({
    type: 'enum',
    enum: MergeRequestStatus,
    default: MergeRequestStatus.PENDING,
  })
  status!: MergeRequestStatus;

  @Column({ type: 'uuid', nullable: true })
  resolvedByUserId!: string | null;
}
