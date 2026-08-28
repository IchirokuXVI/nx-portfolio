import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
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

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
}
