import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * A platform operator (plan 0071, section 2).
 *
 * In auth's database, beside `users`, and referencing nothing in it. That
 * separation is the whole design and section 1 argues it at length; the short
 * version is that every user facing path in this service operates on `users` —
 * registration, the temporary to registered upgrade, password reset, Google
 * linking, account deletion, username propagation, and the orphan reaper, which
 * **deletes** users that own no zone and join nothing, which is exactly the shape
 * of an admin account. A separate table means none of that code can reach an
 * admin credential by construction rather than by everybody remembering.
 *
 * There is no email, no verification, no reset token and no OAuth identity. An
 * admin who forgets their password is handled on the server by the commands in
 * section 6. Every recovery channel is also an attack channel, and this table has
 * one user.
 */
@Entity({ name: 'admin_users' })
export class AdminUser extends BaseEntity {
  /**
   * The login identifier, and **unique**, unlike `users.username`. Plan 0018
   * decided deliberately that two users may share a name; login by name needs the
   * opposite, and here it is simply true rather than a partial index arguing with
   * a decision recorded two plans ago.
   */
  @Index('uq_admin_users_username', { unique: true })
  @Column({ type: 'varchar' })
  username!: string;

  /** argon2, via the shared `PasswordService`. Never leaves this service. */
  @Column({ type: 'varchar' })
  passwordHash!: string;

  /** So the audit trail renders something human beside the uuid. */
  @Column({ type: 'varchar', nullable: true })
  displayName!: string | null;

  /**
   * Set, and login refuses. The only way to revoke access without deleting the
   * row, which matters because the id is the actor on every audit entry the
   * account ever wrote.
   */
  @Column({ type: 'timestamptz', nullable: true })
  disabledAt!: Date | null;

  /** Written on every successful login. Answers "is this account still used". */
  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;
}
