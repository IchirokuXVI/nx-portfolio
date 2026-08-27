import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';

/**
 * An outstanding OAuth `state` (plan 0023, section 4.1).
 *
 * The state parameter is the one value that survives the round trip to Google by
 * design, and this is what sits behind it: an opaque random token whose hash is
 * stored here, next to the payload it stands for. The alternative, a value the
 * gateway signs and reads back, was rejected because the gateway holds only
 * auth's public key, and because a stateless token cannot be single use, which is
 * the property that matters most here: a replayed state is how an attacker links
 * their Google identity onto somebody else's account.
 *
 * `userId` is nullable, and its two states are the point of the table. Set, the
 * callback links Google onto that user and upgrades it in place; null, it is a
 * sign in from scratch. What must never happen is a state meant to carry a user
 * arriving without one, which is why it is consumed exactly once (`consumedAt`)
 * and lives minutes rather than hours (`expiresAt`).
 *
 * Shaped like `EmailVerification` and `PasswordReset`, cascade included, so
 * deleting a user still takes every outstanding grant with it (plan 0011).
 */
@Entity({ name: 'oauth_states' })
export class OAuthState extends BaseEntity {
  /** The caller to link onto, or null for a sign in from scratch. */
  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'userId' })
  user!: User | null;

  /**
   * The locale the flow started in, so the callback sends the browser back to the
   * page the user left rather than to the default language.
   */
  @Column({ type: 'varchar', nullable: true })
  locale!: string | null;

  @Index('uq_oauth_state_token', { unique: true })
  @Column({ type: 'varchar' })
  tokenHash!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;
}
