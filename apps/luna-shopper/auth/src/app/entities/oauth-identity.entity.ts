import { AuthProvider } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';

/**
 * An external login linked to a user (plan 0005, section 2). A Google login
 * creates one `OAuthIdentity(GOOGLE, providerUserId)`; the unique
 * (`provider`, `providerUserId`) pair is what lets auth find the existing linked
 * user on the next login, or link onto a temporary user during an upgrade.
 * Email + password does not create one (section 4.2).
 */
@Entity({ name: 'oauth_identities' })
@Index('uq_oauth_provider_user', ['provider', 'providerUserId'], {
  unique: true,
})
export class OAuthIdentity extends BaseEntity {
  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'enum', enum: AuthProvider })
  provider!: AuthProvider;

  @Column({ type: 'varchar' })
  providerUserId!: string;
}
