import { ZoneStatus } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * A zone: a shared space (plan 0006, section 1). `ownerUserId` is nullable
 * because a zone may temporarily have no owner (it goes MARKED_FOR_DELETION until
 * an admin claims it, plan 0006 section 5). `config` is a typed jsonb bag for
 * future flags; empty for now. `joinCode` is unique and regenerable.
 */
@Entity({ name: 'zones' })
export class Zone extends BaseEntity {
  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'jsonb', default: {} })
  config!: Record<string, unknown>;

  @Index('uq_zones_join_code', { unique: true })
  @Column({ type: 'varchar' })
  joinCode!: string;

  @Column({ type: 'enum', enum: ZoneStatus, default: ZoneStatus.ACTIVE })
  status!: ZoneStatus;

  @Column({ type: 'uuid', nullable: true })
  ownerUserId!: string | null;

  /**
   * When the zone was marked for deletion (plan 0011). Set together with
   * `status = MARKED_FOR_DELETION` when its owner is deleted; the zone reaper
   * removes zones whose marker is older than the grace period. Cleared when an
   * admin claims ownership and the zone returns to ACTIVE.
   */
  @Column({ type: 'timestamptz', nullable: true })
  markedForDeletionAt!: Date | null;
}
