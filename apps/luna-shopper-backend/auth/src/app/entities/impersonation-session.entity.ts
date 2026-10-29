import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';

/**
 * A support session: one operator, in the app as one user (plan 0194).
 *
 * The row is the one deadline that every token of the session is cut to. A
 * longer access token cannot be stopped, and a refresh row with a short life is
 * renewed by the next rotation, so neither can hold a limit. This row can:
 * `expiresAt` is written by the insert and by nothing after it (`update:
 * false` below, and `impersonation-deadline.spec.ts` reads this directory for a
 * second writer).
 *
 * `createdAt` is when the session started. `updatedAt` moves two times at
 * most: as the code is consumed, and as the session ends.
 */
@Entity({ name: 'impersonation_sessions' })
// The start reads the live sessions of one operator and one user, to end them.
@Index('ix_impersonation_sessions_pair', ['adminId', 'userId'])
export class ImpersonationSession extends BaseEntity {
  /**
   * An `admin_users.id`. No foreign key, for the reason `auth_audit.actorId`
   * has none: the row says who opened the session, and that fact must outlive
   * the admin row it names.
   */
  @Column({ type: 'uuid' })
  adminId!: string;

  @Index('ix_impersonation_sessions_user')
  @Column({ type: 'uuid' })
  userId!: string;

  /** Deleting the account takes its support sessions with it (plan 0011). */
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  /** A value of `ImpersonationReason` in the contracts. */
  @Column({ type: 'varchar' })
  reason!: string;

  /** Present for `OTHER`, and null for every other reason. */
  @Column({ type: 'text', nullable: true })
  reasonNote!: string | null;

  /**
   * Creation time plus `IMPERSONATION_MAX_MS`. **Never written again.**
   * `update: false` makes TypeORM leave the column out of every `UPDATE` it
   * builds, so a `save` of a loaded row cannot move the deadline. The
   * retention sweep reads by it (plan 0233).
   */
  @Index('ix_impersonation_sessions_expires_at')
  @Column({ type: 'timestamptz', update: false })
  expiresAt!: Date;

  /** Set one time: by the end route, by a newer session, or by a refusal. */
  @Column({ type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  /**
   * SHA-256 of the handoff code. The audit trail leaves this column out, as it
   * leaves `tokenHash` out.
   */
  @Index('uq_impersonation_sessions_code', { unique: true })
  @Column({ type: 'varchar' })
  codeHash!: string;

  /** Creation time plus sixty seconds. */
  @Column({ type: 'timestamptz' })
  codeExpiresAt!: Date;

  /** Set by the exchange, in the statement that consumes the code. */
  @Column({ type: 'timestamptz', nullable: true })
  codeConsumedAt!: Date | null;
}
