import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';

/**
 * An outstanding nonce of a Google sign in from the Android app (plan 0238).
 *
 * The app mints one before it asks Credential Manager for a Google ID token,
 * and Google signs the nonce into the token. Spending it at the sign in is what
 * makes a token single use and ties it to the caller who asked for it: a nonce
 * the app made itself would stop nothing, because a stolen token carries
 * whatever nonce its app chose (decision D1). It is the `oauth_states` of this
 * flow, and shaped like every other grant, cascade included, so deleting a user
 * takes a nonce that names it.
 *
 * `userId` has the meaning it has on a state: set, an interactive sign in links
 * the Google identity onto that guest, and only that caller may spend it; null,
 * it is a sign in from scratch.
 */
@Entity({ name: 'oauth_nonces' })
export class OAuthNonce extends BaseEntity {
  /** The caller who minted it, or null for a sign in from scratch. */
  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'userId' })
  user!: User | null;

  /**
   * A silent nonce opens only an account this Google identity already opens
   * (decision D3). It creates, links and accepts nothing.
   */
  @Column({ type: 'boolean', default: false })
  silent!: boolean;

  /**
   * The Terms version the sign in page drew, checked at the mint and recorded
   * at the sign in (plan 0231, section 4.2). Always null on a silent nonce.
   */
  @Column({ type: 'varchar', nullable: true })
  termsVersion!: string | null;

  /** The locale the sign in started in. */
  @Column({ type: 'varchar', nullable: true })
  locale!: string | null;

  @Index('uq_oauth_nonce_token', { unique: true })
  @Column({ type: 'varchar' })
  tokenHash!: string;

  /** The retention sweep reads by it (plan 0233). */
  @Index('ix_oauth_nonces_expires_at')
  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;
}
