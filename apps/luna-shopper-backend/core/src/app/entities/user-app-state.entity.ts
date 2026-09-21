import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * What one account has been shown (plan 0145, section 1): the setup, and the
 * tour it offers.
 *
 * **Core owns it and auth does not.** Whether somebody has seen a walk through
 * of velista is not identity, and the moment it goes in auth the next three
 * product flags follow it there. Core already owns everything about how this
 * person shops.
 *
 * It keys off an opaque `userId` with **no foreign key**, exactly as
 * `ShoppingProfile` does: core holds no user table, and the account lives in
 * another service's database.
 *
 * ## Why this one does not extend `BaseEntity`
 *
 * Every other core table takes a generated uuid of its own from there. This one
 * is one row per account and nothing references it, so the account **is** the
 * key: a second `id` column would be a unique value nobody ever names, beside a
 * `userId` that would then need its own unique index to say what the primary
 * key already says. The two timestamp columns are copied from `BaseEntity`
 * unchanged, so the table reads like its siblings.
 *
 * ## Timestamps and not booleans
 *
 * The answer to "have they seen it" is yes or no, but the answer to "when" is
 * what makes a later question answerable: whether to offer the tour again after
 * a release that adds a screen is a decision nobody can take without knowing
 * how old the last one is. It costs nothing now to store the fact rather than
 * the conclusion.
 *
 * **The row is created on demand, by the write.** A missing row reads as two
 * nulls, which is what keeps `GET /v1/account/me` a read.
 */
// The name the plan gives it, singular, beside `core_audit` and `list_access`
// rather than beside the counted tables. One row per account is a state and not
// a collection of them.
@Entity({ name: 'user_app_state' })
export class UserAppState {
  @PrimaryColumn({ type: 'uuid' })
  userId!: string;

  /** When the setup was finished **or dismissed**. The two are one fact. */
  @Column({ type: 'timestamptz', nullable: true })
  setupCompletedAt!: Date | null;

  /** When the tour was finished or skipped. */
  @Column({ type: 'timestamptz', nullable: true })
  tourSeenAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
