import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

/** Which path recorded an acceptance (plan 0231, section 4.1). */
export enum TermsAcceptanceVia {
  REGISTER = 'REGISTER',
  UPGRADE = 'UPGRADE',
  GOOGLE = 'GOOGLE',
  GUEST = 'GUEST',
  PROMPT = 'PROMPT',
}

/**
 * One account accepted one version of the Terms (plan 0231, section 4.1).
 *
 * A history rather than two columns on `users`, because the question somebody
 * asks later is "which version did this account accept, and when", for every
 * version and not only the last one. Unique on `(userId, version)`: accepting
 * the same version twice is one fact. `userId` cascades, so an account delete
 * takes its rows (plan 0232).
 *
 * Not a {@link BaseEntity}: a row is written once and never updated, so it has
 * no `updatedAt`, and `acceptedAt` is its creation time under the name the
 * question uses.
 */
@Entity({ name: 'terms_acceptances' })
@Index('uq_terms_acceptance_user_version', ['userId', 'version'], {
  unique: true,
})
export class TermsAcceptance {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  /** The effective version of section 1, exactly as it was current. */
  @Column({ type: 'varchar' })
  version!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  acceptedAt!: Date;

  @Column({
    type: 'enum',
    enum: TermsAcceptanceVia,
    enumName: 'terms_acceptance_via',
  })
  via!: TermsAcceptanceVia;
}
