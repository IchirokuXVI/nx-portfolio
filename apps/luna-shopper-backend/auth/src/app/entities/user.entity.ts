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

  /**
   * The global username (plan 0018). Never null: it is generated from the request
   * locale's word pool the moment the identity is created, so a guest is never
   * nameless. Deliberately NOT unique: two users may share a name, and the index
   * exists only so the back office can search by it.
   *
   * `displayName` is not reused for this. It holds whatever the identity provider
   * supplied, which for a Google sign in is the person's real full name; seeding a
   * public, cross zone handle from it would publish a name the user never chose
   * to publish.
   */
  @Index('ix_users_username')
  @Column({ type: 'varchar' })
  username!: string;
}
