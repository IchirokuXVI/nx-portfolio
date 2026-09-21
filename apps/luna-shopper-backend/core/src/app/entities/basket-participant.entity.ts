import {
  ParticipantEndedReason,
  ParticipantKind,
} from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Basket } from './basket.entity';

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
@Entity({ name: 'basket_participants' })
@Index('ix_basket_participants_list', ['basketId', 'joinedAt'])
@Index('uq_basket_participants_user', ['basketId', 'userId'], {
  unique: true,
  where: '"userId" IS NOT NULL',
})
// One person's participant rows, live or ended (plan 0142, section 9).
//
// It carried `"revokedAt" IS NULL` until then, for the shared baskets read of
// plan 0114 section 8. The third route of a person's history needs an **ended**
// row too, because being removed from a basket afterwards does not unbuy the
// bread, and a partial index cannot find one. The wider index still serves plan
// 0114: that read filters the revoked ones out of one person's handful of rows.
@Index('ix_basket_participants_user', ['userId'], {
  where: '"userId" IS NOT NULL',
})
// The access sweep (plan 0140, section 7): the rows whose expiry has passed,
// oldest first.
@Index('ix_basket_participants_expiring', ['expiresAt'], {
  where: '"revokedAt" IS NULL AND "expiresAt" IS NOT NULL',
})
export class BasketParticipant extends BaseEntity {
  @Column({ type: 'uuid' })
  basketId!: string;

  @ManyToOne(() => Basket, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'basketId' })
  basket!: Basket;

  /**
   * The link this person arrived by, or null for the owner, who arrived by
   * owning the basket.
   *
   * No foreign key action beyond the default: a revoked link is kept precisely so
   * this column keeps pointing at something, and the cascade in section 3.4 walks
   * it to revoke every participant one link minted.
   */
  @Index('ix_basket_participants_link')
  @Column({ type: 'uuid', nullable: true })
  shareLinkId!: string | null;

  @Column({ type: 'enum', enum: ParticipantKind })
  kind!: ParticipantKind;

  /**
   * Set for `OWNER` and `REGISTERED`, null for a `GUEST`.
   *
   * The partial unique index over (`basketId`, `userId`) is what makes a
   * second link a registered user opens resolve to the same row (section 4,
   * step 3) rather than minting a duplicate identity for the same person.
   */
  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  /** What a guest typed, and null when they skipped the prompt. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  displayName!: string | null;

  /**
   * The account holder's own name, for an `OWNER` or a `REGISTERED` row (plan
   * 0054, section 2).
   *
   * **Written from what the gateway was told, never read out of auth.** Core
   * owns no usernames and plan 0018 section 9 forbids it reaching for one, so
   * this arrives on the message that creates the row exactly as
   * `CreateZoneRequest.username` does.
   *
   * A column beside {@link displayName} rather than a value written into it,
   * because they are different facts: one is unverified text typed on an
   * unauthenticated link and the other is an account's own name, and merging
   * them would make a guest's typed "Dani" indistinguishable from an account
   * called Dani. A registered participant who types a name anyway keeps both,
   * and the typed one wins on screen, because they said it on purpose.
   *
   * A snapshot taken at join time, as a zone membership's is: renaming an
   * account does not rename the person on baskets they have already joined.
   */
  @Column({ type: 'varchar', length: 40, nullable: true })
  username!: string | null;

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
  @Index('uq_basket_participants_secret', {
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

  /**
   * Why {@link revokedAt} is set (plan 0114, section 3), and null exactly when it
   * is not, which a check constraint holds.
   *
   * The reason is what the link reads: a person who `LEFT` may come back through
   * it, and a person `REMOVED` or `LINK_REVOKED` may not (section 7).
   */
  @Column({ type: 'varchar', nullable: true })
  endedReason!: ParticipantEndedReason | null;

  /**
   * When the owner added this person from their groups (plan 0114, section 4).
   *
   * A live row with this set and {@link shareLinkId} null is an **invited
   * member**: revoking the link does not reach it, because the cascade walks
   * `shareLinkId`. Null for a person who came by the link and was never added.
   */
  @Column({ type: 'timestamptz', nullable: true })
  invitedAt!: Date | null;

  /** The owner who added this person. Set exactly when {@link invitedAt} is. */
  @Column({ type: 'uuid', nullable: true })
  invitedByUserId!: string | null;

  /**
   * When this person's access ends by itself (plan 0140, sections 2 and 3).
   *
   * Written at join as `now() + BASKET_LINK_SESSION_TTL`, for a guest and for a
   * signed in link visitor alike. **Null exactly for the owner and for a person
   * the owner added by name**, which `ck_basket_participants_expiry`
   * holds: "keeping access means being added by name" is that constraint.
   *
   * ## Why it is a column here and not a lookup of the link's
   *
   * The hot path is one indexed lookup and never reads the link (plan 0051,
   * section 3.3). Copying the expiry onto the row at join is what lets the live
   * rule gain a clock without gaining a join.
   *
   * Every comparison against it is the database's `now()`, in
   * `liveParticipantWhere()` and in the sweep, so no application clock decides
   * the last second of somebody's access. The sweep only writes down what the
   * predicate already believed, and closes the sockets a predicate cannot.
   */
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;
}
