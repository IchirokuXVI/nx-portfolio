import { ParticipantKind } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { GeneratedList } from './generated-list.entity';

/**
 * A person acting on a shared basket (plan 0051, section 3).
 *
 * The other half of the split that makes the feature safe: **a link is an
 * invitation and a participant is an identity.** One link shared with three
 * people mints three rows here, so an edit made in the shop is attributed to a
 * person rather than to a URL.
 *
 * ## Every actor is a participant, including the owner
 *
 * The owner gets a row at generation time (section 3.2). It costs one insert and
 * it buys a single foreign key for every attribution field in the plan,
 * `lastEditedByParticipantId`, `createdByParticipantId`, `settledByParticipantId`
 * and presence, instead of a nullable pair of a user id and a participant id,
 * checked for exactly one being set, in five places.
 *
 * ## A typed name is readability, and the id is attribution
 *
 * Two guests can both type "Dani". `displayName` is unverified text on an
 * unauthenticated link and must never be treated as identity (section 3.5), so it
 * is what the screen shows and this row's id is what the record keeps. A guest
 * who skipped the prompt is shown as "Guest N" from `guestNumber`, which is
 * unique within the basket and stable for the life of the participant.
 */
@Entity({ name: 'generated_list_participants' })
@Index('ix_generated_list_participants_list', ['generatedListId', 'joinedAt'])
@Index('uq_generated_list_participants_user', ['generatedListId', 'userId'], {
  unique: true,
  where: '"userId" IS NOT NULL',
})
export class GeneratedListParticipant extends BaseEntity {
  @Column({ type: 'uuid' })
  generatedListId!: string;

  @ManyToOne(() => GeneratedList, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'generatedListId' })
  generatedList!: GeneratedList;

  /**
   * The link this person arrived by, or null for the owner, who arrived by
   * owning the basket.
   *
   * No foreign key action beyond the default: a revoked link is kept precisely so
   * this column keeps pointing at something, and the cascade in section 3.4 walks
   * it to revoke every participant one link minted.
   */
  @Index('ix_generated_list_participants_link')
  @Column({ type: 'uuid', nullable: true })
  shareLinkId!: string | null;

  @Column({ type: 'enum', enum: ParticipantKind })
  kind!: ParticipantKind;

  /**
   * Set for `OWNER` and `REGISTERED`, null for a `GUEST`.
   *
   * The partial unique index over (`generatedListId`, `userId`) is what makes a
   * second link a registered user opens resolve to the same row (section 4,
   * step 3) rather than minting a duplicate identity for the same person.
   */
  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  /** What a guest typed, and null when they skipped the prompt. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  displayName!: string | null;

  /** Monotonic per basket, so "Guest 2" means the same person all trip. */
  @Column({ type: 'int', nullable: true })
  guestNumber!: number | null;

  /**
   * A guest's credential, stored hashed because that is what it is (section 3.1).
   *
   * Null for `OWNER` and `REGISTERED`, who have an account token already: a
   * participant who can prove who they are by other means does not get a
   * password. Uniquely indexed because authorizing a guest request is **one
   * indexed lookup** on this column, reading `revokedAt` on the row it finds,
   * with no cache, because revocation has to bite immediately (section 3.3).
   */
  @Index('uq_generated_list_participants_secret', {
    unique: true,
    where: '"sessionSecretHash" IS NOT NULL',
  })
  @Column({ type: 'varchar', length: 64, nullable: true })
  sessionSecretHash!: string | null;

  /**
   * Captured at join, and **not presence data** (section 7): it is shown on tap,
   * to participants who pass section 5.2 only. Guests do not get to inspect each
   * other.
   */
  @Column({ type: 'varchar', length: 400, nullable: true })
  userAgent!: string | null;

  @Column({ type: 'timestamptz' })
  joinedAt!: Date;

  @Column({ type: 'timestamptz' })
  lastSeenAt!: Date;

  /**
   * Set by any of section 3.4's three gestures: revoking this one participant,
   * or the cascade from revoking the link they arrived by.
   *
   * Read on every participant authenticated request, which is why it lives here
   * rather than being derived from the link: the link's state is never consulted
   * on the hot path, so a link revoked without the cascade leaves every existing
   * participant working, which is the common case the plan is emphatic about.
   */
  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
}
