import { UserKind } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * The identity (plan 0005, section 2). A `TEMPORARY` user is a throwaway zone
 * token holder with no email; a `REGISTERED` user has an email and/or a linked
 * provider. The in place upgrade (section 4.5) flips `kind` without changing
 * `id`, so nothing that references the user by id ever needs rewriting.
 */
@Entity({ name: 'users' })
export class User extends BaseEntity {
  @Column({ type: 'enum', enum: UserKind })
  kind!: UserKind;

  // Unique only when set: temporary users have no email, so a partial unique
  // index (in the migration) enforces uniqueness across the non-null emails.
  @Index('uq_users_email', { unique: true, where: 'email IS NOT NULL' })
  @Column({ type: 'varchar', nullable: true })
  email!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  emailVerifiedAt!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  displayName!: string | null;
}
