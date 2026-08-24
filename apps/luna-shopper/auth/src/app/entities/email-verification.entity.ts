import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';

/**
 * An outstanding email confirmation (plan 0005, section 2 and 4.2). Only the
 * hash of the token is stored, so a database read never yields a usable link. It
 * is consumed once (`consumedAt`) and expires (`expiresAt`); verification is a
 * trust signal, not a login gate.
 */
@Entity({ name: 'email_verifications' })
export class EmailVerification extends BaseEntity {
  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Index('uq_email_verification_token', { unique: true })
  @Column({ type: 'varchar' })
  tokenHash!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;
}
