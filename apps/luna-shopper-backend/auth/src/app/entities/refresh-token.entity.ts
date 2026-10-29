import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ImpersonationSession } from './impersonation-session.entity';
import { User } from './user.entity';

/**
 * A rotating refresh token record (plan 0005, section 3). The opaque token is
 * stored only as a hash; presenting it exchanges for a fresh access token and
 * rotates the refresh token (the old record is revoked). A ban or logout is
 * enforced the next time a refresh is attempted (plan 0004, section 10).
 */
@Entity({ name: 'refresh_tokens' })
export class RefreshToken extends BaseEntity {
  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Index('uq_refresh_token', { unique: true })
  @Column({ type: 'varchar' })
  tokenHash!: string;

  /** The retention sweep reads by it (plan 0233). */
  @Index('ix_refresh_tokens_expires_at')
  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  /**
   * The support session this row belongs to (plan 0194), or null for the row
   * of an ordinary session, which is every row a person holds. A rotation
   * reads it, so the next pair is cut to the deadline of the same session.
   */
  @Column({ type: 'uuid', nullable: true })
  impersonationSessionId!: string | null;

  @ManyToOne(() => ImpersonationSession, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'impersonationSessionId' })
  impersonationSession!: ImpersonationSession | null;

  /**
   * The row that the rotation of this row issued (plan 0229). Null on a live
   * row, and on a row that a password reset or the end of a support session
   * revoked. Only a row with a successor can take the reuse grace, so a row
   * that those revoked stays dead.
   *
   * After a reissue inside the grace it names the newest successor, and the
   * successor that it replaced is revoked with none of its own.
   *
   * Indexed for the `ON DELETE SET NULL` below: the retention sweep deletes
   * tokens in bulk, and each delete looks up the rows that name it (plan
   * 0233, section 5).
   */
  @Index('ix_refresh_tokens_replaced_by', {
    where: '"replacedById" IS NOT NULL',
  })
  @Column({ type: 'uuid', nullable: true })
  replacedById!: string | null;

  @ManyToOne(() => RefreshToken, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'replacedById' })
  replacedBy!: RefreshToken | null;

  /**
   * When the rotation that wrote {@link replacedById} finished, on the wall
   * clock of the database (plan 0229). The same statement writes both. The
   * `in_flight` rule reads it, and not `updatedAt`, which TypeORM rewrites on
   * every update of the row.
   */
  @Column({ type: 'timestamptz', nullable: true })
  replacedAt!: Date | null;
}
