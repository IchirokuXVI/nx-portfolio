import { Column, Entity, JoinColumn, OneToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';

/**
 * Email + password credential (plan 0005, section 2). Only registered users that
 * chose email login have one; the password is stored as an argon2 hash, never in
 * the clear. One credential per user.
 */
@Entity({ name: 'credentials' })
export class Credential extends BaseEntity {
  @Column({ type: 'uuid', unique: true })
  userId!: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'varchar' })
  passwordHash!: string;
}
