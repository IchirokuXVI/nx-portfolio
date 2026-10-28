import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';

/**
 * A Google sign in staged at the callback and not yet redeemed (plan 0230,
 * section 3.1).
 *
 * The callback used to create or link the account itself, on the strength of a
 * state that nothing tied to the browser that minted it. A link to the start
 * route sent to somebody else then landed their Google identity on the
 * sender's guest. Now the callback writes this row and nothing else, and the
 * account changes only when the app trades the code with a verifier that hashes
 * to `codeChallenge`. A browser that did not mint the state has no verifier, so
 * a profile staged through a forwarded link expires unused.
 *
 * Shaped like the other grants, cascade included, so deleting a user takes a
 * handoff that names it as the link target.
 */
@Entity({ name: 'oauth_handoffs' })
export class OAuthHandoff extends BaseEntity {
  /** The link target copied from the state, or null for a sign in from scratch. */
  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'userId' })
  user!: User | null;

  /** What Google said. */
  @Column({ type: 'varchar' })
  providerUserId!: string;

  @Column({ type: 'varchar', nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', nullable: true })
  displayName!: string | null;

  /** Copied from the state. The exchange compares the verifier against it. */
  @Column({ type: 'varchar' })
  codeChallenge!: string;

  /** Copied from the state. */
  @Column({ type: 'varchar', nullable: true })
  locale!: string | null;

  /**
   * Copied from the state (plan 0231, section 4.2). The exchange records it
   * when it is still the current version, and records nothing otherwise.
   */
  @Column({ type: 'varchar', nullable: true })
  termsVersion!: string | null;

  @Index('uq_oauth_handoff_token', { unique: true })
  @Column({ type: 'varchar' })
  tokenHash!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;
}
