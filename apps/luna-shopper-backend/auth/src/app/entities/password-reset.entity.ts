import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';

/**
 * An outstanding password reset (plan 0022, section 1). Shaped exactly like
 * `EmailVerification` and deliberately not stored with it: a confirmation link is
 * optional and lives a day, a reset link is a credential and lives an hour, and
 * spending one rewrites a password and destroys every live session while
 * spending the other stamps a date. A `purpose` column on one table would have
 * forced every query to filter before it could reason about age, which is exactly
 * the sort of thing the query that matters forgets to do.
 *
 * Only the hash of the token is stored, so a database read never yields a usable
 * link. It is consumed once (`consumedAt`) and expires (`expiresAt`).
 */
@Entity({ name: 'password_resets' })
export class PasswordReset extends BaseEntity {
  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Index('uq_password_reset_token', { unique: true })
  @Column({ type: 'varchar' })
  tokenHash!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;
}
