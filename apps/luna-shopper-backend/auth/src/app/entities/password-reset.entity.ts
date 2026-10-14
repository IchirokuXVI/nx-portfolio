import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';

/**
 * How a reset grant reached the person (plan 0210, target state 1).
 *
 * Internal to auth: no client reads it, and the audit trail records it as a
 * column of the row.
 */
export enum PasswordResetChannel {
  /** The person asked for it on the "Forgot password" page. */
  SELF_SERVICE = 'SELF_SERVICE',
  /** An operator had it mailed to the address of the account. */
  OPERATOR_EMAIL = 'OPERATOR_EMAIL',
  /** An operator received the two links to share by hand. */
  OPERATOR_LINK = 'OPERATOR_LINK',
}

/** How a reset grant ended (plan 0210, target state 1). */
export enum PasswordResetSpentAs {
  /** The reset link chose a new password. */
  RESET = 'RESET',
  /** The sign in link opened a session and kept the password. */
  SIGN_IN = 'SIGN_IN',
  /**
   * The sign in link was opened by the owner of the grant, already signed in.
   * Nothing was issued, and the grant ended so that it is not left as a key.
   */
  ALREADY_SIGNED_IN = 'ALREADY_SIGNED_IN',
  /** Another grant of the same account was spent first (target state 3). */
  SUPERSEDED = 'SUPERSEDED',
}

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
 *
 * **One grant, two links** (plan 0210). The mail carries a reset link and a
 * sign in link built from the one token, and spending either ends the grant.
 * The row never records which link was sent, because both always are: the
 * mode is the choice of whoever holds the token. It records how the grant was
 * made (`channel`) and how it ended (`spentAs`), which is what an operator
 * reading the trail of an account needs to know.
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

  /** Who made the grant, and how it reached the person (plan 0210). */
  @Column({ type: 'varchar', default: PasswordResetChannel.SELF_SERVICE })
  channel!: PasswordResetChannel;

  /**
   * The operator behind an `OPERATOR_*` grant: an `admin_users.id`. Null for
   * the self service one. No foreign key, as `auth_audit.actorId` has none:
   * the row must outlive the admin it names.
   */
  @Column({ type: 'uuid', nullable: true })
  issuedByAdminId!: string | null;

  /**
   * How the grant ended. Written by the statement that sets `consumedAt`, so
   * the two never disagree. Null while the grant is live, and on every row
   * spent before plan 0210.
   */
  @Column({ type: 'varchar', nullable: true })
  spentAs!: PasswordResetSpentAs | null;
}
