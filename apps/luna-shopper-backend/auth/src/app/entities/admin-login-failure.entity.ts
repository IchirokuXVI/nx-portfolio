import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * One failed attempt to log in as an operator (plan 0071, section 7).
 *
 * Written on failure only, and **never** referencing `admin_users`: what it
 * records is the username that was *attempted*, which for the interesting rows is
 * a username that does not exist. A foreign key would discard exactly the
 * attempts worth keeping, and would leak the table's contents to anybody who
 * could observe which inserts succeed.
 *
 * It has no UI, on purpose rather than by omission. Showing failed logins belongs
 * to a dashboard that does not exist and is explicitly low priority, but the rows
 * cannot be written retroactively, so the table is created now and filled from
 * the first day. A dashboard added in six months with six months of history
 * behind it is worth having; one that starts empty is not.
 *
 * `createdAt` from `BaseEntity` is the attempt time; there is no second timestamp
 * column, and nothing ever updates a row.
 */
@Entity({ name: 'admin_login_failures' })
// The lockout query is "how many failures for this username since a moment", so
// the index carries both columns in that order.
@Index('ix_admin_login_failures_username_created', ['username', 'createdAt'])
export class AdminLoginFailure extends BaseEntity {
  /** Exactly what was typed, stored as given. Not normalized, not a foreign key. */
  @Column({ type: 'varchar' })
  username!: string;

  /** The caller's address as the gateway resolved it, or null when it could not. */
  @Column({ type: 'varchar', nullable: true })
  ip!: string | null;

  /** Untrusted, and never parsed. Length capped so a hostile header cannot bloat the table. */
  @Column({ type: 'varchar', length: 512, nullable: true })
  userAgent!: string | null;
}
